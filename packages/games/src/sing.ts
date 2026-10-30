/**
 * Sing: the karaoke game. A melody's notes scroll past a now line as bars on a pitch axis, the
 * voice draws a trail over them, and each note is judged by the share of its time the voice was
 * within the tolerance (octave-folded by default: UltraStar's and Rock Band's rule), the way
 * SingStar and UltraStar score (the research doc, section 5.1).
 *
 * The reference: the first note is played during the count-in so the singer can find it; a guide
 * under the whole melody is off by default, because the microphone would hear it as the singer.
 *
 * Pure: a session is fed the engine time and what was heard each tick, and returns the view and
 * the sounds due.
 */
import { estimateKey } from './spelling';
import { judgePitchNote, midiOf, type PitchNote, type PitchSample } from '@thoremin/judge';
import { countInCues, createCueFeed, type Cue } from './cues';
import { barStart, placeLesson, type Lesson } from './lesson';
import { shifted, type Heard } from './listen';
import type { GameView, TrailPoint, ViewNote } from './view';

export interface SingOptions {
  start: number;
  transpose?: number;
  toleranceCents?: number;
  octaveFold?: boolean;
  /** Subtracted from every heard time (the player's calibrated offset), seconds. */
  offset?: number;
  /** Play the first note during the count-in. Default true. */
  reference?: boolean;
  /** Seconds of the past and the future the stage shows. Defaults 2 and 4. */
  past?: number;
  ahead?: number;
}

const REFERENCE_VELOCITY = 0.7;
/** How long after a note ends it is judged (the last pitch frames of the note arrive late). */
const SETTLE = 0.15;

export function createSingSession(lesson: Lesson, opts: SingOptions) {
  const tol = opts.toleranceCents ?? 100;
  const octaveFold = opts.octaveFold ?? true;
  const offset = opts.offset ?? 0;
  const past = opts.past ?? 2;
  const ahead = opts.ahead ?? 4;
  const placed = placeLesson(lesson, opts.start, opts.transpose ?? 0);
  const notes: PitchNote[] = placed.notes.map((n) => ({ id: n.id, start: n.start, end: n.end, midi: n.midi ?? 60 }));
  const pitches = notes.map((n) => n.midi);
  const melody = { low: Math.min(...pitches), high: Math.max(...pitches) };
  const key = estimateKey(pitches);
  const low = melody.low - 4;
  const high = melody.high + 4;
  const view: ViewNote[] = notes.map((n) => ({ ...n, state: 'pending', fill: 0 }));
  const samples: PitchSample[] = [];
  const trail: TrailPoint[] = [];
  const flashes: GameView['flashes'] = [];
  const results = new Map<number, ReturnType<typeof judgePitchNote>>();
  const feed = createCueFeed(0.5);
  const cues: Cue[] = countInCues(placed.clicks);
  if ((opts.reference ?? true) && placed.clicks.length > 0) {
    // The first note, sounded over the count-in's second half.
    cues.push({ t: placed.clicks[Math.floor(placed.clicks.length / 2)], midi: notes[0].midi, velocity: REFERENCE_VELOCITY, kind: 'reference' });
  }
  feed.add(cues);
  const judgeOpts = { toleranceCents: tol, octaveFold };
  /** The trail point drawn for a sung pitch: folded to the octave of the note sounding then. */
  const display = (t: number, midi: number): number => {
    if (!octaveFold) return midi;
    const near = notes.find((n) => t >= n.start - 0.25 && t < n.end + 0.25);
    if (!near) return midi;
    return midi + 12 * Math.round((near.midi - midi) / 12);
  };
  let combo = 0;

  function tick(now: number, heardRaw: Heard): { view: GameView; cues: Cue[] } {
    const heard = shifted(heardRaw, offset);
    for (const p of heard.pitch) {
      samples.push({ t: p.t, f0: p.f0, clarity: p.clarity });
      const voiced = p.f0 !== null && p.f0 > 0 && p.clarity >= 0.5;
      trail.push({ t: p.t, midi: voiced ? display(p.t, midiOf(p.f0!)) : null });
    }
    while (trail.length > 0 && trail[0].t < now - past - 0.5) trail.shift();
    for (const [i, note] of notes.entries()) {
      const v = view[i];
      if (results.has(note.id)) continue;
      if (now >= note.end + SETTLE) {
        const j = judgePitchNote(note, samples, judgeOpts);
        results.set(note.id, j);
        v.state = j.tier === 'miss' ? 'miss' : 'hit';
        v.label = j.tier;
        v.fill = j.inTune;
        flashes.push({ t: now, label: j.tier });
        combo = j.tier === 'miss' ? 0 : combo + 1;
      } else if (now >= note.start) {
        v.state = 'active';
        // The share so far: the frames heard inside the note up to now.
        v.fill = judgePitchNote({ ...note, end: Math.min(note.end, now) }, samples, judgeOpts).inTune;
      }
    }
    // Samples before the earliest unjudged note are no longer needed.
    const keepFrom = notes.find((n) => !results.has(n.id))?.start ?? Infinity;
    while (samples.length > 0 && samples[0].t < keepFrom - 0.5) samples.shift();
    while (flashes.length > 0 && flashes[0].t < now - 1) flashes.shift();

    const judged = [...results.values()];
    const total = notes.reduce((s, n) => s + (n.end - n.start), 0);
    const accuracy = judged.reduce((s, j) => s + j.inTune * (j.note.end - j.note.start), 0) / total;
    const done = now >= placed.end + SETTLE;
    const phase = now < placed.t0 ? 'count-in' : done ? 'results' : 'playing';
    const counts: Record<string, number> = {};
    for (const j of judged) counts[j.tier] = (counts[j.tier] ?? 0) + 1;
    const view_: GameView = {
      game: 'sing',
      title: lesson.title,
      phase,
      now,
      from: now - past,
      to: now + ahead,
      low,
      high,
      melody,
      key,
      toleranceCents: tol,
      grid: { t0: placed.t0, beatS: 60 / lesson.bpm, beatsPerBar: lesson.beatsPerBar ?? 4 },
      notes: view.filter((n) => n.end >= barStart(lesson, placed.t0, now - past) && n.start <= now + ahead).map((n) => ({ ...n })),
      trail: trail.filter((p) => p.t >= now - past),
      flashes: [...flashes],
      countdown: Math.max(0, Math.ceil(((placed.t0 - now) * lesson.bpm) / 60)),
      accuracy,
      combo,
      ...(phase === 'results'
        ? {
            results: {
              accuracy,
              counts,
              summary: `${judged.filter((j) => j.tier !== 'miss').length} of ${notes.length} notes sung in tune`,
            },
          }
        : {}),
    };
    return { view: view_, cues: feed.due(now) };
  }

  return { tick, end: placed.end, notes };
}
