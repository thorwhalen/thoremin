/**
 * Recording format registry — an open-closed list of output formats the user can
 * choose for a recording. The live capture is always WebM/Opus (the only
 * container `MediaRecorder` produces natively); each non-native format converts
 * from that on stop, lazily importing its encoder so a format the user never
 * picks costs nothing in the bundle.
 *
 * Adding a format = appending one entry here (no call-site changes). Planned
 * follow-ups slot in the same way:
 *   - MP3 via `lamejs` (small, lazy): `{ id:'mp3', needsDecode:true,
 *     load: async () => { const { encodeMp3 } = await import('./mp3'); ... } }`.
 *   - "Any format" via `ffmpeg.wasm` (heavy, opt-in, lazy): same shape.
 */

/** Inputs available to a converter: the native recording + its decoded audio. */
export interface ConverterInput {
  /** The natively-recorded WebM/Opus blob. */
  native: Blob;
  /** The decoded audio (present iff some selected format `needsDecode`). */
  audio: AudioBuffer | null;
}

export type Converter = (input: ConverterInput) => Blob | Promise<Blob>;

export interface RecordingFormat {
  /** Stable id persisted in settings. */
  id: string;
  /** Human label for the settings UI. */
  label: string;
  /** File extension (the native format derives its ext from the recorder mime). */
  ext: string;
  /** Whether this format needs the decoded `AudioBuffer` (vs the native blob). */
  needsDecode: boolean;
  /** Lazily load the encoder. Keeps unpicked formats out of the bundle. */
  load(): Promise<Converter>;
}

export const RECORDING_FORMATS: RecordingFormat[] = [
  {
    id: 'webm',
    label: 'WebM / Opus (native, fast)',
    ext: 'webm',
    needsDecode: false,
    load: async () => ({ native }) => native,
  },
  {
    id: 'wav',
    label: 'WAV (lossless, larger)',
    ext: 'wav',
    needsDecode: true,
    load: async () => {
      const { encodeWav } = await import('./wav');
      return ({ audio }) => {
        if (!audio) throw new Error('WAV export needs decoded audio');
        return encodeWav(audio);
      };
    },
  },
];

/**
 * The default selection, and the SSOT for it: `RecordingSessionSchema.formats`
 * defaults to a copy of this, and an empty/unknown selection heals back to it
 * (see `audioFormatIds` in `./plan`). Preserves the prior behaviour: native WebM.
 *
 * `readonly` is a type-level guard against our own code mutating the shipped
 * default in place; it is not fixing a runtime aliasing hazard (zod's `z.array`
 * rebuilds the array on each parse, so a parsed session never aliases this).
 */
export const DEFAULT_RECORDING_FORMATS: readonly string[] = ['webm'];

export function recordingFormat(id: string): RecordingFormat | undefined {
  return RECORDING_FORMATS.find((f) => f.id === id);
}
