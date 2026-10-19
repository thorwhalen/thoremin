/**
 * The canvas overlay's CONTRACT, importable without the overlay's 2,300 lines of drawing code
 * (the `<node>.schema.ts` pattern, #600 S6; started by S5): its core input ports and its params
 * schemas (the node's, and the overlay DIAL's, which the settings schema and the hot store read). The overlay
 * node (`canvas_overlay.ts`) spreads them and adds one port per input of each element an
 * extension contributes (`overlay_contributions.ts`), plus the category pools the composer
 * allocates the branches' category readers into ({@link categoryPoolInputs}, #600 S10b).
 */
import { z } from 'zod';
import type { PortSpec } from '@thoremin/dag';
import { FeatureLabSchema } from '@/features/labConfig';

/** The overlay's core input ports (every overlay has them; an extension's elements add theirs). */
export const OVERLAY_CORE_INPUTS: readonly PortSpec[] = [
  { name: 'hands', kind: 'hands-frame' },
  { name: 'features', kind: 'hand-features' },
  { name: 'params', kind: 'synth-params' },
  { name: 'scale', kind: 'number[]' },
  { name: 'scaleLeft', kind: 'number[]' },
  { name: 'chordScale', kind: 'number[]' },
  { name: 'chord', kind: 'number[]' },
  { name: 'faceFrame', kind: 'face-frame' },
  // The body branch (#186): the latest pose + the model's load state, for the skeleton.
  { name: 'bodyFrame', kind: 'body-frame' },
  { name: 'bodyStatus', kind: 'body-status' },
  // The conductor (#187): its musical time + enable flag, for the beat HUD.
  { name: 'conductorTime', kind: 'musical-time' },
  { name: 'conductorEnabled', kind: 'boolean', default: false },
  // A node's on-screen targets (the chord map's), for the cell grid.
  { name: 'expression', kind: 'face-expression' },
  // A personal categorizer's per-category degrees (#330 P4), for its bars' chord names.
  { name: 'categoryDegrees', kind: 'category-degrees' },
  { name: 'categoryTargets', kind: 'category-targets' },
  { name: 'octaveShift', kind: 'number', default: 0 },
  { name: 'overlayConfig', kind: 'overlay-config' },
  // LEGACY (#600 S10b, expand): the ASL reader's reading and captions, wired by name by the pinned
  // ASL plugin, read as the first classifier ahead of the pool. Removed once the plugin declares
  // `categories` / `categoryCaptions` on its branches (the contract step).
  { name: 'categories', kind: 'category-scores' },
  { name: 'categoryCaptions', kind: 'string[]' },
  // The composed graph's element set (the ADR, §3.2 rule 4): which elements exist for
  // the current instrument. Absent → every element (headless tests, pre-composition).
  { name: 'elements', kind: 'string[]' },
  // Raw feature vectors for the Feature Lab (#119). Additive: the vector nodes
  // tap the existing camFace/cam edges; the lab element normalizes + draws them.
  { name: 'faceVector', kind: 'feature-vector' },
  { name: 'handVector', kind: 'feature-vector' },
  { name: 'bodyVector', kind: 'feature-vector' },
];

/** How many category readers of each kind the overlay takes (#600 S10b), sized by the contribution
 *  registry from every branch there is. */
export interface CategoryPoolSizes {
  classifier: number;
  categorizer: number;
}

/** The category pools' input names, in priority order: `classifier1`.., `categorizer1`... */
export function categoryPool(kind: keyof CategoryPoolSizes, size: number): readonly string[] {
  return Array.from({ length: size }, (_, i) => `${kind}${i + 1}`);
}

/** The captions input beside a classifier slot (`classifier1` -> `classifier1Captions`). */
export const captionsPort = (slot: string): string => `${slot}Captions`;

/** The overlay's category pool inputs for `sizes`: each slot's `category-scores`, and each
 *  classifier slot's captions. */
export function categoryPoolInputs(sizes: CategoryPoolSizes): PortSpec[] {
  return [
    ...categoryPool('classifier', sizes.classifier).flatMap((slot): PortSpec[] => [
      { name: slot, kind: 'category-scores' },
      { name: captionsPort(slot), kind: 'string[]' },
    ]),
    ...categoryPool('categorizer', sizes.categorizer).map((slot): PortSpec => ({ name: slot, kind: 'category-scores' })),
  ];
}

/** Which screen edge a HUD cue is placed on. */
export const CuePositionEnum = z.enum(['left', 'right', 'top', 'bottom']);
export type CuePosition = z.infer<typeof CuePositionEnum>;

/**
 * Per-element configuration. Each element has its own sub-object so it can be
 * toggled and parameterized independently.
 */
/** The trainer HUD's params — exported so the control store can carry the per-device
 *  pref in exactly this shape and `store-controls` can compose it in. */
export const TrainerHudParamsSchema = z
  .object({
    /** Off by default since the Trainer's own banner moved above every panel (the
     *  on-screen instruction lives there now); on, the same words are also painted INTO
     *  the video, which a screen recording of the composited canvas then carries. */
    show: z.boolean().default(false),
    /** Which edge the banner anchors to. */
    position: z.enum(['bottom', 'top']).default('bottom'),
  })
  .prefault({});
export type TrainerHudParams = z.infer<typeof TrainerHudParamsSchema>;

const Params = z.object({
  /** Mirrored webcam backdrop. `alpha` is the "grey-out" amount (0 = hidden). */
  video: z.object({ show: z.boolean().default(true), alpha: z.number().min(0).max(1).default(0.35) }).prefault({}),
  /** Faint vertical guide at each scale note (a "fretboard"), with note labels. */
  scaleGuide: z.object({ show: z.boolean().default(true), showLabels: z.boolean().default(true) }).prefault({}),
  /** Highlight the face-driven chord's tones on the pitch guide (face chord mode). */
  chordGuide: z.object({ show: z.boolean().default(true) }).prefault({}),
  /** Dashed vertical line from each index fingertip to the frame edge. Opt-in. */
  indexGuide: z.object({ show: z.boolean().default(false), dashed: z.boolean().default(true) }).prefault({}),
  /** Hand landmark dots + a ring around each hand's active note source. */
  landmarks: z.object({ show: z.boolean().default(true) }).prefault({}),
  /** Per-hand control marker at the note source (openness = ring size, pinch = fill). */
  markers: z.object({ show: z.boolean().default(true), showNotes: z.boolean().default(true) }).prefault({}),
  /** Lines from each ROUTED fingertip to the thumb, labelled value + effect. Opt-in. */
  fingerLines: z.object({ show: z.boolean().default(false), showLabels: z.boolean().default(true) }).prefault({}),
  /** The detected face mesh (input feature) — available when a face mapping is on. */
  faceLandmarks: z.object({ show: z.boolean().default(true) }).prefault({}),
  /** The full-body skeleton (#186) — drawn when body tracking is on; shows the load state. */
  bodySkeleton: z.object({ show: z.boolean().default(true) }).prefault({}),
  /** The conductor's beat over the video (#187): a phase ring that fills through each
   *  beat and flashes on it, the beat-in-bar count, the tempo, and the follower's state
   *  (waiting / holding). Draws only while conducting is on. */
  conductorHud: z.object({ show: z.boolean().default(true) }).prefault({}),
  /** LEGACY (#600 S10, the expand step): the air drum's pads are the air extension's overlay
   *  element now, and their show flag is `airDrum.padsOnVideo`, which a stored or saved value here
   *  is moved into (the air drum dial's v1 -> v2 step). Still accepted on read until the contract
   *  step removes it; marked `legacy`, so it is not a settable path (commands, palette, assistant). */
  drumPads: z.object({ show: z.boolean().default(true) }).prefault({}).meta({ legacy: true }),
  /** LEGACY (#610 item 4, the expand step, as S10 did for the drum pads): the chord map's grid is
   *  the air extension's overlay element now, and its show flag is `chordMap.gridOnVideo`, which
   *  a stored or saved value here is moved into (the chord map dial's v1 -> v2 step). Still
   *  accepted on read until the contract step removes it; marked `legacy`, so it is not a
   *  settable path (commands, palette, assistant). */
  cellGrid: z.object({ show: z.boolean().default(true) }).prefault({}).meta({ legacy: true }),
  /** Per-hand brightness/vibrato level bars (output feature). Opt-in. */
  timbreLevels: z.object({ show: z.boolean().default(false) }).prefault({}),
  /** LEGACY (#600 S10, the expand step): the air flute's breath cue is the air extension's
   *  overlay cue now, and its options are `airFlute.breathCue`, which a stored or saved value
   *  here is moved into (the air flute dial's v1 -> v2 step). Still accepted on read until the
   *  contract step removes it; marked `legacy`, so it is not a settable path. */
  mouthCue: z.object({ show: z.boolean().default(true), position: CuePositionEnum.default('left') }).prefault({}).meta({ legacy: true }),
  /**
   * Face-expression bar graph (HUD cue): a bar + firing tick per emotion; the winner
   * is highlighted. Optional vertical x-axis labels (the expression name and/or the
   * chord each maps to) replace the old top label.
   */
  faceExpression: z
    .object({
      show: z.boolean().default(true),
      position: CuePositionEnum.default('left'),
      /** The big winning-label text above the bars (superseded by the highlight). */
      topLabel: z.boolean().default(false),
      /** x-axis: the expression name under each bar (vertical). */
      exprLabels: z.boolean().default(true),
      /** x-axis: the chord each expression maps to, under each bar (vertical). */
      chordLabels: z.boolean().default(true),
    })
    .prefault({}),
  /**
   * A classifier's reading (the ASL sign reader), named large: the class currently named
   * (a letter, a word), gold on a dark plate. `size` scales it (0 = 40 px, 1 = 200 px).
   * Drawn only while a branch that produces a reading is composed.
   */
  categoryLabel: z
    .object({
      show: z.boolean().default(true),
      position: CuePositionEnum.default('top'),
      size: z.number().min(0).max(1).default(0.45),
    })
    .prefault({}),
  /**
   * The same reading as a bar per class (the face-expression idiom), the named one gold.
   * `captions` adds a second label under a bar when the producer sends one (the chord a
   * letter plays).
   */
  categoryBars: z
    .object({
      show: z.boolean().default(true),
      position: CuePositionEnum.default('bottom'),
      captions: z.boolean().default(true),
    })
    .prefault({}),
  /** Finger→effect bar graph (HUD cue): a bar per routed finger, effect-labelled. Opt-in. */
  fingerBars: z
    .object({ show: z.boolean().default(false), position: CuePositionEnum.default('left') })
    .prefault({}),
  /**
   * Chord-name HUD cue: the sounding chord's jazz symbol (e.g. `Am7`) plus an
   * optional function line — the Roman numeral (`vi7`) or, with `nashville`, the
   * Nashville number (`6m7`) of the chord within the current scale. Only shows
   * while a chord actually sounds (face chord / pose modes).
   */
  chordName: z
    .object({
      show: z.boolean().default(true),
      position: CuePositionEnum.default('top'),
      /** Show the secondary function line (Roman / Nashville) under the symbol. */
      roman: z.boolean().default(true),
      /** Use Nashville numbers instead of Roman numerals for the function line. */
      nashville: z.boolean().default(false),
    })
    .prefault({}),
  /**
   * Keyboard strip (bottom-edge): a thin piano/scale ribbon showing, with a
   * shape+brightness hierarchy, the chord root (gold diamond) ▸ voiced-now (glow)
   * ▸ chord-tone set (faint gold) ▸ scale root (blue ring) over the in-scale keys.
   * `scaleMode` swaps the standard chromatic piano for a decluttered scale-only
   * ribbon. Opt-in (it's a large element).
   */
  keyboardStrip: z
    .object({
      show: z.boolean().default(false),
      /** false = standard chromatic piano; true = scale-only equal cells. */
      scaleMode: z.boolean().default(false),
      /** Strip height as a fraction of the canvas height. */
      height: z.number().min(0.05).max(0.2).default(0.1),
      showLabels: z.boolean().default(false),
      showChordTones: z.boolean().default(true),
      showScaleRoot: z.boolean().default(true),
    })
    .prefault({}),
  /**
   * Feature Instrumentation Lab (#119). The schema lives in `@/features/labConfig`
   * because the Lab is a TOOLING preference, not an instrument parameter: the value
   * is owned by the hot control store (per-device, persisted) and composed into these
   * node params by `store-controls` each tick — it is deliberately NOT part of the
   * `overlay` dial (see {@link OverlayDialSchema} and #136).
   */
  featureLab: FeatureLabSchema,
  /**
   * Live-tagging burned-in corner HUD (#92): while a take is recording with tagging
   * on, paints the open tags + a media timecode + a ~1 Hz REC blink into the
   * composited (and alpha) frames — the in-band "second opinion" that makes stream
   * alignment verifiable in the very pixels a model trains on. A no-op (draws
   * nothing) whenever no take is recording, so it costs nothing the rest of the time.
   */
  tagHud: z
    .object({
      show: z.boolean().default(true),
      /** Which top corner the chip stack anchors to. */
      position: z.enum(['left', 'right']).default('right'),
    })
    .prefault({}),
  /**
   * Trainer guidance ON THE VIDEO (#163 §5): while a routine runs, the active cue's
   * instruction large across the bottom of the frame, the latest nudge beneath it, and
   * a coverage bar — the written channel of what the runner says, where the player is
   * actually looking. A no-op (draws nothing) unless the trainer is running, so it
   * costs nothing the rest of the time. Not burned into the recorded `pureVideo`. A
   * CUE: it takes part in the edge layout, so it stacks with the other cues on its
   * edge instead of painting over them. Per-device (not in the instrument's dial —
   * see {@link OverlayDialSchema}).
   */
  trainerHud: TrainerHudParamsSchema,
});
type Params = z.infer<typeof Params>;

/**
 * The overlay NODE's params — every element, including the Feature Lab. This is the
 * engine-facing contract: `store-controls` composes it each tick from the instrument's
 * overlay dial plus the per-device lab config.
 */
export const OverlayParamsSchema = Params;
export type OverlayParams = Params;

/**
 * The overlay DIAL's schema — the node's params minus `featureLab`, and so the single
 * source of truth for the overlay portion of saved settings and of the overlay settings
 * panel.
 *
 * The Lab is omitted on purpose (#136): it is a measuring tool, not a property of the
 * instrument being measured. Leaving it in the dial meant that toggling a meter marked
 * the instrument as having unsaved edits, and that loading an instrument silently
 * re-configured the meters — the same reason recording settings were moved out of the
 * instrument in #88. The trainer's guidance HUD (#163) is omitted for the same reason:
 * the trainer is a shell TOOL, and hiding a training aid must not edit the instrument.
 * Both are per-device tooling prefs on the control store, composed into this node's
 * params by `store-controls` each tick.
 */
export const OverlayDialSchema = Params.omit({ featureLab: true, trainerHud: true });
export type OverlayDialParams = z.infer<typeof OverlayDialSchema>;

export type OverlayCategory = 'input' | 'output' | 'guide' | 'backdrop';

export const OVERLAY_CATEGORIES: { id: OverlayCategory; label: string; blurb: string }[] = [
  { id: 'input', label: 'Input features', blurb: 'What the camera detected.' },
  { id: 'output', label: 'Output features', blurb: 'What your gestures are mapped to.' },
  { id: 'guide', label: 'Guides', blurb: 'Reference overlays.' },
  { id: 'backdrop', label: 'Backdrop', blurb: 'The video feed.' },
];

/**
 * The category of each core overlay element, by name, in draw order: what the settings panel
 * groups the controls by, readable without the elements' drawing code. `canvas_overlay.ts`'s
 * `OVERLAY_ELEMENTS` must agree with it (`test/overlay_schema.test.ts`).
 */
export const OVERLAY_ELEMENT_CATEGORIES: Readonly<Record<string, OverlayCategory>> = {
  video: 'backdrop',
  scaleGuide: 'guide',
  chordGuide: 'output',
  keyboardStrip: 'guide',
  indexGuide: 'guide',
  faceLandmarks: 'input',
  bodySkeleton: 'input',
  landmarks: 'input',
  conductorHud: 'output',
  markers: 'output',
  fingerLines: 'output',
  timbreLevels: 'output',
  featureLab: 'input',
  featureCorrelation: 'input',
  chordName: 'output',
  faceExpression: 'output',
  categoryLabel: 'output',
  categoryBars: 'output',
  tagHud: 'output',
  trainerHud: 'guide',
  fingerBars: 'output',
};
