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

/**
 * Which UI SURFACE owns an overlay element's controls.
 *
 * `'instrument'` — the Overlay section of the per-instrument settings panel: the
 * element is a property of the instrument, saved and loaded with it.
 *
 * `'lab'` — the Feature Lab panel ({@link LabPanel}), a TOOLING surface reached from
 * the app shell's tools bar. Its element's config is per-device, not per-instrument.
 *
 * This field exists because the old invariant ("every element has a descriptor") was
 * satisfied while the Feature Lab was, in practice, unreachable (#136): a descriptor
 * proves an element is *controllable*, not that a player can *find* the control. Every
 * surface named here must be reachable from the app shell — `tools.ts` is the registry
 * of shell surfaces and a test ties the two together.
 */
export type OverlaySurface = 'instrument' | 'lab';

export interface OverlayControlDesc {
  /** The overlay ELEMENT this descriptor controls. Usually also the params key — see
   *  {@link OverlayControlDesc.configKey} for the exception. */
  name: string;
  /**
   * The params sub-object this descriptor's controls write, when it differs from
   * {@link OverlayControlDesc.name}. Mirrors `OverlayElement.configKey`: the correlation
   * matrix (#150) is its own element but is configured by the `featureLab` block, because
   * it is a Lab diagnostic and must not become an instrument parameter (#136).
   *
   * Only ever set on `surface: 'lab'` descriptors — the instrument panel builds
   * `overlay.<name>.<field>` dispatch paths straight from `name`, and a test pins that
   * assumption rather than leaving it to be discovered by a control that silently
   * refuses every write.
   */
  configKey?: keyof OverlayParams;
  /** Label for the primary on/off toggle. */
  label: string;
  /** Which UI surface renders this descriptor. Defaults to the instrument's Overlay
   *  panel; see {@link OverlaySurface}. */
  surface?: OverlaySurface;
  /** Dependent boolean sub-toggles (disabled when the element's `show` is off). */
  toggles?: { key: string; label: string }[];
  /** A 0..1 slider param (disabled when the element's `show` is off). */
  slider?: { key: string; label: string };
  /** A cue-position select (`.position` = left/right/top/bottom), for HUD cues. */
  position?: boolean;
  /** Only meaningful with an active face mapping (the model must be loaded). */
  needsFace?: boolean;
}

/** Per-element control descriptors, in within-category display order. Every overlay
 *  element has exactly one (a test enforces it) — but see {@link OverlaySurface}: the
 *  descriptor says *what* the control is, `surface` says *where the player finds it*. */
export const OVERLAY_CONTROLS: OverlayControlDesc[] = [
  { name: 'landmarks', label: 'Hand landmarks' },
  { name: 'faceLandmarks', label: 'Face mesh', needsFace: true },
  {
    // Feature Instrumentation Lab (#119) — owned by the LAB panel, not the instrument's
    // Overlay section: the Lab measures the instrument, so its config is a per-device
    // tooling pref rather than a saved instrument parameter (#136).
    name: 'featureLab',
    label: 'Feature Lab',
    surface: 'lab',
    toggles: [
      { key: 'showMarkers', label: 'Percentile ticks' },
      { key: 'showValues', label: 'Raw values' },
    ],
  },
  {
    // The Lab's rolling correlation matrix (#150). Its own element (the meters panel is
    // already dense), configured by the `featureLab` block it belongs to — hence
    // `configKey`. Its controls are hand-rendered in LabControls, like every other
    // featureLab field (`normalizer`, `columns`, `derived`); this descriptor exists so
    // the element↔descriptor invariant stays exact.
    name: 'featureCorrelation',
    configKey: 'featureLab',
    label: 'Correlation matrix',
    surface: 'lab',
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
  // Live tagging (#92): the burned-in corner HUD (open tags + timecode) that composits
  // into the recorded video. Shown only while a take records; toggle to hide the burn-in.
  { name: 'tagHud', label: 'Annotation HUD (recorded)' },
  // Trainer guidance on the video (#163): the instruction + nudges while a routine
  // runs. Shown only then; toggle to keep the video clean during training.
  { name: 'trainerHud', label: 'Trainer guidance' },
];

/** The descriptors rendered by a given UI surface. `surface` is optional on a
 *  descriptor (the instrument's Overlay panel is the default home), so the filter
 *  defaults the same way — a new element lands in the instrument panel unless it
 *  explicitly names another home. */
export const controlsForSurface = (surface: OverlaySurface): OverlayControlDesc[] =>
  OVERLAY_CONTROLS.filter((d) => (d.surface ?? 'instrument') === surface);
