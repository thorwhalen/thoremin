/**
 * `pluck-out` (#249): schedules each note on the audio clock at its engine time (the
 * clock map `drum-out` owns), never in the past, drops notes while the context is not
 * running, builds its sink with the node's timbre and mono setting, and sounds nothing
 * outside real time (boundary B).
 */
import { describe, it, expect } from 'vitest';
import { pluckOutNode, type PluckSinkOptions } from '@/extensions/air/nodes/pluck_out';
import type { NoteEvent } from '@/extensions/air/nodes/air_bass';
import { TIME_SCALE_KEY } from '@/dag';

const note = (t: number, midi = 40): NoteEvent => ({ t, midi, velocity: 0.8, predicted: true, lead: 0.05 });

function harness(params: Record<string, unknown> = {}, state = 'running', timeScale?: number) {
  const played: { midi: number; when: number }[] = [];
  let opts: PluckSinkOptions | undefined;
  const ac = { currentTime: 10, state };
  const h = pluckOutNode.make(pluckOutNode.params.parse(params));
  const tick = (time: number, notes: NoteEvent[]) =>
    h.process({ notes }, {
      time,
      dt: 1 / 30,
      tick: 0,
      resources: {
        ...(timeScale === undefined ? {} : { [TIME_SCALE_KEY]: timeScale }),
        audioContext: ac,
        masterGain: {},
        createPluckSink: (_ac: unknown, _dest: unknown, o: PluckSinkOptions) => {
          opts = o;
          return { play: (midi: number, _v: number, when: number) => void played.push({ midi, when }), close: () => {} };
        },
      },
    } as never);
  return { played, tick, opts: () => opts, ac };
}

describe('pluck-out', () => {
  it('schedules a predicted note ahead on the audio clock, and a late one at once', () => {
    const { played, tick } = harness();
    tick(5, [note(5.05, 40), note(4.9, 43)]);
    expect(played[0]).toEqual({ midi: 40, when: expect.closeTo(10.05, 6) });
    expect(played[1].midi).toBe(43);
    expect(played[1].when).toBeGreaterThan(10);
    expect(played[1].when).toBeLessThan(10.01);
  });

  it('builds its sink with the timbre and mono setting', () => {
    const { tick, opts } = harness({ timbre: 'guitar', mono: false });
    tick(1, [note(1)]);
    expect(opts()).toEqual({ timbre: 'guitar', mono: false });
  });

  it('drops notes while the audio context is not running', () => {
    const { played, tick } = harness({}, 'suspended');
    tick(1, [note(1.05)]);
    expect(played).toEqual([]);
  });

  it('sounds nothing outside real time (a replay at another speed)', () => {
    const { played, tick } = harness({}, 'running', 2);
    tick(1, [note(1.05)]);
    expect(played).toEqual([]);
  });
});
