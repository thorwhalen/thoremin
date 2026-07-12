/**
 * Display labels for the settings panels — the human-facing name of each machine id
 * (face mapping modes, chord voicings/renderings, finger-effect targets).
 *
 * Pulled out of `DialsControlsPanel.tsx` so the panels hold only markup + wiring, and
 * so a copy change is a one-file, no-JSX edit. The keys are typed against the domain
 * unions (`FaceMapping`, `VoicingId`, `RenderingId`, `FingerTarget`), so adding a
 * variant to any of them fails the typecheck here until it is given a label.
 */
import type { VoicingId, RenderingId } from '@/music/voicing';
import type { FaceMapping } from '@/nodes';
import type { FingerTarget } from '@/nodes/mapping/hand_map';

/** The face-mapping chooser's options, in display order. */
export const FACE_MODE_OPTIONS: { value: FaceMapping; label: string }[] = [
  { value: 'none', label: 'Off' },
  { value: 'timbre', label: 'Expression → timbre' },
  { value: 'chord', label: 'Expression → chord' },
  { value: 'controls', label: 'Head/face pose → chord' },
];

/** The one-paragraph explainer under the face-mapping chooser, per mode. */
export const FACE_MODE_HINT: Record<FaceMapping, string> = {
  none: 'No face detection. Pick a mode to map your expression to sound. Uses the same camera as hand tracking; loads a small face model on first use.',
  timbre: 'Smile → brighter tone, open mouth → vibrato — shaping the notes your hands play.',
  chord: 'Your expression plays a chord from the chord-source scale (Chord sound → Chord scale). Works with any melody scale — pentatonic included.',
  controls:
    'Deliberate head/face moves play chords — turn to pick the chord, open your mouth to sound it. The easy, controllable alternative to emotion mode.',
};

/** Chord voicings. */
export const VOICING_LABELS: Record<VoicingId, string> = {
  spread: 'Open (spread)',
  bassTriad: 'Bass + triad',
  close: 'Close',
  shell: 'Shell (sparse)',
  power: 'Power (5ths)',
};

/** Chord renderings (how the voiced chord is articulated in time). */
export const RENDERING_LABELS: Record<RenderingId, string> = {
  sustained: 'Sustained pad',
  strum: 'Strum',
  arpUp: 'Arpeggio ↑',
  arpDown: 'Arpeggio ↓',
  arpUpDown: 'Arpeggio ↑↓',
  pulse: 'Pulse',
  alberti: 'Alberti',
};

/** What a finger's thumb-distance can be routed to. */
export const EFFECT_LABELS: Record<FingerTarget, string> = {
  none: 'Off',
  brightness: 'Brightness',
  vibrato: 'Vibrato',
  pan: 'Pan',
  pitchBend: 'Pitch bend',
  octave: 'Octave',
  gate: 'Gate',
};
