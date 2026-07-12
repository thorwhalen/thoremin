/**
 * Feature-Lab meter computation (#119) — the Lab's statistics engine, extracted from
 * the canvas overlay node.
 *
 * The lab's numbers are a STATEFUL online computation (a running normalizer plus
 * compiled derived formulas), not a drawing concern: the renderer used to own the
 * `OnlineNormalizer` lifecycle, the formula compilation cache and the per-frame
 * feature sweep, which made a 1500-line god-file out of a canvas painter and made the
 * statistics untestable without a canvas. This module owns all of that behind one
 * opaque handle — the same split the tagging track made with `@/taglog/presentation`:
 * WHAT to show is a pure(-ish) computation here; HOW to paint it stays in the overlay.
 *
 * Node-safe (no DOM/canvas), so the lab statistics unit-test headlessly.
 */
import { OnlineNormalizer, type NormalizerMode } from './normalizer';
import { compileFormula, type CompiledFormula } from './formula';
import { ALL_FEATURES, ALL_SAFE_NAMES, DERIVED_GROUP, safeName, type FeatureVector } from './catalog';

/**
 * The Feature Lab's compute-relevant configuration — the subset of the overlay's
 * `featureLab` params that decides WHAT is measured (the drawing-only knobs, e.g.
 * `columns`/`showValues`, are not this module's business). Structural, so the overlay's
 * Zod-inferred params object is accepted as-is.
 */
export interface LabMeterConfig {
  /** The lab is opt-in: hidden → nothing is measured (and the stats re-zero on reopen). */
  show: boolean;
  /** The feature groups selected for display + compute. */
  groups: string[];
  /** The level mapping (min/max envelope, quantile, or z-score). */
  normalizer: NormalizerMode;
  /** Whether the percentile-band reference ticks are computed. */
  showMarkers: boolean;
  /** User-defined derived features: a safe formula (jsep whitelist) over feature
   *  safe-names (`face.geom.mouth.openness` → `face_geom_mouth_openness`) + the helper
   *  set. Evaluated over the MERGED face+hand vector; an invalid formula is skipped. */
  derived: { id: string; formula: string }[];
  /** Bump to re-zero the online statistics (a manual "recalibrate"). */
  resetNonce: number;
}

/**
 * The normalized meter data the `featureLab` overlay element draws. `order` is the
 * display order of the present, enabled feature ids; `levels`/`markers` are keyed by
 * feature id; `raw` is the merged (face + hand + derived) vector this frame.
 */
export interface FeatureMeters {
  order: string[];
  raw: FeatureVector;
  levels: Record<string, number>;
  markers: Record<string, number[]>;
}

/**
 * Fold one frame's raw vectors into the running statistics and return the meters to
 * draw, or `undefined` while the lab is hidden (the element then draws nothing).
 * `dt` is the seconds since the previous frame (the engine's `ctx.dt`).
 */
export type LabMeterComputer = (
  cfg: LabMeterConfig,
  faceVec: FeatureVector | undefined,
  handVec: FeatureVector | undefined,
  dt: number,
) => FeatureMeters | undefined;

/** Compile the derived-feature list, skipping (never throwing on) an invalid formula —
 *  the derived-feature editor surfaces the compile error; the per-frame loop must not throw. */
function compileDerived(list: LabMeterConfig['derived']): { id: string; fn: CompiledFormula }[] {
  const out: { id: string; fn: CompiledFormula }[] = [];
  for (const d of list) {
    if (!d.id || !d.formula) continue;
    try {
      out.push({ id: d.id, fn: compileFormula(d.formula, { variables: ALL_SAFE_NAMES }) });
    } catch {
      // Invalid/unsafe formula: skip it.
    }
  }
  return out;
}

/**
 * Create a stateful lab-meter computer: it owns the {@link OnlineNormalizer} (which
 * accumulates per-feature statistics from the moment the lab is shown, and re-zeroes on
 * reopen or an explicit `resetNonce` bump) and the derived-formula compilation cache
 * (re-compiled only when the config changes, never per-frame).
 *
 * One computer per lab instance (the overlay node makes one in `make()`), so two graphs
 * never share statistics.
 */
export function createLabMeterComputer(): LabMeterComputer {
  const normalizer = new OnlineNormalizer();
  let prevShow = false;
  let resetNonce = 0;
  let derivedSig = '';
  let compiled: { id: string; fn: CompiledFormula }[] = [];

  return (cfg, faceVec, handVec, dt) => {
    if (!cfg.show) {
      prevShow = false;
      return undefined;
    }
    // Re-zero the stats when the lab is (re)opened or an explicit reset fires.
    if (!prevShow || cfg.resetNonce !== resetNonce) normalizer.reset();
    prevShow = true;
    resetNonce = cfg.resetNonce;
    normalizer.setMode(cfg.normalizer);

    const raw: FeatureVector = { ...(faceVec ?? {}), ...(handVec ?? {}) };
    const enabled = new Set(cfg.groups);

    // Derived (formula) features over the MERGED scope, so a formula may combine face +
    // hand features. Recompile only on change.
    const sig = JSON.stringify(cfg.derived);
    if (sig !== derivedSig) {
      derivedSig = sig;
      compiled = compileDerived(cfg.derived);
    }
    if (compiled.length && enabled.has(DERIVED_GROUP)) {
      const scope: Record<string, number> = {};
      for (const k of Object.keys(raw)) scope[safeName(k)] = raw[k];
      for (const d of compiled) {
        const val = d.fn.eval(scope);
        if (Number.isFinite(val)) raw[`derived.${d.id}`] = val;
      }
    }

    const order: string[] = [];
    const levels: Record<string, number> = {};
    const markers: Record<string, number[]> = {};
    const take = (id: string, v: number): void => {
      normalizer.observe(id, v, dt);
      order.push(id);
      levels[id] = normalizer.level(id, v);
      if (cfg.showMarkers) markers[id] = normalizer.markers(id);
    };
    // Catalog features first (in display order), then any derived features.
    for (const feat of ALL_FEATURES) {
      if (!enabled.has(feat.group)) continue;
      const v = raw[feat.id];
      if (v === undefined) continue; // not present this frame (dropped as NaN upstream)
      take(feat.id, v);
    }
    if (enabled.has(DERIVED_GROUP)) {
      for (const key of Object.keys(raw)) {
        if (key.startsWith('derived.')) take(key, raw[key]);
      }
    }
    return { order, raw, levels, markers };
  };
}
