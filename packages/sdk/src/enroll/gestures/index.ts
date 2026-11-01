/**
 * Dynamic gestures (#718): moving categories beside the static carve. The design and its
 * phases are `docs/design/dynamic-gestures.md`; this barrel grows a module per phase (the
 * segmenter of #751; the window matcher of #752 with its DTW and series; the trace quality of
 * #753 next). Pure, like the rest of `enroll/`.
 */
export { createMotionSegmenter, SEGMENTER_DEFAULTS, type MotionSegmenter, type SegmenterOptions } from './segmenter';
export { dtwDistance, type DtwOptions, type Rows } from './dtw';
export { toSeries, type Series, type SeriesOptions } from './series';
export {
  buildGestureModel,
  createDtwMatcher,
  matchSegment,
  MATCHER_DEFAULTS,
  type DtwMatcherOptions,
  type Following,
  type GestureFire,
  type GestureModel,
  type GestureModelOptions,
  type GestureTemplates,
  type MatchReading,
  type SegmentationOptions,
  type SegmentMatch,
  type Variation,
  type WindowMatcher,
} from './matcher';
export { gestureRestCue, GESTURE_REST_CUE, restlessGestures, withRestBeforeGestures, type RestlessGesture } from './rest';
