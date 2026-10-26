/**
 * Dynamic gestures (#718): moving categories beside the static carve. The design and its
 * phases are `docs/design/dynamic-gestures.md`; this barrel grows a module per phase (the
 * window matcher of #752, the trace quality of #753). Pure, like the rest of `enroll/`.
 */
export { createMotionSegmenter, SEGMENTER_DEFAULTS, type MotionSegmenter, type SegmenterOptions } from './segmenter';
