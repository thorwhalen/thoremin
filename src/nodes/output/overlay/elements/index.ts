/**
 * The core overlay elements, in draw (z) order.
 *
 * Part of the `canvas-overlay` node (`../../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import { videoBackdrop } from './backdrop';
import { bodySkeleton } from './body_skeleton';
import { categoryBarsCue, categoryLabelCue } from './category';
import { chordGuideElement } from './chord_guide';
import { chordNameCue } from './chord_name';
import { controlMarkers } from './control_markers';
import { faceExpressionCue } from './face_expression';
import { faceMesh } from './face_mesh';
import { fingerBarsCue } from './finger_bars';
import { fingerLinesElement } from './finger_lines';
import { indexFingerGuide } from './index_finger_guide';
import { keyboardStripElement } from './keyboard_strip';
import { landmarkDots } from './landmarks';
import { scaleGuideElement } from './scale_guide';
import { tagHud } from './tag_hud';
import { timbreLevels } from './timbre_levels';
import { trainerHud } from './trainer_hud';
import type { OverlayElement } from '../view';

/**
 * The overlay elements, in draw (z) order. In-scene first, HUD cues last (on top).
 * Each has a `category` and a `<name>` sub-object in `Params`. Append here to add one.
 */
export const OVERLAY_ELEMENTS: readonly OverlayElement[] = [
  videoBackdrop,
  scaleGuideElement,
  chordGuideElement,
  // The keyboard strip is an in-scene bottom-edge element: above the video/guides,
  // below the landmarks/markers (so hands read over it) and the HUD cues.
  keyboardStripElement,
  indexFingerGuide,
  faceMesh,
  bodySkeleton,
  landmarkDots,
  controlMarkers,
  fingerLinesElement,
  timbreLevels,
  // (The Feature Lab's panel and correlation matrix drew here: the Lab slice's contributed
  // element since #600 S16b, placed before `chordName`.)
  // HUD cues last (on top). chordName sits before the others so `fingerBars`
  // stays the topmost cue; cues on different edges don't overlap regardless.
  chordNameCue,
  faceExpressionCue,
  categoryLabelCue,
  categoryBarsCue,
  // The burned-in tag HUD sits above the cues (its own top corner); fingerBars stays
  // the array's last element so the z-order invariant + concurrent additions hold.
  tagHud,
  // The trainer's on-video guidance (#163): above the cues, below fingerBars, which
  // stays the array's last element (the z-order invariant).
  trainerHud,
  fingerBarsCue,
];
