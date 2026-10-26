/**
 * The chord map's melody gate: a note starts only once the hand has been over the ladder for two
 * camera frames, moves between bands at once while sounding, and is held through up to three lost
 * frames, so a hand the model loses or mislabels for a frame is no longer a click.
 */
import { describe, it, expect } from 'vitest';
import { createBandGate } from '@thoremin/ext-harmony/lib/chord_map';

const run = (bands: (number | null)[]) => {
  const g = createBandGate(2, 3);
  return bands.map((b) => g.push(b));
};

describe('the melody gate', () => {
  it('a one-frame hand makes no sound', () => {
    expect(run([null, 4, null, null])).toEqual([null, null, null, null]);
  });

  it('starts on the second frame and follows the hand at once after', () => {
    expect(run([3, 3, 5, 6])).toEqual([null, 3, 5, 6]);
  });

  it('holds through three lost frames, and lets go on the fourth', () => {
    expect(run([2, 2, null, null, null, 2])).toEqual([null, 2, 2, 2, 2, 2]);
    expect(run([2, 2, null, null, null, null])).toEqual([null, 2, 2, 2, 2, null]);
  });
});
