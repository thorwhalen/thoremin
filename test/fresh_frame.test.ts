/**
 * The stamp rules every frame consumer shares (#964): `isFreshFrame`, the one test of whether a
 * frame is a new observation (the same object, or a copy with the same capture stamp and origin,
 * is not), and `stampInterval`, the seconds between two frames when their stamps can say.
 */
import { describe, expect, it } from 'vitest';
import { isFreshFrame, stampInterval, type FrameTiming } from '@thoremin/sdk/nodes/domain';

const ORIGIN = 1_000;

describe('isFreshFrame', () => {
  it('a first frame is new; no frame never is', () => {
    expect(isFreshFrame(undefined, {})).toBe(true);
    expect(isFreshFrame({ t: 1 }, undefined)).toBe(false);
    expect(isFreshFrame(undefined, undefined)).toBe(false);
  });

  it('the same object is not new, stamped or not', () => {
    const unstamped: FrameTiming = {};
    const frame: FrameTiming = { t: 1, tOrigin: ORIGIN };
    expect(isFreshFrame(unstamped, unstamped)).toBe(false);
    expect(isFreshFrame(frame, frame)).toBe(false);
  });

  it('a copy with the same stamp and origin is not new (a replayed recording parses each tick anew)', () => {
    expect(isFreshFrame({ t: 1, tOrigin: ORIGIN }, { t: 1, tOrigin: ORIGIN })).toBe(false);
    expect(isFreshFrame({ t: 1 }, { t: 1 })).toBe(false);
  });

  it('another stamp, another origin, or another unstamped object is new', () => {
    expect(isFreshFrame({ t: 1, tOrigin: ORIGIN }, { t: 2, tOrigin: ORIGIN })).toBe(true);
    expect(isFreshFrame({ t: 1, tOrigin: ORIGIN }, { t: 1, tOrigin: ORIGIN + 1 })).toBe(true);
    expect(isFreshFrame({}, {})).toBe(true);
    expect(isFreshFrame({ t: 1 }, {})).toBe(true);
  });
});

describe('stampInterval', () => {
  it('is the seconds between two stamps in one time base', () => {
    expect(stampInterval({ t: 1, tOrigin: ORIGIN }, { t: 1.5, tOrigin: ORIGIN })).toBe(0.5);
    expect(stampInterval({ t: 1 }, { t: 1.25 })).toBe(0.25);
  });

  it('says nothing for a missing stamp, another time base, or a stamp that does not move forward', () => {
    expect(stampInterval(undefined, { t: 1 })).toBeUndefined();
    expect(stampInterval({}, { t: 1 })).toBeUndefined();
    expect(stampInterval({ t: 1, tOrigin: ORIGIN }, { t: 2, tOrigin: ORIGIN + 1 })).toBeUndefined();
    expect(stampInterval({ t: 2 }, { t: 2 })).toBeUndefined();
    expect(stampInterval({ t: 2 }, { t: 1 })).toBeUndefined();
  });
});
