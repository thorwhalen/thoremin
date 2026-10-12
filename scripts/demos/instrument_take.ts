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
 * - `drums`: `test/air/synthetic_drums.ts`, a synthetic hand gripping a stick
 *   (`scripts/air/lib_synthetic_grip.ts`, the dial's `stickLength` set to that stick's,
 *   as a player would calibrate it) plays the starter kit's pads: the snare at its centre
 *   and at its rim, softly and hard, then the other pads. Soft is a short, slow stroke;
 *   hard a long, fast one (the node's hardness is half accent, half fall speed). The
 *   same take is the landing-point test's fixture (#261), so the demo and the test agree.
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
import { DEFAULT_AIR_BASS, DEFAULT_AIR_DRUM, DEFAULT_AIR_GUITAR } from '@thoremin/ext-air/dials';
import { generateScale } from '@thoremin/sdk/music/theory';
import { emptyVocabulary, trainVocabulary, withEntry } from '@thoremin/ext-air/lib/vocabulary';
import { chordShapeFeatureIds } from '@thoremin/ext-air/lib/hand_shape';
import { dataRoot } from '../air/lib_air_paths';
import { TRUE_STICK_LENGTH } from '../air/lib_synthetic_grip';
import { bassTake } from '../../test/air/synthetic_bass';
import { DRUM_TAKE_FPS, DRUM_TAKE_HEIGHT, DRUM_TAKE_WIDTH, drumTake, starterKitPads } from '../../test/air/synthetic_drums';
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
    const pads = starterKitPads();
    const { frames, overlay, script } = drumTake(pads);
    const events = await run(frames, () => ({ right: voice, left: voice, airDrum: { ...DEFAULT_AIR_DRUM, enabled: true, hand: 'right', pads, stickLength: TRUE_STICK_LENGTH } }), 'airDrum.hits');
    doc = { instrument, fps: DRUM_TAKE_FPS, width: DRUM_TAKE_WIDTH, height: DRUM_TAKE_HEIGHT, frames, overlay, events, pads, script };
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
