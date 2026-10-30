/**
 * Play along: notes travel down a highway to a hit line and every onset is judged in time
 * (`@thoremin/judge`'s onset judge with the microphone windows), the way Yousician, Melodics and
 * the rhythm trainers do. An unpitched lesson is a rhythm to clap or tap; in a pitched one the
 * onset must also carry the note: the pitch heard just after the attack, octave-folded, within the
 * tolerance, or the target is a "wrong note" (a miss).
 *
 * The count-in is the only click: the microphone would hear a metronome during play as claps.
 *
 * Pure: fed the engine time and what was heard each tick.
 */
import { estimateKey } from './spelling';
import {
  AUDIO_ONSET_WINDOWS,
  centsOff,
  createOnsetJudge,
  hzOf,
  midiOf,
  scoreJudgments,
  type OnsetJudgment,
  type Windows,
} from '@thoremin/judge';
import { median } from '@thoremin/stats';
import { countInCues, createCueFeed, type Cue } from './cues';
import { barStart, placeLesson, type Lesson } from './lesson';
import { shifted, type Heard, type HeardPitch } from './listen';
import { timingVerdict, type GameView, type ViewNote } from './view';

export interface PlayAlongOptions {
  start: number;
  transpose?: number;
  windows?: Windows;
  toleranceCents?: number;
  /** Subtracted from every heard time (the player's calibrated offset), seconds. */
  offset?: number;
  /** A melody's first note, played during the count-in so the player can find it. Default true. */
  reference?: boolean;
  past?: number;
  ahead?: number;
}

const REFERENCE_VELOCITY = 0.7;

/** Where the pitch of a hit is read: from just after the attack (the transient has no pitch) to a few periods later. */
const PITCH_FROM = 0.03;
const PITCH_TO = 0.15;

export function createPlayAlongSession(lesson: Lesson, opts: PlayAlongOptions) {
  const windows = opts.windows ?? AUDIO_ONSET_WINDOWS;
  const tol = opts.toleranceCents ?? 100;
  const offset = opts.offset ?? 0;
  const past = opts.past ?? 0.6;
  const ahead = opts.ahead ?? 3;
  const placed = placeLesson(lesson, opts.start, opts.transpose ?? 0);
  const pitched = placed.notes.every((n) => n.midi !== undefined);
  const judge = createOnsetJudge(placed.notes.map((n) => ({ id: n.id, t: n.start })), { windows });
  const view: ViewNote[] = placed.notes.map((n) => ({ ...n, state: 'pending' }));
  const final = new Map<number, OnsetJudgment>();
  const awaitingPitch: { j: OnsetJudgment & { kind: 'hit' }; at: number }[] = [];
  const pitchFrames: HeardPitch[] = [];
  const flashes: GameView['flashes'] = [];
  const feed = createCueFeed(0.5);
  feed.add(countInCues(placed.clicks));
  if ((opts.reference ?? true) && pitched && placed.notes.length > 0 && placed.clicks.length > 0) {
    // As in Sing: over the count-in's second half, ringing out before the first note is due.
    feed.add([{ t: placed.clicks[Math.floor(placed.clicks.length / 2)], midi: placed.notes[0].midi!, velocity: REFERENCE_VELOCITY, kind: 'reference' }]);
  }
  const pitches = placed.notes.map((n) => n.midi ?? 60);
  const key = estimateKey(pitches);
  // The count-in's clicks and the reference note reach the microphone too: nothing heard before
  // the first note's widest window opens is the player's, so none of it counts as an extra.
  const listenFrom = (placed.notes[0]?.start ?? opts.start) - Math.max(...windows.map((w) => w.early));
  let combo = 0;
  let strays = 0;

  const settle = (j: OnsetJudgment, now: number) => {
    final.set(j.target.id, j);
    const v = view[j.target.id];
    if (j.kind === 'hit') {
      v.state = 'hit';
      v.label = j.tier;
      flashes.push({ t: now, label: j.tier, offset: j.offset });
      combo++;
    } else {
      v.state = 'miss';
      v.label = v.label ?? 'miss';
      flashes.push({ t: now, label: v.label });
      combo = 0;
    }
  };

  /** The pitch heard after an onset, or null when nothing voiced was heard there. */
  const pitchAfter = (t: number): number | null => {
    const midis = pitchFrames
      .filter((p) => p.t >= t + PITCH_FROM && p.t <= t + PITCH_TO && p.f0 !== null && p.clarity >= 0.5)
      .map((p) => midiOf(p.f0!));
    return midis.length === 0 ? null : median(midis);
  };

  function tick(now: number, heardRaw: Heard): { view: GameView; cues: Cue[] } {
    const heard = shifted(heardRaw, offset);
    pitchFrames.push(...heard.pitch);
    for (const o of [...heard.onsets].sort((a, b) => a.t - b.t)) {
      if (o.t < listenFrom) continue;
      for (const m of judge.advance(o.t)) settle(m, now);
      const j = judge.hit({ t: o.t });
      if (j.kind === 'stray') {
        strays++;
        flashes.push({ t: now, label: 'extra' });
      } else if (j.kind === 'hit') {
        if (pitched) awaitingPitch.push({ j, at: o.t + PITCH_TO });
        else settle(j, now);
      }
    }
    for (const m of judge.advance(now)) settle(m, now);
    // A pitched hit is decided once the pitch after its attack has been heard.
    for (let i = 0; i < awaitingPitch.length; ) {
      const { j, at } = awaitingPitch[i];
      if (now < at) {
        i++;
        continue;
      }
      awaitingPitch.splice(i, 1);
      const target = placed.notes[j.target.id].midi!;
      const heardMidi = pitchAfter(j.event.t);
      if (heardMidi !== null && Math.abs(centsOff(hzOf(heardMidi), target, true)) <= tol) settle(j, now);
      else {
        view[j.target.id].label = 'wrong note';
        settle({ kind: 'miss', target: j.target }, now);
      }
    }
    while (pitchFrames.length > 0 && pitchFrames[0].t < now - 1) pitchFrames.shift();
    while (flashes.length > 0 && flashes[0].t < now - 1) flashes.shift();
    for (const v of view) if (v.state === 'pending' && now >= v.start - windows[0].early && now <= v.start + windows[0].late) v.state = 'active';

    const judgments = [...final.values()].sort((a, b) => a.target.t - b.target.t);
    const score = scoreJudgments(judgments, strays);
    const done = final.size === placed.notes.length;
    const phase = now < placed.t0 ? 'count-in' : done ? 'results' : 'playing';
    const v: GameView = {
      game: 'play-along',
      title: lesson.title,
      phase,
      now,
      from: now - past,
      to: now + ahead,
      low: Math.min(...pitches),
      high: Math.max(...pitches),
      ...(pitched ? { melody: { low: Math.min(...pitches), high: Math.max(...pitches) }, key } : {}),
      grid: { t0: placed.t0, beatS: 60 / lesson.bpm, beatsPerBar: lesson.beatsPerBar ?? 4 },
      toleranceCents: tol,
      notes: view.filter((n) => n.end >= barStart(lesson, placed.t0, now - past) && n.start <= now + ahead).map((n) => ({ ...n })),
      trail: [],
      flashes: [...flashes],
      countdown: Math.max(0, Math.ceil(((placed.t0 - now) * lesson.bpm) / 60)),
      accuracy: score.targets === 0 ? 0 : score.accuracy * (score.targets / placed.notes.length),
      combo,
      ...(phase === 'results'
        ? {
            results: {
              accuracy: score.accuracy,
              counts: { ...score.counts, ...(strays ? { extra: strays } : {}) },
              ...(score.hits >= 2 ? { timing: timingVerdict(score.meanOffset, score.sdOffset) } : {}),
              summary: `${score.hits} of ${placed.notes.length} on time, best run ${score.maxCombo}`,
            },
          }
        : {}),
    };
    return { view: v, cues: feed.due(now) };
  }

  return { tick, notes: placed.notes, end: placed.end, windows };
}
