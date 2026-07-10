/**
 * taglog presentation — the burned-in corner overlay's pure frame computation.
 * The canvas drawing is host-specific; WHAT to draw (timecode, blink phase, chips)
 * is this pure function and is unit-tested here.
 */
import { describe, it, expect } from 'vitest';
import { computeTagOverlay, type TagOverlaySnapshot } from '@/taglog/presentation';

const snap: TagOverlaySnapshot = {
  t0: 100,
  open: [{ tag: 'a', label: 'A', color: '#34d399' }],
};

describe('computeTagOverlay', () => {
  it('returns null when not recording', () => {
    expect(computeTagOverlay(null, 123)).toBeNull();
  });

  it('derives the media timecode from engineTime - t0 and passes chips through', () => {
    const frame = computeTagOverlay(snap, 100 + 65.5)!; // 65.5s into the take
    expect(frame.mediaTime).toBeCloseTo(65.5);
    expect(frame.timecode).toBe('00:01:05.500');
    expect(frame.chips).toEqual(snap.open);
  });

  it('blinks ~1 Hz (on for the first half-second, off for the next)', () => {
    expect(computeTagOverlay(snap, 100.0)!.blinkOn).toBe(true);
    expect(computeTagOverlay(snap, 100.75)!.blinkOn).toBe(false);
  });

  it('clamps a pre-t0 engineTime to zero', () => {
    expect(computeTagOverlay(snap, 99)!.mediaTime).toBe(0);
  });
});
