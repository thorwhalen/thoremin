/** Note names (#249): the air flute's fingerings are named by their note. */
import { describe, it, expect } from 'vitest';
import { parseNoteName } from '@/extensions/air/lib/notes';

describe('parseNoteName', () => {
  it('reads letter, accidental and octave (C4 = 60), keeping the typed spelling', () => {
    expect(parseNoteName('C4')).toEqual({ midi: 60, name: 'C4' });
    expect(parseNoteName(' d5 ')).toEqual({ midi: 74, name: 'D5' });
    expect(parseNoteName('F#4')).toEqual({ midi: 66, name: 'F#4' });
    expect(parseNoteName('Bb3')).toEqual({ midi: 58, name: 'Bb3' });
    expect(parseNoteName('C-1')).toEqual({ midi: 0, name: 'C-1' });
  });

  it('refuses what is not a note', () => {
    for (const bad of ['', 'D', 'H4', 'D55', 'Cb-1', 'G9x', 'Em']) expect(parseNoteName(bad)).toBeNull();
  });
});
