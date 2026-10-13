/**
 * The live feature-vector tap (#160), re-exported from the SDK's app half
 * (`@thoremin/sdk-ui/enroll/liveVector`), where it moved so an extension reads the same
 * vectors the trainer does (#330). Callers in the app keep importing it from here.
 */
export { FEATURE_VECTOR_EDGES, LiveVectorTap, readLiveVector, resetLiveVector } from '@thoremin/sdk-ui/enroll/liveVector';
