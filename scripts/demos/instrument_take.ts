/**
 * A scripted performance on one of the air instruments, played through the PRODUCTION
 * graph headless, for the demo page.
 *
 * The same run the graph tests make (`test/subframe/drum_pads_graph.test.ts`,
 * `test/air/air_bass_graph.test.ts`, `test/air/air_guitar_graph.test.ts`): the default
 * graph with the `replay-hands` source, the instrument's dial handed in through the
 * `ctx.resources.controls` getter the app injects, and the node's output port recorded.
 * What differs is the performance, written to be heard:
 *
 * - `drums`: a synthetic hand gripping a stick (`scripts/air/lib_synthetic_grip.ts`, the
 *   dial's `stickLength` set to that stick's, as a player would calibrate it) plays
 *   the starter kit's pads: the snare at its centre and at its rim, softly and hard, then
 *   the other pads. Soft is a short, slow stroke; hard a long, fast one (the node's
 *   hardness is half accent, half fall speed).
 * - `bass`: `test/air/synthetic_bass.ts`, the fretting hand walking down the neck while
 *   the other hand plucks.
 * - `guitar`: four chord shapes enrolled from the synthetic hand (`test/air/synthetic_guitar.ts`),
 *   then a take that changes chord every two seconds while the other hand strums.
 *
 * Writes `{instrument, fps, width, height, frames, overlay, events}`: the hands frames (to
 * draw), per-frame overlay data (the stick, the neck, the chord held) and the node's
 * events on the engine clock (drum hits, or note events), which `offline_audio.ts`
 * sounds through the shipped WebAudio sinks.
 *
 * Usage: npx vite-node scripts/demos/instrument_take.ts --instrument drums|bass|guitar [--out FILE]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runHeadless } from '@thoremin/dag';
import { createAppRegistry } from '@/nodes/browser';
import { defaultGraph } from '@/app/graph';
import type { HandsFrame } from '@/nodes';
import { DEFAULT_PADS_SET, STARTER_KIT, type PadId, type Pads } from '@thoremin/sdk/nodes/music/drum_pads';
import { DEFAULT_AIR_BASS, DEFAULT_AIR_DRUM, DEFAULT_AIR_GUITAR } from '@thoremin/ext-air/dials';
import { generateScale } from '@thoremin/sdk/music/theory';
import { emptyVocabulary, trainVocabulary, withEntry } from '@thoremin/ext-air/lib/vocabulary';
import { chordShapeFeatureIds } from '@thoremin/ext-air/lib/hand_shape';
import { dataRoot } from '../air/lib_air_paths';
import { TRUE_STICK_LENGTH, gripFrames, type StickPose } from '../air/lib_synthetic_grip';
import { bassTake } from '../../test/air/synthetic_bass';
import { enrolSamples, guitarTake } from '../../test/air/synthetic_guitar';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const instrument = arg('instrument', 'drums');
const out = arg('out', join(dataRoot(), 'demos', 'round3', `${instrument}.take.json`));
const FPS = 30;
const W = 640;
const H = 480;
const voice = { root: 4, type: 'minorPentatonic', octaves: 2, baseOctave: 2, sound: 'sine' } as const;

// ---- Drums --------------------------------------------------------------------------

interface Stroke {
  pad: PadId;
  where: 'centre' | 'rim';
  force: 'soft' | 'hard';
}
const DRUM_SCRIPT: Stroke[] = [
  // A warm-up: the node learns where the strokes turn from the first one (a ghost note).
  { pad: 'p1', where: 'centre', force: 'hard' },
  { pad: 'p1', where: 'centre', force: 'soft' },
  { pad: 'p1', where: 'centre', force: 'hard' },
  { pad: 'p1', where: 'rim', force: 'soft' },
  { pad: 'p1', where: 'rim', force: 'hard' },
  { pad: 'p3', where: 'centre', force: 'soft' },
  { pad: 'p3', where: 'centre', force: 'hard' },
  { pad: 'p3', where: 'rim', force: 'hard' },
  { pad: 'p2', where: 'centre', force: 'hard' },
  { pad: 'p2', where: 'centre', force: 'soft' },
  { pad: 'p5', where: 'centre', force: 'hard' },
  { pad: 'p4', where: 'centre', force: 'hard' },
  { pad: 'p1', where: 'centre', force: 'hard' },
];
/** The stick, pixels, from the hand (pivot) to the tip, and its raised angles. */
const STICK = 170;
const FORCE = { soft: { lift: 0.4, fall: 0.22 }, hard: { lift: 0.7, fall: 0.09 } };
const MOVE_S = 0.5;
const HOLD_S = 0.12;
const RETURN_S = 0.22;

function drumTake(pads: Pads): { frames: HandsFrame[]; overlay: unknown[]; script: (Stroke & { tLand: number })[] } {
  // Landing point per stroke, source pixels (the display is mirrored).
  const target = (s: Stroke) => {
    const p = pads[s.pad];
    const dx = s.where === 'rim' ? 0.85 * (p.w / 2) : 0;
    return { x: (1 - (p.x + dx)) * W, y: p.y * H };
  };
  // The stick lies down and to the left of the hand at contact (the player's right hand
  // held out to the side), turning about the hand: tip = pivot + STICK * (cos a, sin a).
  const LAND_ANGLE = Math.PI - 0.1;
  const pivotFor = (tip: { x: number; y: number }) => ({ x: tip.x - STICK * Math.cos(LAND_ANGLE), y: tip.y - STICK * Math.sin(LAND_ANGLE) });
  const poses: StickPose[] = [];
  const overlay: unknown[] = [];
  const script: (Stroke & { tLand: number })[] = [];
  let t = 0;
  let pivot = pivotFor(target(DRUM_SCRIPT[0]));
  let angle = LAND_ANGLE + FORCE.soft.lift;
  const push = () => {
    const tip = { x: pivot.x + STICK * Math.cos(angle), y: pivot.y + STICK * Math.sin(angle) };
    poses.push({ t, width: W, height: H, pivot: { ...pivot }, tip });
    overlay.push({ pivot: { ...pivot }, tip });
    t += 1 / FPS;
  };
  const phase = (seconds: number, step: (s: number) => void) => {
    const n = Math.max(1, Math.round(seconds * FPS));
    for (let i = 1; i <= n; i++) {
      step(i / n);
      push();
    }
  };
  // Rest first, so the tracker sees a still hand.
  phase(0.6, () => {});
  for (const s of DRUM_SCRIPT) {
    const f = FORCE[s.force];
    const from = { ...pivot };
    const to = pivotFor(target(s));
    const a0 = angle;
    const up = LAND_ANGLE + f.lift;
    // Move the arm to the pad with the stick raised (smoothstep, no dip).
    phase(MOVE_S, (u) => {
      const e = u * u * (3 - 2 * u);
      pivot = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
      angle = a0 + (up - a0) * e;
    });
    phase(HOLD_S, () => {});
    // The stroke: a braked fall (fastest mid-way, still at the bottom), then back up.
    phase(f.fall, (u) => {
      angle = up - f.lift * (1 - Math.cos(Math.PI * u)) / 2;
    });
    script.push({ ...s, tLand: t - 1 / FPS });
    phase(RETURN_S, (u) => {
      angle = LAND_ANGLE + f.lift * (1 - Math.cos(Math.PI * u)) / 2;
    });
  }
  phase(0.8, () => {});
  // The mirrored webcam labels the player's right hand 'Left' (the dial's default).
  return { frames: gripFrames(poses, { arm: 0, handedness: 'Left' }), overlay, script };
}

// ---- Run ------------------------------------------------------------------------------

async function run(frames: HandsFrame[], controls: () => Record<string, unknown>, port: string): Promise<unknown[]> {
  const registry = createAppRegistry();
  const g = defaultGraph({ source: 'replay-hands' }, registry);
  g.nodes.find((n) => n.id === 'cam')!.params = { frames };
  const { recorder } = await runHeadless(g, registry, {
    ticks: frames.length,
    nominalDt: 1 / FPS,
    resources: {
      controls,
      createDrumSink: () => ({ play: () => {}, close: () => {} }),
      createPluckSink: () => ({ play: () => {}, close: () => {} }),
    },
    recordOnly: [port],
  });
  return (recorder.values(port) as unknown[][]).flat();
}

async function main(): Promise<void> {
  let doc: Record<string, unknown>;
  if (instrument === 'drums') {
    const pads: Pads = { ...DEFAULT_PADS_SET };
    for (const id of STARTER_KIT) pads[id] = { ...pads[id], on: true };
    const { frames, overlay, script } = drumTake(pads);
    const events = await run(frames, () => ({ right: voice, left: voice, airDrum: { ...DEFAULT_AIR_DRUM, enabled: true, hand: 'right', pads, stickLength: TRUE_STICK_LENGTH } }), 'airDrum.hits');
    doc = { instrument, fps: FPS, width: W, height: H, frames, overlay, events, pads, script };
  } else if (instrument === 'bass') {
    // Walk down the neck and back: two plucks on each place.
    const places = [6.6, 5.6, 4.6, 3.6, 2.6, 3.6, 4.6, 6.6];
    const neck = (t: number) => places[Math.min(places.length - 1, Math.floor(t))];
    const frames = bassTake({ duration: places.length, neck, period: 0.5 });
    const events = await run(frames, () => ({ right: voice, left: voice, airBass: { ...DEFAULT_AIR_BASS, enabled: true, mirrorHandedness: false } }), 'airBass.notes');
    const overlay = frames.map((_, i) => ({ neck: neck(i / FPS) }));
    doc = { instrument, fps: FPS, width: W, height: H, frames, overlay, events, scale: generateScale(voice) };
  } else if (instrument === 'guitar') {
    const chords = ['G', 'C', 'D', 'G', 'E', 'A', 'D', 'G'];
    let v = emptyVocabulary(chordShapeFeatureIds());
    for (const [i, c] of [...new Set(chords)].entries()) v = withEntry(v, c, enrolSamples(c, 40, i + 1));
    const model = trainVocabulary(v);
    const chordAt = (t: number) => chords[Math.min(chords.length - 1, Math.floor(t / 2))];
    const frames = guitarTake({ duration: 2 * chords.length, chordAt, period: 0.5 });
    const events = await run(frames, () => ({ right: voice, left: voice, airGuitar: { ...DEFAULT_AIR_GUITAR, enabled: true, mirrorHandedness: false }, airGuitarModel: model }), 'airGuitar.notes');
    const overlay = frames.map((_, i) => ({ chord: chordAt(i / FPS) }));
    doc = { instrument, fps: FPS, width: W, height: H, frames, overlay, events };
  } else {
    throw new Error('--instrument must be drums, bass or guitar');
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(doc));
  const ev = doc.events as { t: number; predicted?: boolean }[];
  console.log(`${instrument}: ${(doc.frames as unknown[]).length} frames, ${ev.length} events (${ev.filter((e) => e.predicted).length} predicted) -> ${out}`);
}

void main();
