/**
 * The host side of #325: `liveHandCount` reads the hot store the way the derivation needs
 * (the trunk and the requirements composed in, the skeleton dial, the gesture pref, the
 * Lab, the demand) and the `?hands=` override wins. And the `handCount` resource the host installs
 * (#784): the derived count, raised to two while the tracked hand is not the preferred one.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createLiveHandCount, liveHandCount, type HandsReader } from '@/app/engine/liveApply';
import { HAND_PREFERENCE_OPTIONS, type HandCount } from '@/instruments/hands';
import type { Hand } from '@thoremin/sdk/nodes/domain';
import { useControls } from '@/app/store';
import { labDemandGroups } from '@/slices/lab/app/labDemand';

const initial = useControls.getState();
afterEach(() => useControls.setState(initial, true));

/** An instrument that reads no hand, with the skeleton hidden. */
function handless(): void {
  const s = useControls.getState();
  useControls.setState({
    handMap: { ...s.handMap, maxGain: 0 },
    faceMapping: 'chord',
    overlay: { ...s.overlay, landmarks: { ...s.overlay.landmarks, show: false } },
  });
}

describe('liveHandCount', () => {
  it('looks for every hand for the default instrument', () => {
    expect(liveHandCount(useControls.getState(), new Set(), null)).toBe(2);
  });

  it('looks for one hand when nothing reads or draws the hands', () => {
    handless();
    expect(liveHandCount(useControls.getState(), new Set(), null)).toBe(1);
  });

  it('reads the skeleton dial, the gesture pref, the Lab and the demand from the store', () => {
    handless();
    const s = useControls.getState();
    // The skeleton alone no longer asks for every hand (#168 D13 b, #480): it draws what is tracked.
    expect(liveHandCount({ ...s, overlay: { ...s.overlay, landmarks: { ...s.overlay.landmarks, show: true } } }, new Set(), null)).toBe(1);
    expect(liveHandCount({ ...s, gestures: { ...s.gestures, enabled: true } }, new Set(), null)).toBe(2);
    // The Lab on a hand group claims it as a demand (#600 S16a).
    expect(liveHandCount(s, new Set(labDemandGroups({ show: true, groups: ['hand.position.raw'] })), null)).toBe(2);
    expect(liveHandCount(s, new Set(['hand.position.raw']), null)).toBe(2);
  });

  it('lets the override win either way', () => {
    expect(liveHandCount(useControls.getState(), new Set(), 1)).toBe(1);
    handless();
    expect(liveHandCount(useControls.getState(), new Set(), 2)).toBe(2);
  });
});

describe('createLiveHandCount (#784)', () => {
  const wrong: Hand = { handedness: 'Left', keypoints: [{ x: 0, y: 0, z: 0 }] };
  /** An engine whose hand source has a new frame of the wrong hand at each read. */
  const wrongHandEngine = (): HandsReader => ({ getOutput: (node, port) => (node === 'cam' && port === 'hands' ? { width: 640, height: 480, hands: [wrong] } : undefined) });
  const reads = (resource: () => HandCount, n: number): HandCount[] => Array.from({ length: n }, () => resource());
  /** The escalation in reads of unstamped frames, each counted for the assumed period. */
  const n = Math.round(HAND_PREFERENCE_OPTIONS.escalateAfterS / HAND_PREFERENCE_OPTIONS.framePeriodS);

  it('raises the derived count to two while the tracked hand is not the preferred one', () => {
    const engine = wrongHandEngine();
    const resource = createLiveHandCount({ derived: () => 1, engine: () => engine, preference: () => ({ kind: 'label', handedness: 'Right' }), override: null });
    expect(reads(resource, n).at(-1)).toBe(2);
  });

  it('is the derived count with no preference, before the engine runs, and under the override', () => {
    const engine = wrongHandEngine();
    const right = () => ({ kind: 'label', handedness: 'Right' }) as const;
    expect(reads(createLiveHandCount({ derived: () => 1, engine: () => engine, preference: () => undefined, override: null }), 2 * n)).toEqual(Array(2 * n).fill(1));
    expect(reads(createLiveHandCount({ derived: () => 1, engine: () => null, preference: right, override: null }), 2 * n)).toEqual(Array(2 * n).fill(1));
    expect(reads(createLiveHandCount({ derived: () => 1, engine: () => engine, preference: right, override: 1 }), 2 * n)).toEqual(Array(2 * n).fill(1));
  });
});
