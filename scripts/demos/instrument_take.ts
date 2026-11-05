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
 * - `--recording <id> [--from s] [--to s]`: instead of a synthetic hand, the player's own take
 *   from the private recordings dataset (`test/helpers/recordings.ts`, `thoremin-recordings`):
 *   its real hand frames, with the instrument's dial, the scale and the enrolled guitar model as
 *   the player had them. The instrument is the take's (air bass or air guitar). The events the
 *   app played live are counted beside the replayed ones, so the demo also shows what today's
 *   code would have played on that take. Output stays in the app-data dir (never committed).
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
import { loadedAppRegistry } from '@/nodes/browser';
import { defaultGraph, DEFAULT_GRAPH_READS, defaultGraphResources } from '@/app/graph';
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
import { recordingMeta, recordingSegment, recordingSettings, recordingStream } from '../../test/helpers/recordings';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const instrument = arg('instrument', 'drums');
const out = arg('out', join(dataRoot(), 'demos', 'round3', `${arg('recording', '') || instrument}.take.json`));
const FPS = 30;
const W = 640;
const H = 480;
const voice = { root: 4, type: 'minorPentatonic', octaves: 2, baseOctave: 2, sound: 'sine' } as const;

// ---- Run ------------------------------------------------------------------------------

async function run(frames: HandsFrame[], controls: () => Record<string, unknown>, port: string): Promise<unknown[]> {
  // `defaultGraph` names every branch, a lazy extension's too: load them all.
  const registry = await loadedAppRegistry();
  const g = defaultGraph({ source: 'replay-hands' }, registry);
  g.nodes.find((n) => n.id === 'cam')!.params = { frames };
  const { recorder } = await runHeadless(g, registry, {
    checkReads: DEFAULT_GRAPH_READS,
    ticks: frames.length,
    nominalDt: 1 / FPS,
    resources: { ...defaultGraphResources(),
      controls,
      createDrumSink: () => ({ play: () => {}, close: () => {} }),
      createPluckSink: () => ({ play: () => {}, close: () => {} }),
    },
    recordOnly: [port],
  });
  return (recorder.values(port) as unknown[][]).flat();
}

/** The player's own take, replayed (`--recording`). */
async function recordedTake(id: string): Promise<Record<string, unknown>> {
  const label = recordingMeta(id).instrument.label;
  const which = ({ 'air bass': 'airBass', 'air guitar': 'airGuitar' } as Record<string, string>)[label];
  if (!which) throw new Error(`--recording replays an air bass or air guitar take; ${id} is ${label}`);
  const from = Number(arg('from', '0'));
  const to = Number(arg('to', 'Infinity'));
  const records = recordingSegment(id, 'hands', from, to);
  const frames = records.map((r) => r.value as HandsFrame);
  const ui = recordingSettings(id);
  const spec = (side: 'Right' | 'Left') => ({ ...(ui[`${side.toLowerCase()}Spec`] as object ?? voice), sound: ui[`sound${side}`] ?? 'sine' });
  const controls = () => ({ right: spec('Right'), left: spec('Left'), [which]: ui[which], airGuitarModel: ui.airGuitarModel });
  const events = await run(frames, controls, `${which}.notes`);
  const live = recordingStream(id, 'app')
    .filter((r) => (r as unknown as { key: string }).key === `${which}.notes` && r.t >= from && r.t < to)
    .reduce((n, r) => n + ((r.value as unknown[]) ?? []).length, 0);
  const width = (frames[0] as { width?: number })?.width ?? W;
  const height = (frames[0] as { height?: number })?.height ?? H;
  console.log(`${id} (${label}): ${events.length} notes replayed, ${live} played live`);
  return { instrument: label, recording: id, from, fps: FPS, width, height, frames, overlay: frames.map(() => ({})), events, liveNotes: live };
}

async function main(): Promise<void> {
  let doc: Record<string, unknown>;
  const recording = arg('recording', '');
  if (recording) {
    doc = await recordedTake(recording);
  } else if (instrument === 'drums') {
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
  console.log(`${doc.instrument as string}: ${(doc.frames as unknown[]).length} frames, ${ev.length} events (${ev.filter((e) => e.predicted).length} predicted) -> ${out}`);
}

void main();
