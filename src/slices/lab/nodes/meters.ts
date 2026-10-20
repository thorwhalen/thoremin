/**
 * The Feature Lab's overlay element (#119, #150; the Lab slice's since #600 S16b): the meters panel
 * (a right-anchored newspaper grid of online-normalized meters over the raw face, hand and body
 * vectors) and the rolling correlation matrix beside it, one contributed element because they share
 * one statistic: the meter computer (`../lib/labMeters`, which owns the normalizer, the derived
 * formulas and the correlation folder), folded ONCE per tick in `update` and kept in `memo`, so the
 * overlay-only take's second pass never counts a frame twice. The drawing is what core's two
 * elements drew, moved unchanged.
 */
import type { OverlayElementDecl, OverlayElementImpl } from '@thoremin/sdk/instruments/extension';
import { PAD } from '@thoremin/sdk/overlay/bar_graph';
import { clamp01 } from '@thoremin/sdk/features/math';
import { DERIVED_GROUP, FEATURE_BY_ID, FEATURE_GROUPS, type FeatureVector } from '@thoremin/sdk/features/catalog';
import { createLabMeterComputer, type FeatureMeters, type LabMeterComputer } from '../lib/labMeters';
import { pairIndex } from '../lib/labCorrelation';
import { FeatureLabSchema, type FeatureLabConfig } from '../schema';

/** The element's name (its id is `feature-lab/meters`). */
export const LAB_METERS_ELEMENT = 'meters';

/** What it reads: the Lab's config (a derived port of its pref) and the three vectors. */
export const LAB_METERS_DECL: OverlayElementDecl = {
  name: LAB_METERS_ELEMENT,
  category: 'input',
  inputs: [
    { name: 'lab', kind: 'feature-lab-config' },
    { name: 'face', kind: 'feature-vector' },
    { name: 'hand', kind: 'feature-vector' },
    { name: 'body', kind: 'feature-vector' },
  ],
  // Where core's panel drew: above the in-scene elements, below the HUD cues (the first of which
  // is the chord name), so the chord and finger readouts stay legible over it.
  drawBefore: 'chordName',
};

// The overlay's palette, as core's elements use it.
const RIGHT_COLOR = '#10b981';
const FACE_COLOR = '#22d3ee';
const BODY_COLOR = '#7dd3fc';
const CHORD_COLOR = '#f5d142';

/** What the two drawings read: the frame and the Lab's config and statistics. */
interface LabView {
  W: number;
  H: number;
  params: { featureLab: FeatureLabConfig };
  featureMeters?: FeatureMeters;
}
interface LabElement {
  name: string;
  category: string;
  configKey?: string;
  draw(g: CanvasRenderingContext2D, view: LabView): void;
}

// ---- Feature Instrumentation Lab (#119) ------------------------------------

const LAB_COL_W = 168; // px per newspaper column
const LAB_ROW_H = 22; // px per meter row (label + bar)
const LAB_HEADER_H = 16; // px per group header
const LAB_TITLE_H = 22;
const LAB_BAR_H = 6;
const LAB_TOP = 68; // == CUE_TOP_INSET: clear the top-left brand / top-right panel
/**
 * The way out, drawn in the panel's own title row.
 *
 * The meters keep drawing after the Lab panel is closed — deliberate, you watch them
 * while you play — which is exactly how this panel became something players could not
 * get rid of: its off switch is a checkbox INSIDE the panel they had just shut, the
 * config is persisted so a reload brings the bars back, and the Lab is not a dial so
 * the command palette cannot reach it. The tools bar now carries the real control; this
 * line says so, at the thing the player is actually looking at.
 */
const LAB_HINT = 'stop in the Tools bar';
/** Approximate glyph widths (no measureText: the headless recording-canvas test). */
const LAB_TITLE_CHAR_W = 7.6; // bold 13px monospace
const LAB_HINT_CHAR_W = 6; // 10px monospace

/** Terse meter label: the feature id with its group (or the `face.`/`hand.`
 *  prefix) stripped, so the group header carries the context. */
function labFeatureLabel(id: string, group: string): string {
  if (id.startsWith(group + '.')) return id.slice(group.length + 1);
  return id.replace(/^(face|hand)\./, '');
}

/** Truncate text to fit `maxChars` with an ellipsis (monospace-approximate). */
function labClip(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, Math.max(1, maxChars - 1)) + '…';
}

/** Draw one meter (label + normalized bar + percentile ticks + optional value). */
function drawLabMeter(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  label: string,
  level: number,
  markers: number[],
  color: string,
  value: number | undefined,
): void {
  const valueW = value !== undefined ? 34 : 0;
  const barW = Math.max(20, w - valueW);
  // Label.
  g.globalAlpha = 0.85;
  g.fillStyle = '#d1d5db';
  g.font = '9px monospace';
  g.textAlign = 'left';
  g.fillText(labClip(label, Math.floor(w / 5.4)), x, y + 8);
  // Track.
  const barY = y + 11;
  g.globalAlpha = 0.22;
  g.fillStyle = '#ffffff';
  g.fillRect(x, barY, barW, LAB_BAR_H);
  // Fill to the normalized level (skip when un-warmed / NaN).
  if (Number.isFinite(level)) {
    g.globalAlpha = 0.85;
    g.fillStyle = color;
    g.fillRect(x, barY, barW * clamp01(level), LAB_BAR_H);
  }
  // Percentile-band ticks.
  if (markers.length) {
    g.globalAlpha = 0.7;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1;
    for (const m of markers) {
      const mx = x + barW * clamp01(m);
      g.beginPath();
      g.moveTo(mx, barY - 1);
      g.lineTo(mx, barY + LAB_BAR_H + 1);
      g.stroke();
    }
  }
  // Raw value.
  if (value !== undefined) {
    g.globalAlpha = 0.7;
    g.fillStyle = '#9ca3af';
    g.textAlign = 'right';
    g.fillText(value.toFixed(2), x + w, y + 8);
    g.textAlign = 'left';
  }
}

/**
 * The Feature Lab panel (#119): a right-anchored, newspaper-column grid of
 * grouped, online-normalized meters over the raw face + hand feature vectors. The
 * statistics are computed by {@link createLabMeterComputer} (which owns the
 * normalizer + the derived formulas) and handed in as
 * {@link OverlayView.featureMeters}; this element is a pure renderer. Group headers repeat at the top of
 * a continued column; a "+N more" note is drawn if features overflow the panel, so
 * nothing is silently dropped. Opt-in (a large panel).
 */
const featureLabElement: LabElement = {
  name: 'featureLab',
  category: 'input',
  draw(g, view) {
    const p = view.params.featureLab;
    if (!p.show) return;
    const meters = view.featureMeters;
    if (!meters) return;
    const { W, H } = view;
    const columns = Math.max(1, Math.min(p.columns, Math.floor((W - 2 * PAD) / LAB_COL_W) || 1));
    const panelW = columns * LAB_COL_W + 2 * PAD;
    const panelLeft = W - panelW;
    const panelTop = LAB_TOP;
    const panelBottom = H - 16;
    const contentTop = panelTop + LAB_TITLE_H;

    g.save();
    // Backdrop.
    g.globalAlpha = 0.55;
    g.fillStyle = '#000000';
    g.fillRect(panelLeft, panelTop, panelW, panelBottom - panelTop);
    // Title.
    g.globalAlpha = 1;
    g.fillStyle = FACE_COLOR;
    g.font = 'bold 13px monospace';
    g.textAlign = 'left';
    g.fillText('Feature Lab', panelLeft + PAD, panelTop + 15);
    // ...and, when the panel is wide enough to hold it beside the title, where to
    // turn it off. Skipped on a one-column panel rather than overlapping the title.
    //
    // Left-aligned just after the title rather than right-aligned at the panel edge:
    // the panel is right-anchored, so its outer edge is the first thing `object-cover`
    // crops away on a window narrower than the camera's aspect ratio. Tucked against
    // the title it survives that crop for as long as the title itself does. (The real
    // control is the tools bar, which is DOM and never cropped — this is the signpost.)
    const titleW = 'Feature Lab'.length * LAB_TITLE_CHAR_W;
    if (titleW + LAB_HINT.length * LAB_HINT_CHAR_W + 3 * PAD <= panelW) {
      g.globalAlpha = 0.5;
      g.fillStyle = '#9ca3af';
      g.font = '10px monospace';
      g.fillText(LAB_HINT, panelLeft + PAD + titleW + PAD, panelTop + 15);
      g.globalAlpha = 1;
    }

    // Shown but nothing to measure (no face/hands, or the enabled groups are empty
    // this frame): keep the panel + a hint so the lab doesn't read as "broken".
    if (!meters.order.length) {
      g.globalAlpha = 0.7;
      g.fillStyle = '#9ca3af';
      g.font = 'italic 11px monospace';
      g.textAlign = 'left';
      g.fillText('No features in view (adjust groups)', panelLeft + PAD, contentTop + 8);
      g.restore();
      return;
    }

    let col = 0;
    let y = contentTop;
    let lastGroup: string | null = null;
    let drawn = 0;
    const colX = (c: number) => panelLeft + PAD + c * LAB_COL_W;
    const cellW = LAB_COL_W - PAD;
    const nextColumn = (): boolean => {
      col += 1;
      if (col >= columns) return false;
      y = contentTop;
      lastGroup = null;
      return true;
    };

    for (const id of meters.order) {
      // Catalog features resolve via FEATURE_BY_ID; derived features (not in the
      // static registry) fall back to the `derived` group + a gold accent.
      const feat = FEATURE_BY_ID[id];
      const group = feat?.group ?? DERIVED_GROUP;
      const color = !feat ? CHORD_COLOR : feat.source === 'face' ? FACE_COLOR : feat.source === 'body' ? BODY_COLOR : RIGHT_COLOR;
      // Group header (repeats when a group continues into a new column).
      if (group !== lastGroup) {
        if (y + LAB_HEADER_H + LAB_ROW_H > panelBottom && !nextColumn()) break;
        const info = FEATURE_GROUPS.find((gr) => gr.id === group);
        g.globalAlpha = 0.9;
        g.fillStyle = color;
        g.font = 'bold 10px monospace';
        g.textAlign = 'left';
        g.fillText(labClip(info?.label ?? group, Math.floor(cellW / 6)), colX(col), y + 10);
        y += LAB_HEADER_H;
        lastGroup = group;
      }
      if (y + LAB_ROW_H > panelBottom && !nextColumn()) break;
      drawLabMeter(
        g,
        colX(col),
        y,
        cellW,
        labFeatureLabel(id, group),
        meters.levels[id],
        p.showMarkers ? meters.markers[id] ?? [] : [],
        color,
        p.showValues ? meters.raw[id] : undefined,
      );
      y += LAB_ROW_H;
      drawn += 1;
    }
    // Honest overflow note (no silent truncation).
    const remaining = meters.order.length - drawn;
    if (remaining > 0) {
      g.globalAlpha = 0.8;
      g.fillStyle = '#9ca3af';
      g.font = 'italic 10px monospace';
      g.textAlign = 'right';
      g.fillText(`+${remaining} more (widen / fewer groups)`, panelLeft + panelW - PAD, panelBottom - 4);
      g.textAlign = 'left';
    }
    g.restore();
  },
};


/** Correlation-grid geometry. Deliberately small: this is a diagnostic you glance at
 *  while performing, not a plot you study. */
const CORR_CELL = 14;
const CORR_LABEL_W = 96;
const CORR_TITLE_H = 20;

/** Blue (anti-correlated) → transparent (independent) → orange (correlated). Diverging,
 *  because the SIGN of a coupling is the whole point — a single-hue ramp would show
 *  |r| and hide whether raising your brow raises or lowers the other feature. */
function corrColor(r: number): string {
  const a = Math.min(1, Math.abs(r));
  return r >= 0 ? `rgba(249, 115, 22, ${a.toFixed(3)})` : `rgba(59, 130, 246, ${a.toFixed(3)})`;
}

/**
 * The rolling correlation matrix (#150) — a compact lower-left heat grid over the
 * currently-watched features, so coupling between them is VISIBLE rather than inferred.
 *
 * This is the diagnostic that makes #131's other two halves usable: `invariantTo` labels
 * say what COULD contaminate a feature and `residual(x, z)` removes a confound you name,
 * but only this says which confound is actually biting right now.
 *
 * A pure renderer, like the meters element: the statistics are folded by
 * {@link createLabMeterComputer} (which owns the estimators and the cost guards) and
 * arrive as `view.featureMeters.correlation`.
 *
 * Its config lives in the per-device `featureLab` block rather than a params sub-object of
 * its own — see {@link OverlayElement.configKey}. It is the Lab's diagnostic, so it must
 * not become an instrument parameter (#136).
 */
const featureCorrelationElement: LabElement = {
  name: 'featureCorrelation',
  configKey: 'featureLab',
  category: 'input',
  draw(g, view) {
    const p = view.params.featureLab;
    // A SECOND gate. The load-bearing one is upstream: `createLabMeterComputer` does not
    // populate `correlation` at all unless `showCorrelation` is on, which is what makes
    // the feature genuinely free when off (the work is quadratic — see labCorrelation.ts).
    // A mutation test confirms this line is currently redundant; it is kept so the element
    // does not silently start drawing the day the computer populates the field
    // unconditionally, and so the element reads as opt-in on its own terms.
    if (!p.show || !p.showCorrelation) return;
    const corr = view.featureMeters?.correlation;
    if (!corr || corr.ids.length < 2) return;

    const { W, H } = view;
    const k = corr.ids.length;
    // The grid is the strict lower-left triangle, so it needs k-1 rows and k-1 columns.
    const gridW = (k - 1) * CORR_CELL;
    const panelW = CORR_LABEL_W + gridW + 2 * PAD;
    const panelH = CORR_TITLE_H + (k - 1) * CORR_CELL + 18;
    // Bottom-LEFT: the meters panel is right-anchored and the HUD cues take the edges,
    // so this is the one large region left free.
    const panelLeft = PAD;
    const panelTop = Math.max(LAB_TOP, H - 16 - panelH);
    if (panelW > W - 2 * PAD) return; // never draw a panel wider than the frame

    g.save();
    g.globalAlpha = 0.55;
    g.fillStyle = '#000000';
    g.fillRect(panelLeft, panelTop, panelW, panelH);

    g.globalAlpha = 1;
    g.fillStyle = FACE_COLOR;
    g.font = 'bold 12px monospace';
    g.textAlign = 'left';
    g.fillText('Correlation', panelLeft + PAD, panelTop + 14);

    // Warm-up honesty: an r computed from a handful of frames is not evidence, and a
    // grid that looks identical whether it has 5 samples or 5000 invites reading noise
    // as structure. Say the sample count rather than implying confidence.
    g.globalAlpha = 0.75;
    g.fillStyle = '#9ca3af';
    g.font = 'italic 9px monospace';
    g.textAlign = 'right';
    g.fillText(`${corr.frames}f`, panelLeft + panelW - PAD, panelTop + 14);

    const gridLeft = panelLeft + PAD + CORR_LABEL_W;
    const gridTop = panelTop + CORR_TITLE_H;

    // Row i (for i = 1..k-1) labels feature i; column j (for j = 0..k-2) is feature j.
    // Lower-left triangle: cell (i, j) exists only for j < i, so each unordered pair is
    // drawn exactly once — a full square would mirror every value and say nothing more.
    for (let i = 1; i < k; i++) {
      const y = gridTop + (i - 1) * CORR_CELL;
      g.globalAlpha = 0.85;
      g.fillStyle = '#d1d5db';
      g.font = '9px monospace';
      g.textAlign = 'right';
      g.fillText(labClip(labFeatureLabel(corr.ids[i], ''), 15), gridLeft - 4, y + CORR_CELL - 4);

      for (let j = 0; j < i; j++) {
        const r = corr.r[pairIndex(j, i, k)];
        g.globalAlpha = 1;
        g.fillStyle = corrColor(r);
        g.fillRect(gridLeft + j * CORR_CELL, y, CORR_CELL - 1, CORR_CELL - 1);
      }
    }

    if (corr.truncated > 0) {
      g.globalAlpha = 0.8;
      g.fillStyle = '#9ca3af';
      g.font = 'italic 9px monospace';
      g.textAlign = 'left';
      g.fillText(`+${corr.truncated} not shown (raise the cap)`, panelLeft + PAD, panelTop + panelH - 5);
    }
    g.restore();
  },
};

const DEFAULT_LAB: FeatureLabConfig = FeatureLabSchema.parse(undefined);
const configOf = (inputs: Readonly<Record<string, unknown>>): FeatureLabConfig => (inputs.lab as FeatureLabConfig | undefined) ?? DEFAULT_LAB;

/** The element's code: the statistics once per tick, then both drawings from them. */
export const labMeters: OverlayElementImpl = {
  name: LAB_METERS_ELEMENT,
  update(frame, inputs, memo) {
    const compute = (memo.compute ??= createLabMeterComputer()) as LabMeterComputer;
    const last = memo.t as number | undefined;
    const dt = last === undefined ? 0 : Math.max(0, frame.t - last);
    memo.t = frame.t;
    memo.meters = compute(configOf(inputs), inputs.face as FeatureVector | undefined, inputs.hand as FeatureVector | undefined, dt, inputs.body as FeatureVector | undefined);
  },
  draw(g, frame, inputs, memo) {
    const view: LabView = { W: frame.W, H: frame.H, params: { featureLab: configOf(inputs) }, featureMeters: memo.meters as FeatureMeters | undefined };
    featureLabElement.draw(g, view);
    featureCorrelationElement.draw(g, view);
  },
};
