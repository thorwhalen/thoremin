/**
 * Two one-hand readers that want different hands read two hands (#784): a build with the probe
 * extension (which wants the higher hand below 200 Hz) and the conductor slice (which wants the
 * player's right hand, a raw label). The host's derived count goes to two while both are composed,
 * and stays one when only one of them is.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Extension } from '@thoremin/sdk/instruments/extension';
import { PROBE_EXTENSION } from './fixtures/ext-probe/index';
import { CONDUCTOR_EXTENSION } from '@/slices/conductor/index';
import { CONDUCTOR } from './helpers/extensions';

const PURE: readonly Extension[] = [PROBE_EXTENSION, CONDUCTOR_EXTENSION];

let live: typeof import('@/app/engine/liveApply');
let store: typeof import('@/app/store');

beforeAll(async () => {
  vi.resetModules();
  vi.doMock('virtual:thoremin/extensions', () => ({ default: PURE }));
  vi.doMock('virtual:thoremin/extensions-ui', () => ({ default: [] }));
  [live, store] = await Promise.all([import('@/app/engine/liveApply'), import('@/app/store')]);
});

describe.runIf(CONDUCTOR)('conflicting hand preferences (#784)', () => {
  /** No other hand reader: the field voices silenced, the skeleton hidden. */
  const base = () => {
    const s = store.useControls.getState();
    return { ...s, handMap: { ...s.handMap, maxGain: 0 }, faceMapping: 'chord', overlay: { ...s.overlay, landmarks: { ...s.overlay.landmarks, show: false } } } as typeof s;
  };
  const conductor = (on: boolean) => ({ ...(base() as unknown as { conductor: object }).conductor, enabled: on });

  it('the probe wanting the higher hand and the conductor a label read two hands', () => {
    const both = { ...base(), probe: { enabled: true, freq: 100 }, conductor: conductor(true) } as never;
    expect(live.liveHandPreference(both, new Set())).toBeUndefined();
    expect(live.liveHandCount(both, new Set(), null)).toBe(2);
  });

  it('each alone reads one hand, with its own preference', () => {
    const probeAlone = { ...base(), probe: { enabled: true, freq: 100 }, conductor: conductor(false) } as never;
    expect(live.liveHandCount(probeAlone, new Set(), null)).toBe(1);
    expect(live.liveHandPreference(probeAlone, new Set())).toEqual({ kind: 'higher' });
    const conductorAlone = { ...base(), probe: { enabled: false, freq: 100 }, conductor: conductor(true) } as never;
    expect(live.liveHandCount(conductorAlone, new Set(), null)).toBe(1);
    expect(live.liveHandPreference(conductorAlone, new Set())).toEqual({ kind: 'label', handedness: 'Left' });
  });
});
