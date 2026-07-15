/**
 * Recording format registry — an open-closed list of output formats the user can
 * choose for a recording. The live capture is always WebM/Opus (the only
 * container `MediaRecorder` produces natively); each non-native format converts
 * from that on stop, lazily importing its encoder so a format the user never
 * picks costs nothing in the bundle.
 *
 * Adding a format = appending one entry here (no call-site changes) — FLAC (#143)
 * was exactly that. The remaining planned follow-up slots in the same way:
 *   - "Any format" via `ffmpeg.wasm` (a multi-MB lazy chunk, so strictly opt-in
 *     and labelled as a heavy download): same shape, `needsDecode:true`.
 *
 * {@link convertAudioFormats} is the (pure) conversion loop every caller shares:
 * it runs the selected converters in order and reports each one's outcome. A
 * converter that fails yields `blob: null` — NOT the un-encoded native blob — so
 * the caller writes no file and says so, instead of dropping WebM bytes into a
 * `.flac` the player would find unplayable later.
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
  {
    id: 'flac',
    // FLAC is lossless like WAV but ~half the size, and imports into essentially
    // every DAW + Audacity — the license-clean answer (#143) to "a small file that
    // opens in any DAW" (the role MP3 would have filled, but no permissive MP3
    // encoder exists). The compression level is the encoder's constant (`./flac`),
    // not restated here (naming it would force an eager import of the lazy module).
    label: 'FLAC (lossless, compressed)',
    ext: 'flac',
    needsDecode: true,
    load: async () => {
      // Two lazy hops on purpose: this `import()` splits `./flac` off, and `./flac`
      // only pulls in libflacjs itself when it actually encodes — so neither the
      // adapter nor the ~190 kB encoder is in the main bundle.
      const { encodeFlac } = await import('./flac');
      return ({ audio }) => {
        if (!audio) throw new Error('FLAC export needs decoded audio');
        return encodeFlac(audio);
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

/** What one selected format produced. `blob === null` means the converter failed
 * (its encoder would not load, or would not encode this audio) — the caller must
 * write NO file for it and report the failure. */
export interface ConvertedFormat {
  id: string;
  blob: Blob | null;
  /** Why it failed. Only set when `blob` is null. */
  error?: unknown;
}

/**
 * Run each selected format's converter over one take, in order. Returns one
 * outcome per requested id, positionally aligned with `ids` (so it lines up with
 * the audio files `planRecording` laid out from the same ids) — a failure is a
 * `null` blob in place, never a dropped or substituted entry.
 *
 * Failures are contained per format: a broken FLAC encoder must not cost the
 * player the WAV they also asked for.
 */
export async function convertAudioFormats(
  ids: readonly string[],
  input: ConverterInput,
): Promise<ConvertedFormat[]> {
  const out: ConvertedFormat[] = [];
  for (const id of ids) {
    const fmt = recordingFormat(id);
    if (!fmt) {
      out.push({ id, blob: null, error: new Error(`Unknown recording format: ${id}`) });
      continue;
    }
    try {
      const convert = await fmt.load();
      out.push({ id, blob: await convert(input) });
    } catch (error) {
      out.push({ id, blob: null, error });
    }
  }
  return out;
}
