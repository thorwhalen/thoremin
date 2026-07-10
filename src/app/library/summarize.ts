/**
 * summarizeInstrument — a pure `Settings -> InstrumentSummary` reduction: the compact,
 * human-facing "what is this instrument" projection shared by the parametrization
 * tooltip (issue #115) and the system-tag derivation (issue #114, which reads the same
 * scale-quality / face-mode / note-source facts). Kept dependency-free and framework-
 * agnostic so it is unit-tested directly and reused wherever an instrument must be
 * described without opening its full settings editor.
 *
 * "More than the list row, less than the settings": it names the scale, the two voices,
 * the control sources (note source, face mode, finger FX), and only the *non-default*
 * master tweaks — so the tooltip stays a glance, not a second editor.
 */
import { NOTES, SCALE_TYPES, type ScaleTypeId } from '@/music/theory';
import { SOUNDS, type SoundId } from '@/music/sounds';
import type { Settings } from '@/settings/schema';
import type { PositionSource, FingerTarget } from '@/nodes/mapping/hand_map';
import type { FingerName } from '@/nodes/domain';

/** The coarse scale quality used for the scale-quality system tag + the tooltip. */
export type ScaleQuality =
  | 'major'
  | 'minor'
  | 'pentatonicMajor'
  | 'pentatonicMinor'
  | 'blues'
  | 'chromatic';

/** What the face drives, collapsed to the four meaningful modes (see FACE_MAPPINGS). */
export type FaceMode = 'none' | 'expression' | 'chord' | 'pose';

/** One active finger->effect routing (only fingers whose target is not `none`). */
export interface FingerFx {
  finger: FingerName;
  target: FingerTarget;
}

/** The compact projection of an instrument's settings. */
export interface InstrumentSummary {
  /** Right-hand root pitch class (0..11) and its note name. */
  root: number;
  rootName: string;
  /** Coarse quality + the scale's display name + the combined "D Minor Pentatonic". */
  scaleQuality: ScaleQuality;
  scaleName: string;
  scaleLabel: string;
  /** The two voices' sound display names + whether the hands are synced. */
  rightSound: string;
  leftSound: string;
  syncHands: boolean;
  /** Right-hand voicing extent (base octave + how many octaves it spans). */
  baseOctave: number;
  octaves: number;
  /** Note-selection source (index fingertip vs wrist) and the face mode. */
  noteSource: PositionSource;
  faceMode: FaceMode;
  /** Active finger->effect routings (empty when no finger is routed). */
  fingerFx: FingerFx[];
  /** Master tweaks (the caller decides which to show — see {@link summaryLines}). */
  masterVolume: number;
  magnetism: number;
  octaveShift: number;
}

/** Coarse quality of a scale type; exhaustive over {@link ScaleTypeId}. */
export function scaleQualityOf(type: ScaleTypeId): ScaleQuality {
  switch (type) {
    case 'major':
      return 'major';
    case 'minor':
    case 'minorHarmonic':
      return 'minor';
    case 'pentatonic':
      return 'pentatonicMajor';
    case 'minorPentatonic':
      return 'pentatonicMinor';
    case 'blues':
      return 'blues';
    case 'chromatic':
      return 'chromatic';
    default: {
      // Exhaustiveness guard: a new scale id must extend the mapping above.
      const _never: never = type;
      return _never;
    }
  }
}

/** Collapse the four-value face mapping onto the tooltip/system-tag mode vocabulary. */
export function faceModeOf(faceMapping: Settings['faceMapping']): FaceMode {
  switch (faceMapping) {
    case 'none':
      return 'none';
    case 'timbre':
      return 'expression';
    case 'chord':
      return 'chord';
    case 'controls':
      return 'pose';
    default: {
      const _never: never = faceMapping;
      return _never;
    }
  }
}

const FINGER_ORDER: readonly FingerName[] = ['index', 'middle', 'ring', 'pinky'];

/** The active finger->effect routings, in a stable finger order. */
export function activeFingerFx(handMap: Settings['handMap']): FingerFx[] {
  return FINGER_ORDER.flatMap((finger) => {
    const target = handMap.fingers[finger]?.target;
    return target && target !== 'none' ? [{ finger, target }] : [];
  });
}

/** The compact projection of one instrument's settings. */
export function summarizeInstrument(s: Settings): InstrumentSummary {
  const scaleName = SCALE_TYPES[s.right.type].name;
  const rootName = NOTES[((s.right.root % 12) + 12) % 12];
  return {
    root: s.right.root,
    rootName,
    scaleQuality: scaleQualityOf(s.right.type),
    scaleName,
    scaleLabel: `${rootName} ${scaleName}`,
    rightSound: soundName(s.right.sound),
    leftSound: soundName(s.left.sound),
    syncHands: s.syncHands,
    baseOctave: s.right.baseOctave,
    octaves: s.right.octaves,
    noteSource: s.handMap.positionSource,
    faceMode: faceModeOf(s.faceMapping),
    fingerFx: activeFingerFx(s.handMap),
    masterVolume: s.masterVolume,
    magnetism: s.magnetism,
    octaveShift: s.octaveShift,
  };
}

/** Display name for a sound id (falls back to the raw id if ever unknown). */
function soundName(id: SoundId): string {
  return SOUNDS[id]?.name ?? id;
}

/** Human label for a finger->effect target (e.g. `pitchBend` -> "pitch bend"). */
export function fingerTargetLabel(target: FingerTarget): string {
  return target.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/** Human label for the face mode. */
export function faceModeLabel(mode: FaceMode): string {
  switch (mode) {
    case 'none':
      return 'none';
    case 'expression':
      return 'expression → timbre';
    case 'chord':
      return 'emotion → chord';
    case 'pose':
      return 'head/face pose';
  }
}

/** One label/value row of the tooltip. */
export interface SummaryLine {
  label: string;
  value: string;
}

/** Master-field defaults — a field is shown in the tooltip only when it differs. */
const MASTER_DEFAULTS = { masterVolume: 0.4, magnetism: 0.8, octaveShift: 0 } as const;

/**
 * Format a summary as the compact tooltip rows (issue #115): scale, voices, controls,
 * and only the *non-default* master tweaks. Pure, so the exact wording is unit-tested.
 */
export function summaryLines(sum: InstrumentSummary): SummaryLine[] {
  const lines: SummaryLine[] = [];
  lines.push({ label: 'Scale', value: sum.scaleLabel });

  // Each hand always keeps its OWN sound (syncHands only syncs scale/root/octaves), so
  // the voices line is driven by whether the two SOUNDS differ — not by syncHands. The
  // sync state is a separate range annotation, never a claim that the timbres match.
  const both =
    sum.rightSound === sum.leftSound ? sum.rightSound : `${sum.rightSound} / ${sum.leftSound}`;
  lines.push({ label: 'Voices', value: sum.syncHands ? `${both} (synced range)` : both });
  lines.push({
    label: 'Range',
    value: `octave ${sum.baseOctave}, ${sum.octaves} oct${sum.octaves === 1 ? '' : 's'}`,
  });

  lines.push({ label: 'Notes', value: `${sum.noteSource}-controlled` });
  if (sum.faceMode !== 'none') lines.push({ label: 'Face', value: faceModeLabel(sum.faceMode) });
  if (sum.fingerFx.length > 0) {
    lines.push({
      label: 'Finger FX',
      value: sum.fingerFx.map((f) => `${f.finger}→${fingerTargetLabel(f.target)}`).join(', '),
    });
  }

  if (sum.masterVolume !== MASTER_DEFAULTS.masterVolume) {
    lines.push({ label: 'Volume', value: `${Math.round(sum.masterVolume * 100)}%` });
  }
  if (sum.magnetism !== MASTER_DEFAULTS.magnetism) {
    lines.push({ label: 'Magnetism', value: `${Math.round(sum.magnetism * 100)}%` });
  }
  if (sum.octaveShift !== MASTER_DEFAULTS.octaveShift) {
    lines.push({ label: 'Octave shift', value: sum.octaveShift > 0 ? `+${sum.octaveShift}` : `${sum.octaveShift}` });
  }
  return lines;
}
