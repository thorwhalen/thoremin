import { Scale, MusicGenerationMode } from '@google/genai';

export interface Strain {
  id: string;
  text: string;
  weight: number;
}

export interface Vibe {
  id: string;
  name: string;
  strains: Strain[];
}

export interface AiDjSettings {
  bpm: number;
  scale: Scale;
  density: number;
  brightness: number;
  guidance: number;
  temperature: number;
  topK: number;
  muteBass: boolean;
  muteDrums: boolean;
  onlyBassAndDrums: boolean;
  musicGenerationMode: MusicGenerationMode;
  volume: number; // 0-1, controls AI DJ output level
}

export const DEFAULT_AI_DJ_SETTINGS: AiDjSettings = {
  bpm: 120,
  scale: Scale.SCALE_UNSPECIFIED,
  density: 0.5,
  brightness: 0.5,
  guidance: 4.0,
  temperature: 1.1,
  topK: 40,
  muteBass: false,
  muteDrums: false,
  onlyBassAndDrums: false,
  musicGenerationMode: MusicGenerationMode.QUALITY,
  volume: 0.8,
};

function uid(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

export function createStrain(text: string, weight = 1.0): Strain {
  return { id: uid(), text, weight };
}

export function createVibe(name: string, strains: Strain[]): Vibe {
  return { id: uid(), name, strains };
}

export const DEFAULT_VIBES: Vibe[] = [
  createVibe('Chill Ambient', [
    createStrain('Ambient Pads', 1.0),
    createStrain('Lo-Fi Hip Hop', 0.6),
    createStrain('Gentle Reverb', 0.4),
  ]),
  createVibe('Funky Groove', [
    createStrain('Funk', 1.0),
    createStrain('Slap Bass', 0.8),
    createStrain('Tight Groove', 0.7),
  ]),
  createVibe('Electronic', [
    createStrain('Synthpop', 1.0),
    createStrain('Sparkling Arpeggios', 0.7),
    createStrain('Fat Beats', 0.5),
  ]),
];

export type PlaybackState = 'stopped' | 'playing' | 'loading' | 'paused';
