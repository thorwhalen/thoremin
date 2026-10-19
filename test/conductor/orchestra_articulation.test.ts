/**
 * The articulation-to-program rule (#332), pure: which programs go pizzicato (the bowed strings,
 * not the harp, tremolo, the pizzicato patch or any other section), and the switch's hysteresis
 * and minimum hold.
 */
import { describe, expect, it } from 'vitest';
import { ARTICULATION_SWITCH_DEFAULTS, PIZZICATO_PROGRAM, articulatedProgram, createArticulationSwitch } from '@/slices/conductor/nodes/orchestra_articulation';
import { BANK_PROGRAMS } from '@/slices/conductor/nodes/orchestra_map';
import { CONDUCTOR } from '../helpers/extensions';

describe.runIf(CONDUCTOR)('articulatedProgram', () => {
  it('sends the bowed strings to pizzicato and leaves everything else alone', () => {
    for (const p of [40, 41, 42, 43, 48, 49]) expect(articulatedProgram(p, true), `GM ${p}`).toBe(PIZZICATO_PROGRAM);
    for (const p of [44, 45, 46, 47, 56, 60, 68, 73]) expect(articulatedProgram(p, true), `GM ${p}`).toBe(p);
    for (const p of [40, 48, 60]) expect(articulatedProgram(p, false)).toBe(p);
  });
  it('names a program the bank holds', () => {
    expect(BANK_PROGRAMS).toContain(PIZZICATO_PROGRAM);
  });
});

describe.runIf(CONDUCTOR)('createArticulationSwitch', () => {
  const { on, off, holdS } = ARTICULATION_SWITCH_DEFAULTS;
  it('needs a clearly sharp stroke to go pizzicato and a clearly smooth one to return', () => {
    const s = createArticulationSwitch();
    expect(s.step(on - 0.01, 0)).toBe(false);
    expect(s.step(on, 1)).toBe(true);
    expect(s.step((on + off) / 2, 10)).toBe(true); // in the band: stays
    expect(s.step(off + 0.01, 20)).toBe(true);
    expect(s.step(off, 30)).toBe(false);
  });
  it('keeps each state for the hold, and ignores a reading that is not a number', () => {
    const s = createArticulationSwitch();
    s.step(1, 0);
    expect(s.step(0, holdS - 0.01)).toBe(true);
    expect(s.step(Number.NaN, holdS + 5)).toBe(true);
    expect(s.step(0, holdS)).toBe(false);
  });
  it('reset is back to the bow', () => {
    const s = createArticulationSwitch();
    s.step(1, 0);
    s.reset();
    expect(s.pizzicato).toBe(false);
    expect(s.step(1, 0)).toBe(true);
  });
});
