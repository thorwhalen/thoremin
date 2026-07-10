/**
 * `pose-chord` node — the head/face *pose* instrument (issue #76), the `controls`
 * counterpart of the emotion-driven `expression-chord`. It turns the deliberate
 * control axes from `face-controls` into a voiced, rendered diatonic chord, using
 * the EASY default mapping the issue recommends as the first-run instrument:
 *
 *  - **head yaw → scale degree** — sweep the chord-source scale's chords left→right,
 *    a horizontal "keyboard of chords" (one slice per degree, so a shorter source
 *    sweeps monotonically over fewer chords — #75);
 *  - **head pitch → octave register** — nod up/down to shift the chord's octave;
 *  - **jaw-open → gate** — the chord sounds only while the mouth is open (jaw
 *    closed = rest), the most reliable channel as the play/rest control;
 *  - **smile ↔ frown → brightness** — smiling opens the timbre, frowning darkens it;
 *  - **brow-raise → add the diatonic 7th** — a richer chord while both brows are up.
 *
 * It reuses the same voicing / rendering / beat-clock machinery as
 * `expression-chord` (via {@link voiceTriad} / {@link renderGains}) and the same
 * live `chordConfig` settings (sound / volume / voicing / rendering / tempo), so
 * the two chord instruments sound consistent. Voices sit on ids ≥
 * {@link POSE_VOICE_ID_BASE} — above the hand voices (0, 1) AND the
 * expression-chord voices (2..5) — so all three can be unioned into the synth
 * without id collisions. It ALWAYS emits {@link MAX_POSE_VOICES} voices on stable
 * ids (silent when idle), so a vanishing voice never leaves a chord stuck.
 *
 * Active ONLY when `faceMapping === 'controls'`, the controls are present, and a
 * chord-source `spec` is wired — else silent. Since #75 the chord source is decoupled
 * from the melody (auto-derived or custom), so pose chords work on any melody scale.
 * Stateful (a beat clock + strum re-trigger) but deterministic given the tick
 * timing, so it replays exactly.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import { diatonicChord, midiToFreq, SCALE_TYPES, type ScaleSpec } from '@/music/theory';
import { SoundSchema } from '@/music/sounds';
import { VOICINGS, RENDERINGS, voiceTriad, renderGains, type VoicingId, type RenderingId } from '@/music/voicing';
import type { FaceControls, VoiceParams } from '../domain';

/** Pose-chord voices start here — above the hand voices (0, 1) and the
 *  expression-chord voices (2..5), so hand melody + emotion chord + pose chord
 *  can all be merged into the synth without id collisions. */
export const POSE_VOICE_ID_BASE = 6;

/** The largest chord is a voiced triad (up to 4 voices) plus the brow 7th. */
export const MAX_POSE_VOICES = 5;

/** The default number of degrees the head-yaw sweep spans (a seven-note chord
 *  source). Overridden per-tick by the chord-source scale's own length (#75), so the
 *  sweep covers each of ITS degrees exactly once — see {@link yawToDegree}. */
const DEGREE_COUNT = 7;

const Params = z.object({
  /** Volume of the chord (0..1) — gentle by default so it supports a melody. */
  gain: z.number().min(0).max(1).default(0.22),
  /** Instrument timbre for the chord voices. */
  sound: SoundSchema.default('warmPad'),
  /** How the triad is arranged (low bass + upper structure). */
  voicing: z.enum(VOICINGS).default('spread'),
  /** How the voiced chord is played over time. */
  rendering: z.enum(RENDERINGS).default('sustained'),
  /** Tempo (BPM) for the tempo-based renderings. */
  bpm: z.number().min(40).max(200).default(100),
  /** Jaw-open gate: the chord sounds only when `mouthOpen` reaches this (0..1). */
  mouthGate: z.number().min(0).max(1).default(0.12),
  /** Head-pitch octave span: `round(headPitch * octaveRange)` octaves of shift. */
  octaveRange: z.number().int().min(0).max(3).default(1),
  /** Brow-raise threshold to add the diatonic 7th (0..1). */
  browSeventhAt: z.number().min(0).max(1).default(0.5),
});
type Params = z.infer<typeof Params>;

/** Live chord settings from the UI store (override the static params each tick) —
 *  the SAME shape `expression-chord` consumes, so both chord instruments share the
 *  faceChord settings. */
interface ChordConfig {
  sound?: VoiceParams['sound'];
  gain?: number;
  voicing?: VoicingId;
  rendering?: RenderingId;
  bpm?: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const clampSigned = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);

/** Head-yaw [-1,1] → a scale degree 0..(count-1): a left→right sweep of the chord
 *  source's degrees, each occupying an equal slice of the range. `count` is the
 *  chord-source scale's length (#75): deriving it from the scale (not a hardcoded 7)
 *  keeps the sweep MONOTONIC and complete for any source — a 5-note source sweeps
 *  0..4 once (no mid-sweep wrap back to the tonic), a 12-note source reaches all 12
 *  degrees (none unreachable). Defaults to {@link DEGREE_COUNT} when no scale is known. */
export function yawToDegree(headYaw: number, count = DEGREE_COUNT): number {
  const n = count > 0 ? count : DEGREE_COUNT;
  const t = (clampSigned(headYaw) + 1) / 2; // [-1,1] → [0,1]
  const d = Math.floor(t * n);
  return d < 0 ? 0 : d >= n ? n - 1 : d;
}

export const poseChordNode = defineNode<Params>({
  type: 'pose-chord',
  roles: ['music'],
  title: 'Pose Chord',
  description:
    'Head/face pose axes → a voiced, rendered diatonic chord (head-yaw→degree, pitch→octave, jaw-open→gate, smile→timbre, brow→7th). Active only in face "controls" mode.',
  inputs: [
    { name: 'controls', kind: 'face-controls' },
    { name: 'spec', kind: 'scale-spec' },
    { name: 'faceMapping', kind: 'face-mapping', default: 'none' },
    // Live keyboard octave shift, so the chord tracks the melody's register.
    { name: 'octaveShift', kind: 'number', default: 0 },
    // Live chord settings (sound / volume / voicing / rendering / tempo).
    { name: 'chordConfig', kind: 'chord-config' },
  ],
  outputs: [
    { name: 'params', kind: 'synth-params' },
    // The un-voiced chord tones (pitch classes), for an overlay highlight — [] when idle.
    { name: 'chord', kind: 'number[]' },
  ],
  params: Params,
  make(p) {
    let beat = 0;
    let timeSinceChange = 0;
    let lastKey = '';

    const silent = (sound: VoiceParams['sound']): VoiceParams[] =>
      Array.from({ length: MAX_POSE_VOICES }, (_, i) => ({
        id: POSE_VOICE_ID_BASE + i,
        present: false,
        freq: midiToFreq(60),
        gain: 0,
        sound,
      }));

    return {
      process(inputs, ctx: NodeContext) {
        const cfg = (inputs.chordConfig as ChordConfig | undefined) ?? {};
        const sound = cfg.sound ?? p.sound;
        const gain = cfg.gain ?? p.gain;
        const voicing = cfg.voicing ?? p.voicing;
        const rendering = cfg.rendering ?? p.rendering;
        const bpm = cfg.bpm ?? p.bpm;

        const controls = inputs.controls as FaceControls | undefined;
        const spec = inputs.spec as ScaleSpec | undefined;
        const baseShift = typeof inputs.octaveShift === 'number' ? inputs.octaveShift : 0;
        const active = inputs.faceMapping === 'controls' && !!controls && controls.present && !!spec;

        // The jaw gates play/rest: no sound until the mouth opens past the gate.
        const sounding = active && (controls as FaceControls).mouthOpen >= p.mouthGate;

        const dt = typeof ctx?.dt === 'number' && Number.isFinite(ctx.dt) ? ctx.dt : 0;
        beat += (bpm / 60) * dt;

        if (!sounding) {
          // Keep the clock running (so re-articulation stays phase-consistent) but
          // reset the chord key so the next onset strums fresh.
          lastKey = '';
          timeSinceChange = 0;
          return { params: { voices: silent(sound) }, chord: [] };
        }

        const c = controls as FaceControls;
        // Sweep across the chord-SOURCE scale's own degrees (#75), so a non-seven-note
        // source stays monotonic and fully reachable.
        const degree = yawToDegree(c.headYaw, SCALE_TYPES[spec!.type].intervals.length);
        // Head pitch sweeps the octave; brow raises add the diatonic 7th.
        const octaveShift = baseShift + Math.round(clampSigned(c.headPitch) * p.octaveRange);
        const withSeventh = c.browRaise >= p.browSeventhAt;
        // Smile↔frown opens/darkens the timbre: -1 → 0 (dark), 0 → 0.5, +1 → 1 (bright).
        const brightness = clamp01(0.5 + 0.5 * c.smileFrown);

        const tones = diatonicChord(spec!, degree, withSeventh ? 4 : 3);
        const triad = tones.slice(0, 3);
        let voiced = triad.length >= 3 ? voiceTriad(triad, voicing, octaveShift) : [];
        if (withSeventh && tones.length >= 4) {
          // Add the diatonic 7th one register up with the chord (kept in the voiced
          // structure's octave via the same shift), then re-sort ascending so an
          // arpeggio still traverses low→high by actual pitch.
          voiced = [...voiced, tones[3] + 12 * octaveShift];
        }
        voiced = voiced.sort((a, b) => a - b);

        if (voiced.length === 0) return { params: { voices: silent(sound) }, chord: [] };

        // Restart the strum on any genuine chord change (the sounding pitches).
        const key = voiced.join(',');
        if (key !== lastKey) {
          timeSinceChange = 0;
          lastKey = key;
        } else {
          timeSinceChange += dt;
        }

        const gains = renderGains(voiced.length, rendering, beat, timeSinceChange);
        const voices: VoiceParams[] = [];
        for (let i = 0; i < MAX_POSE_VOICES; i++) {
          const midi = voiced[i];
          const raw = gains[i];
          const g = midi !== undefined && Number.isFinite(raw) ? gain * raw : 0;
          voices.push({
            id: POSE_VOICE_ID_BASE + i,
            present: g > 0,
            freq: midiToFreq(midi ?? 60),
            gain: g,
            sound,
            brightness,
          });
        }
        return { params: { voices }, chord: tones };
      },
    };
  },
});
