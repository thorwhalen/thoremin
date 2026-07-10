/**
 * UI descriptors for the overlay settings panel — the data that drives the
 * grouped, collapsible Overlay controls (see DialsControlsPanel `OverlayControls`).
 *
 * Each descriptor names an overlay element (the key into the overlay params) and
 * declares its controls: a primary `show` toggle, optional dependent sub-toggles
 * (disabled when `show` is off), an optional 0..1 slider, and whether it requires
 * an active face mapping. The panel renders these grouped by each element's
 * {@link OverlayElement.category} (from {@link OVERLAY_CATEGORIES}) — so adding a
 * new overlay element is: register it in `OVERLAY_ELEMENTS` (with a category) +
 * its params sub-object + one descriptor here. A test asserts every element has a
 * descriptor, so an element can never be silently un-toggleable in the UI.
 *
 * Kept out of the .tsx so it is importable in plain Node tests without React.
 */
import type { OverlayParams } from '@/nodes/output/canvas_overlay';

export interface OverlayControlDesc {
  /** The overlay element / params key this descriptor controls. */
  name: keyof OverlayParams;
  /** Label for the primary on/off toggle. */
  label: string;
  /** Dependent boolean sub-toggles (disabled when the element's `show` is off). */
  toggles?: { key: string; label: string }[];
  /** A 0..1 slider param (disabled when the element's `show` is off). */
  slider?: { key: string; label: string };
  /** A cue-position select (`.position` = left/right/top/bottom), for HUD cues. */
  position?: boolean;
  /** Only meaningful with an active face mapping (the model must be loaded). */
  needsFace?: boolean;
}

/** Per-element control descriptors, in within-category display order. */
export const OVERLAY_CONTROLS: OverlayControlDesc[] = [
  { name: 'landmarks', label: 'Hand landmarks' },
  { name: 'faceLandmarks', label: 'Face mesh', needsFace: true },
  {
    // Feature Instrumentation Lab (#119). The group selection + normalizer mode
    // are a richer surface (the dedicated Lab panel); the simple toggles here are
    // the panel's on/off + per-meter decorations.
    name: 'featureLab',
    label: 'Feature Lab',
    toggles: [
      { key: 'showMarkers', label: 'Percentile ticks' },
      { key: 'showValues', label: 'Raw values' },
    ],
  },
  { name: 'markers', label: 'Control markers', toggles: [{ key: 'showNotes', label: 'Note names' }] },
  {
    name: 'fingerLines',
    label: 'Finger effect lines',
    toggles: [{ key: 'showLabels', label: 'Value + effect labels' }],
  },
  {
    name: 'fingerBars',
    label: 'Finger bar graph',
    position: true,
  },
  {
    name: 'faceExpression',
    label: 'Face expression',
    toggles: [
      { key: 'topLabel', label: 'Big label on top' },
      { key: 'exprLabels', label: 'Expression names (x-axis)' },
      { key: 'chordLabels', label: 'Chord names (x-axis)' },
    ],
    position: true,
  },
  {
    name: 'chordName',
    label: 'Chord name',
    toggles: [
      { key: 'roman', label: 'Function line' },
      { key: 'nashville', label: 'Nashville (vs Roman)' },
    ],
    position: true,
  },
  { name: 'timbreLevels', label: 'Timbre levels' },
  { name: 'chordGuide', label: 'Chord highlight' },
  {
    name: 'keyboardStrip',
    label: 'Keyboard strip',
    toggles: [
      { key: 'scaleMode', label: 'Scale-only' },
      { key: 'showChordTones', label: 'Chord tones' },
      { key: 'showScaleRoot', label: 'Scale root' },
      { key: 'showLabels', label: 'Note labels' },
    ],
  },
  { name: 'scaleGuide', label: 'Scale guide', toggles: [{ key: 'showLabels', label: 'Note labels' }] },
  { name: 'indexGuide', label: 'Index-finger guide', toggles: [{ key: 'dashed', label: 'Dashed' }] },
  { name: 'video', label: 'Video backdrop', slider: { key: 'alpha', label: 'Opacity' } },
];
