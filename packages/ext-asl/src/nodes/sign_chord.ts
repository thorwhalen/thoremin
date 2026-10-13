/**
 * `sign-chord` node: the letters A to G, signed, play chords of the key (the ASL chords
 * instrument).
 *
 * A letter names the chord whose root is spelled with that letter in the key, accidentals
 * included: in D major, F is F#m (iii) and C is C#dim (vii°) — `letterDegree` in the SDK's
 * theory. The key is the chord source the face chords use (`chordSpec`: auto from the
 * melody scale, or the custom key in the chord settings), read through its seven-note
 * embedding so a pentatonic key spells like its parent. Voicing, rendering, sound and volume
 * are the face chords' too (`chordConfig`), so one chord section sets both instruments.
 *
 * With `holdChord` (the default) the last chord keeps sounding while the hand signs other
 * things, because passing from one letter to the next goes through shapes that are no
 * letter at all; it stops when the hand leaves. Without it, a chord sounds only while A..G is
 * named. Always emits {@link MAX_SIGN_CHORD_VOICES} voices on stable ids (a voice that
 * vanished from the array would hang in the synth), on ids clear of the hands' and the face
 * chord's.
 */
import { z } from 'zod';
import { defineNode, type NodeContext } from '@thoremin/dag';
import { classifyChord, diatonicTriad, letterChordSpec, letterDegree, midiToFreq, NOTES, NOTE_LETTERS, spellOnLetter, type NoteLetter, type ScaleSpec } from '@thoremin/sdk/music/theory';
import { SoundSchema } from '@thoremin/sdk/music/sounds';
import { RENDERINGS, VOICINGS, renderGains, voiceTriad, type RenderingId, type VoicingId } from '@thoremin/sdk/music/voicing';
import type { VoiceParams } from '@thoremin/sdk/nodes/domain';
import type { SignScores } from '@thoremin/asl';
import { DEFAULT_ASL_DIAL, type AslDialParams } from '../schema';

/** Sign-chord voices start here: far from every other producer's ids (the hands 0..1, the
 *  face and pose chords 2..10, the conducted score from 11 up by note, the flute's 1e6), so
 *  no voice of another branch ever shares one. */
export const SIGN_CHORD_VOICE_ID_BASE = 2_000_000;
export const MAX_SIGN_CHORD_VOICES = 4;

const Params = z.object({
  gain: z.number().min(0).max(1).default(0.3),
  sound: SoundSchema.default('triangle'),
  voicing: z.enum(VOICINGS).default('spread'),
  rendering: z.enum(RENDERINGS).default('sustained'),
  bpm: z.number().min(40).max(200).default(100),
});
type Params = z.infer<typeof Params>;

interface ChordConfig {
  sound?: VoiceParams['sound'];
  gain?: number;
  voicing?: VoicingId;
  rendering?: RenderingId;
  bpm?: number;
}

const isChordLetter = (id: string | null): id is NoteLetter => !!id && (NOTE_LETTERS as readonly string[]).includes(id);

/** The triad a chord letter plays in a key (empty when `spec` is missing). */
export function letterTriad(spec: ScaleSpec | undefined, letter: NoteLetter): number[] {
  if (!spec) return [];
  return diatonicTriad(letterChordSpec(spec), letterDegree(spec, letter));
}

/** The chord a letter plays, spelled ON that letter ("Bb" in F major, never "A#"; "F#m" in
 *  D major), so what is written under a bar is the letter that was signed. */
export function letterChordName(spec: ScaleSpec | undefined, letter: NoteLetter): string {
  const triad = letterTriad(spec, letter);
  const info = triad.length ? classifyChord(triad) : null;
  if (!info) return '';
  return spellOnLetter(info.root, letter) + info.symbol.slice(NOTES[info.root]!.length);
}

/** Per-sign captions: the chord name under A..G, '' under every other sign. */
export function chordCaptions(spec: ScaleSpec | undefined, labels: readonly string[]): string[] {
  return labels.map((id) => (isChordLetter(id) && spec ? letterChordName(spec, id) : ''));
}

export const signChordNode = defineNode<Params>({
  type: 'sign-chord',
  roles: ['music'],
  title: 'Sign Chord',
  description: 'ASL letters A..G → the diatonic chord of the key whose root has that letter name (accidentals of the key applied), voiced and rendered like the face chords.',
  inputs: [
    { name: 'reading', kind: 'asl-reading' },
    { name: 'spec', kind: 'scale-spec' },
    { name: 'chordConfig', kind: 'chord-config' },
    { name: 'octaveShift', kind: 'number', default: 0 },
    { name: 'config', kind: 'asl-config' },
  ],
  outputs: [
    { name: 'params', kind: 'synth-params' },
    { name: 'triad', kind: 'number[]' },
    { name: 'captions', kind: 'string[]' },
  ],
  params: Params,
  make(p) {
    let beat = 0;
    let timeSinceChange = 0;
    let lastKey = '';
    let held: NoteLetter | null = null;
    let captionKey = '';
    let captions: string[] = [];

    const voicesOf = (voiced: number[], gains: number[], gain: number, sound: VoiceParams['sound']): VoiceParams[] =>
      Array.from({ length: MAX_SIGN_CHORD_VOICES }, (_, i) => {
        const midi = voiced[i];
        const raw = gains[i];
        const g = midi !== undefined && raw !== undefined && Number.isFinite(raw) ? gain * raw : 0;
        return { id: SIGN_CHORD_VOICE_ID_BASE + i, present: g > 0, freq: midiToFreq(midi ?? 60), gain: g, sound };
      });

    return {
      process(inputs, ctx: NodeContext) {
        const cfg = (inputs.chordConfig as ChordConfig | undefined) ?? {};
        const sound = cfg.sound ?? p.sound;
        const gain = cfg.gain ?? p.gain;
        const voicing = cfg.voicing ?? p.voicing;
        const rendering = cfg.rendering ?? p.rendering;
        const bpm = cfg.bpm ?? p.bpm;
        const asl: AslDialParams = { ...DEFAULT_ASL_DIAL, ...((inputs.config as Partial<AslDialParams> | undefined) ?? {}) };
        const reading = inputs.reading as SignScores | undefined;
        const spec = inputs.spec as ScaleSpec | undefined;
        const shift = typeof inputs.octaveShift === 'number' ? inputs.octaveShift : 0;

        const active = asl.enabled && asl.chords && !!reading?.present && !!spec;
        const named = reading?.label ?? null;
        if (!active) held = null;
        else if (isChordLetter(named)) held = named;
        else if (!asl.holdChord) held = null;

        const triad = held ? letterTriad(spec, held) : [];
        const voiced = (triad.length ? voiceTriad(triad, voicing, shift) : []).sort((a, b) => a - b);

        const dt = Number.isFinite(ctx?.dt) ? ctx.dt : 0;
        beat += (bpm / 60) * dt;
        const key = voiced.join(',');
        if (key !== lastKey) {
          timeSinceChange = 0;
          lastKey = key;
        } else timeSinceChange += dt;

        const labels = reading?.labels ?? [];
        const ck = `${spec?.root}|${spec?.type}|${spec?.baseOctave}|${labels.length}|${asl.chords}`;
        if (ck !== captionKey) {
          captionKey = ck;
          captions = asl.chords ? chordCaptions(spec, labels) : [];
        }

        const gains = voiced.length ? renderGains(voiced.length, rendering, beat, timeSinceChange) : [];
        return { params: { voices: voicesOf(voiced, gains, gain, sound) }, triad, captions };
      },
    };
  },
});
