/**
 * Start alignment (#346 item 1): with the Song tool's "Start on your step" on, the pace controller moves the song ONCE per
 * play, at the first following tick, so its beat lands on the dancer's cycle start (a cue to `songBeat - phaseError`),
 * instead of closing the phase error through the rate nudge over several seconds. Off (the default), it emits nothing.
 */
import { describe, expect, it } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import { PACE_DEFAULTS, type MusicalTime, type PulseState } from '@thoremin/ictus';
import { paceControllerNode } from '@/nodes';

const P0 = 60 / 120;
const HZ = 30;

function dancer(t: number, period: number, t0: number): PulseState {
  const beat = (t - t0) / period;
  return { t, beat, phase: beat - Math.floor(beat), tempo: 60 / period, period, confidence: 0.8, nextBeatAt: t + (Math.floor(beat) + 1 - beat) * period, beatsPerBar: 4, beatInBar: 0, state: 'running', anchors: 10, level: period, strength: 0.8, candidates: [{ period, r: 0.8 }] };
}
/** The song's reading as the node gets it: on a DELAYED edge, so stamped one tick before the tick it is read in. */
function song(t: number, pos: number, state: MusicalTime['state'] = 'running', delayed = true): MusicalTime {
  const stamp = delayed ? t - 1 / HZ : t;
  const beat = (pos - (t - stamp)) / P0;
  return { t: stamp, beat, phase: beat - Math.floor(beat), tempo: 60 / P0, period: P0, confidence: 1, nextBeatAt: stamp + (Math.floor(beat) + 1 - beat) * P0, beatsPerBar: 4, beatInBar: 0, state, anchors: 8 };
}

/** Run `seconds` of a song starting `offset` beats behind the dancer's cycle; the cues emitted, by tick. */
function run(align: boolean, offsetBeats: number, seconds = 12, handle: unknown = { id: 1 }) {
  const node = paceControllerNode.make(paceControllerNode.params.parse({}));
  const cues: { tick: number; id: number; beat: number }[] = [];
  const rate = 1;
  for (let i = 0; i < seconds * HZ; i++) {
    const t = i / HZ;
    const pos = t * rate + offsetBeats * P0;
    const out = node.process(
      { pulse: dancer(t, P0, 0), song: song(t, pos), rate, base: 1, range: PACE_DEFAULTS.range, songHandle: handle, alignStart: align },
      { tick: i, time: t, dt: 1 / HZ, resources: {} } as NodeContext,
    ) as { cue?: { id: number; beat: number } };
    if (out.cue) cues.push({ tick: i, ...out.cue });
  }
  return cues;
}

describe('start alignment', () => {
  it('off by default: no cue, whatever the error', () => {
    expect(run(false, 0.4)).toEqual([]);
  });

  it('on: one cue per play, at the first following tick, that cancels the phase error', () => {
    const cues = run(true, 0.4);
    expect(cues).toHaveLength(1);
    // The song is 0.4 beat ahead of the dancer's cycle: the cue moves it back to the cycle start.
    const at = cues[0];
    // The song at the cue's tick is at beat (t + 0.4 P0) / P0; landing it is that beat less the 0.4, a WHOLE beat
    // on the step. Within a few hundredths of a beat, from either side (the reading was a tick old: the cue is
    // taken at this tick's extrapolation, not the stale stamp, #346 review).
    const songBeatNow = (at.tick / HZ + 0.4 * P0) / P0;
    expect(at.beat).toBeCloseTo(songBeatNow - 0.4, 1);
    const frac = ((at.beat % 1) + 1) % 1;
    expect(Math.min(frac, 1 - frac)).toBeLessThan(0.03);
    expect(at.id).toBeGreaterThan(1e9);
  });

  it('a small error is left to the nudge; a second play (the song stopped, then running) aligns again', () => {
    expect(run(true, 0.02)).toEqual([]);
    const node = paceControllerNode.make(paceControllerNode.params.parse({}));
    let n = 0;
    const play = (from: number) => {
      for (let i = 0; i < 6 * HZ; i++) {
        const t = from + i / HZ;
        const out = node.process({ pulse: dancer(t, P0, 0), song: song(t, t + 0.4 * P0), rate: 1, base: 1, range: PACE_DEFAULTS.range, songHandle: { id: 1 }, alignStart: true }, { tick: from * HZ + i, time: t, dt: 1 / HZ, resources: {} } as NodeContext) as { cue?: unknown };
        if (out.cue) n++;
      }
    };
    play(0);
    // Stopped: the song reads as not running for a moment.
    for (let i = 0; i < 10; i++) node.process({ pulse: dancer(6 + i / HZ, P0, 0), song: song(6 + i / HZ, 6, 'ready'), rate: 1, base: 1, songHandle: { id: 1 }, alignStart: true }, { tick: 1000 + i, time: 6 + i / HZ, dt: 1 / HZ, resources: {} } as NodeContext);
    play(7);
    expect(n).toBe(2);
  });

  it('a song that starts before its first tracked beat (negative beats) is not skipped past its intro', () => {
    // 12 beats of intro: the song's beat reads -12 at its start and still reads negative when the lock persists (3 s,
    // 6 beats later); the dancer's cycle is a beat grid at 0.4 off it.
    const node = paceControllerNode.make(paceControllerNode.params.parse({}));
    const cues: { beat: number }[] = [];
    for (let i = 0; i < 12 * HZ; i++) {
      const t = i / HZ;
      const s = song(t, t - 12 * P0 + 0.4 * P0);
      const out = node.process({ pulse: dancer(t, P0, 0), song: s, rate: 1, base: 1, range: PACE_DEFAULTS.range, songHandle: { id: 1 }, alignStart: true }, { tick: i, time: t, dt: 1 / HZ, resources: {} } as NodeContext) as { cue?: { beat: number } };
      if (out.cue) cues.push(out.cue);
    }
    expect(cues).toHaveLength(1);
    // Still on the negative side of the song's grid (the intro), a whole beat on the step: not clamped to 0, which
    // would skip the intro to its first beat.
    expect(cues[0].beat).toBeLessThan(0);
    const frac = ((cues[0].beat % 1) + 1) % 1;
    expect(Math.min(frac, 1 - frac)).toBeLessThan(0.03);
  });
});
