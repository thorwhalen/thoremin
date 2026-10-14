/**
 * The host side of #325: `liveHandCount` reads the hot store the way the derivation needs
 * (the trunk and the requirements composed in, the skeleton dial, the gesture pref, the
 * Lab, the demand) and the `?hands=` override wins.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { liveHandCount } from '@/app/liveApply';
import { useControls } from '@/app/store';

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
    expect(liveHandCount({ ...s, overlay: { ...s.overlay, landmarks: { ...s.overlay.landmarks, show: true } } }, new Set(), null)).toBe(2);
    expect(liveHandCount({ ...s, gestures: { ...s.gestures, enabled: true } }, new Set(), null)).toBe(2);
    expect(liveHandCount({ ...s, featureLab: { ...s.featureLab, show: true, groups: ['hand.position.raw'] } }, new Set(), null)).toBe(2);
    expect(liveHandCount(s, new Set(['hand.position.raw']), null)).toBe(2);
  });

  it('lets the override win either way', () => {
    expect(liveHandCount(useControls.getState(), new Set(), 1)).toBe(1);
    handless();
    expect(liveHandCount(useControls.getState(), new Set(), 2)).toBe(2);
  });
});
