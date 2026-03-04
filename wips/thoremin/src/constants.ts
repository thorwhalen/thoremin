import { InstrumentType } from './hooks/useAudioEngine';

export const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALE_TYPES = {
  major: { name: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
  pentatonic: { name: 'Pentatonic', intervals: [0, 2, 4, 7, 9] },
  minorHarmonic: { name: 'Minor Harmonic', intervals: [0, 2, 3, 5, 7, 8, 11] }
};

export const INSTRUMENTS: { id: InstrumentType; name: string }[] = [
  { id: 'sine', name: 'Sine' },
  { id: 'square', name: 'Square' },
  { id: 'sawtooth', name: 'Sawtooth' },
  { id: 'triangle', name: 'Triangle' }
];

export interface HandSettings {
  root: number;
  type: keyof typeof SCALE_TYPES;
  octaves: number;
  baseOctave: number;
  magnetism: number;
  instrument: InstrumentType;
}

export const defaultSettings: HandSettings = {
  root: 0,
  type: 'major',
  octaves: 2,
  baseOctave: 3,
  magnetism: 0.8,
  instrument: 'sine'
};

export function generateScale(settings: HandSettings) {
  const { type, octaves, baseOctave, root } = settings;
  const intervals = SCALE_TYPES[type].intervals;
  const scale: number[] = [];
  const baseNote = (baseOctave + 1) * 12 + root;

  for (let o = 0; o < octaves; o++) {
    for (const interval of intervals) {
      scale.push(baseNote + o * 12 + interval);
    }
  }
  scale.push(baseNote + octaves * 12);
  return scale.sort((a, b) => a - b);
}
