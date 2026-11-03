/**
 * A hand categorizer with a recorded wave (#754): the shipped hand-shape demo, and a wave recorded
 * into it the way the carve tool records one (the pure gesture take over the scripted waving hand,
 * read side-relative as the tool reads it). For the binding and shell tests.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importCategorizer, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { addGestureTraces } from '@thoremin/sdk/enroll/gestures';
import { createReader } from '@thoremin/sdk/enroll/modality';
import { handModality } from '@thoremin/sdk/features/modalities/hand';
import { createGestureTake } from '@thoremin/ext-faces/lib/gestureTake';
import { GESTURE_PATHS, SYNTHETIC_GESTURE, syntheticGestureVector } from '@thoremin/ext-faces/lib/synthetic_gesture';

const FRAME_MS = 1000 / 30;

/** The shipped hand-shape demo categorizer. */
export function demoHandCategorizer(): PersonalCategorizer {
  const demo = importCategorizer(readFileSync(join(process.cwd(), 'public/categorizers/demo-hand-shapes.json'), 'utf8'));
  if (!demo.ok) throw new Error(demo.error);
  return demo.categorizer;
}

/** The demo with `name` recorded into it (five repetitions of the scripted `path`). */
export function withRecordedGesture(name = 'wave', path: keyof typeof GESTURE_PATHS = 'wave', base: PersonalCategorizer = demoHandCategorizer()): PersonalCategorizer {
  const take = createGestureTake({ modality: handModality, name, cueId: `hand-shapes-gesture-${name}` });
  const read = createReader(handModality);
  take.start(0);
  const end = SYNTHETIC_GESTURE.restMs + 7 * (SYNTHETIC_GESTURE.repetitionMs + SYNTHETIC_GESTURE.pauseMs);
  for (let i = 0, t = 0; t < end && take.step() !== 'done'; i++, t = i * FRAME_MS) take.push(read(syntheticGestureVector(GESTURE_PATHS[path], t, i)), t);
  if (take.count() !== take.target()) throw new Error(`the scripted ${name} cut ${take.count()} repetitions, not ${take.target()}`);
  const r = addGestureTraces(base, take.traces(), { features: take.features(), weights: take.weights() });
  if (!r.ok) throw new Error(r.error);
  return r.categorizer;
}
