/**
 * The feature-catalog type model: a flat, data-driven registry of scalar feature
 * definitions, mirroring the `OVERLAY_ELEMENTS` / node-registry pattern. Adding a
 * feature is appending a {@link FeatureDef}; nothing else changes.
 *
 * Each feature computes ONE scalar from a per-source context (blendshapes + mesh
 * landmarks + head pose for the face; image + world landmarks for a hand). A
 * feature returns `NaN` when its inputs are absent this frame (present-gating /
 * div-by-zero guard) — the feature-vector node drops non-finite values so they
 * never reach the recorder or the online normalizer (one NaN permanently
 * corrupts a running mean).
 */
import type { HeadPose } from '@/nodes/domain';
import type { FaceLandmarks } from './landmarks';
import type { Vec3 } from './math';

/** A flat frame of scalar feature values, keyed by feature id. The value type of
 *  the `feature-vector` edge the vector nodes emit and the recorder taps. Only
 *  finite values appear (non-finite features are dropped upstream). */
export type FeatureVector = Record<string, number>;

/**
 * How deliberately a performer can drive a feature — the honest guidance for
 * "which channels should I map to sound" (see #119). `easy` = a strong,
 * unambiguous volitional control; `moderate` = producible but coupled or subtle;
 * `involuntary` = mostly reflexive / hard to isolate.
 */
export type Controllability = 'easy' | 'moderate' | 'involuntary';

/** Which raw source a feature reads. */
export type FeatureSource = 'face' | 'hand';

/** The confound axes a feature can declare invariance to (#131): `scale` =
 *  camera distance, `position` = translation in the frame, `yaw`/`pitch`/`roll`
 *  = the subject's pose (head pose for face features, hand orientation for hand
 *  features). See {@link FeatureDef.invariantTo} for the exact semantics. */
export type Invariance = 'scale' | 'position' | 'yaw' | 'pitch' | 'roll';

/**
 * One scalar feature. `compute` is pure: same context → same value. It returns
 * `NaN` to signal "not measurable this frame" (missing landmark, degenerate
 * scale, absent source) — never Infinity, never a thrown error.
 */
export interface FeatureDef<Ctx> {
  /** Readable dotted id, e.g. `face.geom.mouth.aspectRatio`, `hand.right.index.curl`. */
  id: string;
  /** Toggleable group name (a region/family), e.g. `face.blendshape.mouth`. */
  group: string;
  source: FeatureSource;
  /** Advisory expected raw range (for docs; the online normalizer does the real
   *  ranging). Absent for open-ended geometric ratios. For a `circular` feature the
   *  range is NOT advisory — it is the exact period the normalizer maps against. */
  range?: readonly [number, number];
  /**
   * What this feature's value is HONESTLY invariant to (#131) — the declared
   * confound profile. A feature measured off a landmark stream is rarely a pure
   * measurement of the thing it names: camera distance rescales pixel distances,
   * head/hand pose foreshortens 2D geometry, frame position moves everything.
   * The vocabulary ({@link Invariance}): `scale` = camera distance, `position` =
   * translation in the frame, `yaw`/`pitch`/`roll` = the subject's pose axes
   * (head pose for face features, hand orientation for hand features).
   *
   * Semantics: ABSENT = not yet assessed (no claim either way); `[]` = assessed
   * and invariant to NOTHING listed (e.g. a raw position — it IS its confound);
   * a listed axis = "moving only along that axis should not move this feature
   * (to the fidelity of the underlying model)". Use `residual(x, z)` /
   * `deconfound(x, z1, z2, ...)` in a Lab formula to correct a feature for a
   * confound it is NOT invariant to.
   */
  invariantTo?: readonly Invariance[];
  /** True for an ANGULAR feature whose value lives on a circle: the two `range`
   *  endpoints (e.g. -pi and +pi from `atan2`) are the SAME physical pose, so the
   *  single-frame jump between them is a representation artifact, not motion. The
   *  online normalizer must not treat such a jump as range (an envelope inflated
   *  across the wrap ruins the meter, and adaptive rescaling makes the level
   *  history-dependent) — circular features get a FIXED declared-range mapping
   *  instead. The wrap discontinuity itself is intrinsic to mapping a circle onto
   *  a line; for glitch-free MUSICAL control, derive `sin(...)`/`cos(...)` of the
   *  angle in a Lab formula (both helpers ship in DEFAULT_HELPERS). */
  circular?: boolean;
  controllability?: Controllability;
  /** One-line human description (surfaced in the catalog manual + lab tooltips). */
  description?: string;
  /** The formula. `NaN` = unavailable this frame. */
  compute(ctx: Ctx): number;
}

/**
 * Per-frame face context handed to every face feature. `bs` reads a blendshape
 * score (0 when absent — MediaPipe omits `tongueOut`, so features must not assume
 * a key exists); `landmarks` is the full 478-point mesh (with z) or undefined;
 * `iod` is the precomputed face-scale reference (`NaN` when landmarks/scale are
 * unavailable); `headPose` is present only when the transformation matrix is on.
 */
export interface FaceCtx {
  present: boolean;
  bs(name: string): number;
  landmarks?: FaceLandmarks;
  hasLandmarks: boolean;
  headPose?: HeadPose;
  /** Precomputed `IOD` scale reference (outer-canthi span), or `NaN`. */
  iod: number;
}

/**
 * Per-frame single-hand context. `P` is the 21 image keypoints (pixel coords);
 * `W` the 21 world keypoints (metric, ~pose-invariant) when present. `useWorld`
 * chooses which set the orientation/angle features read (world is preferred for
 * invariance; the synthetic source and the recorded fixtures fall back to image).
 * `palmSpan` is the precomputed rigid palm-span scale (world or image, matching
 * `useWorld`), guarded > 0. `width`/`height` normalize image coords to 0..1.
 */
export interface HandCtx {
  present: boolean;
  side: 'left' | 'right';
  /** Image keypoints (pixel coordinates), indexable by MediaPipe landmark index. */
  P: (i: number) => Vec3 | undefined;
  /** World keypoints (metric), or undefined-returning when absent. */
  W: (i: number) => Vec3 | undefined;
  useWorld: boolean;
  /** Rigid palm span (index-MCP..pinky-MCP), in the active coordinate set; > 0 or NaN. */
  palmSpan: number;
  /** Selfie mirror for image-x-derived features. */
  mirrorX: boolean;
  width: number;
  height: number;
}

/** Two-hand context: the per-hand image contexts for left and right (each may be
 *  absent). World frames are per-hand and cannot be combined, so relational
 *  features use image palm centroids + per-hand image size. */
export interface TwoHandCtx {
  left?: HandCtx;
  right?: HandCtx;
  mirrorX: boolean;
}
