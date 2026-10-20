/**
 * A class may ask to stay listed while empty (`InstrumentClass.showEmpty`, #788): the Instruments
 * view reads the flag instead of naming the air extension's class, so core names no extension.
 */
import { describe, expect, it } from 'vitest';
import '@/host/contributions';
import { classShowsEmpty, registerInstrumentClasses } from '@/instruments/classes';
import { AIR } from './helpers/extensions';

describe('InstrumentClass.showEmpty', () => {
  it('core\'s field class and an unknown class are hidden while empty', () => {
    expect(classShowsEmpty('field')).toBe(false);
    expect(classShowsEmpty('no-such-class')).toBe(false);
  });

  it.runIf(AIR)('the air extension\'s class asks to stay listed (its "Turn on ..." hint)', () => {
    expect(classShowsEmpty('air')).toBe(true);
  });

  it('registering a class again with a different showEmpty is refused', () => {
    registerInstrumentClasses([{ id: 'probe-show-empty', label: 'P', emoji: 'p', colour: '#000', showEmpty: true }]);
    expect(() => registerInstrumentClasses([{ id: 'probe-show-empty', label: 'P', emoji: 'p', colour: '#000' }])).toThrow(/registered twice/);
  });
});
