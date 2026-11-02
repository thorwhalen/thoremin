/**
 * Dynamic gestures (#718): moving categories beside the static carve. The design and its
 * phases are `docs/design/dynamic-gestures.md`; this barrel grows a module per phase (the
 * segmenter of #751; the window matcher of #752 with its DTW and series; the file section, the
 * trace quality and the everyday replay of #753). Pure, like the rest of `enroll/`.
 */
export { createMotionSegmenter, SEGMENTER_DEFAULTS, type MotionSegmenter, type SegmenterOptions } from './segmenter';
export { dtwDistance, type DtwOptions, type Rows } from './dtw';
export { motionSpanMs, MOTION_SPAN_TAIL, toSeries, type Series, type SeriesOptions } from './series';
export {
  buildGestureModel,
  byGesture,
  createDtwMatcher,
  gestureRadius,
  resolveGestureOptions,
  matchSegment,
  MATCHER_DEFAULTS,
  type DtwMatcherOptions,
  type Following,
  type GestureFire,
  type GestureModel,
  type GestureModelOptions,
  type GestureTemplates,
  type MatchReading,
  type ResolvedGestureOptions,
  type SegmentationOptions,
  type SegmentMatch,
  type Variation,
  type WindowMatcher,
} from './matcher';
export { gestureRestCue, GESTURE_REST_CUE, restlessGestures, withRestBeforeGestures, type RestlessGesture } from './rest';
export {
  freshGestureId,
  fromStoredTrace,
  gestureModelFromCategorizer,
  gestureSection,
  gestureSpace,
  gestureIds,
  gestureTraces,
  toStoredTrace,
  type GestureSectionOptions,
  type GestureSpace,
} from './file';
export {
  gestureQuality,
  GESTURE_QUALITY_DEFAULTS,
  type GestureQuality,
  type GestureQualityOptions,
  type GestureSetQuality,
  type HoldOverlap,
  type OddTrace,
  type TraceQuality,
} from './quality';
export { gestureEveryday, type GestureEverydayOptions } from './everyday';
