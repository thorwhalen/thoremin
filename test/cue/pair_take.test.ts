/**
 * A synthetic real-versus-air take passes the whole pipeline (#247).
 *
 * "Synthetic" means only the player and the room are simulated. Everything between them
 * and the pairs is the shipped code: the starter routine resolved from the cue store,
 * the trainer store running it (runner, click plan, click bookkeeping), the trainer's
 * tag source writing the annotations, the take session and manifest the recorder would
 * write, the recorder's own WAV encoder, and then `scripts/cue/` reading the folder (and
 * the zip a `downloads` take arrives as) into pairs under a temporary data root.
 *
 * The simulated player taps 25 ms after each click on the table, plays nothing audible in
 * the air, claps the slate 10 ms after its clicks, and taps soft/hard in fours for the
 * dynamics phrase. The camera sees the hands meet at each clap one frame before the
 * sound. Every number asserted below is derived from those choices.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import type { Click, FeatureVector } from '@/enroll';
import { useTrainer, useTrainerStores } from '@/app/enroll/store';
import { createCueStore, createRoutineStore } from '@/app/enroll/cueStore';
import { STARTER_ROUTINES, REAL_VS_AIR_CUES } from '@/app/enroll/realVsAirCues';
import { setClickPlayer } from '@/app/enroll/click';
import { registerRecordingController, type RecordingController, type StartTakeOptions } from '@/app/recording/controller';
import type { RecordingSession } from '@/app/recording/schema';
import { buildManifest, serializeManifest } from '@/app/recording/manifest';
import { planRecording } from '@/app/recording/plan';
import { encodeWav } from '@/app/recording/wav';
import { appFeatureDemand } from '@/app/featureDemand';
import { createInMemoryProvider } from '@zodal/store';
import {
  chroma,
  detectOnsets,
  matchToClicks,
  pairTake,
  parseWav,
  readFeatureRows,
  readTake,
  runPairTake,
  type PairResult,
} from '../../scripts/cue/lib_pair_take';

const SR = 16000;
const TAP_LAG_S = 0.025;
const CLAP_LAG_S = 0.01;
const FRAME_MS = 33;

/** A decaying noise burst (a tap or a clap) into `pcm` at `tSec`. */
function burst(pcm: Float32Array, tSec: number, amp: number, seed: number): void {
  let s = seed;
  const start = Math.round(tSec * SR);
  for (let i = 0; i < Math.round(0.06 * SR) && start + i < pcm.length; i++) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    pcm[start + i] += amp * (s / 2147483648 - 1) * Math.exp(-i / (0.008 * SR));
  }
}

interface Recorded {
  session: RecordingSession;
  opts: StartTakeOptions;
  t0: number;
  annotations: string;
}

/** The recorder, minus the browser: it records what it was asked for and hands the
 *  trainer's tag source the same begin/end calls `SessionRecorder` makes. */
function fakeRecorder(t0: number) {
  let rec: Recorded | null = null;
  let running = false;
  const controller: RecordingController = {
    start: async (session, opts = {}) => {
      rec = { session, opts, t0, annotations: '' };
      opts.tagSource?.beginTake({ t0, startedAt: '2026-09-27T10:00:00.000Z', session: 'take' });
      running = true;
      return true;
    },
    stop: async () => {
      if (rec) rec.annotations = rec.opts.tagSource?.endTake(lastT / 1000) ?? '';
      running = false;
    },
    isRecording: () => running,
  };
  let lastT = t0 * 1000;
  return { controller, get: () => rec, setLast: (t: number) => (lastT = t) };
}

/** Run the taps routine through the real store; returns the take folder it would write. */
async function recordSyntheticTake(root: string, opts: { bleed?: boolean } = {}): Promise<{ dir: string; played: Click[] }> {
  const T0_MS = 100_000;
  const rec = fakeRecorder(T0_MS / 1000 - 0.05);
  const unregister = registerRecordingController(rec.controller);
  const played: Click[] = [];
  setClickPlayer({ play: (clicks) => played.push(...clicks), stop: () => undefined });
  try {
    useTrainerStores({ cues: createCueStore(createInMemoryProvider([])), routines: createRoutineStore(createInMemoryProvider([])) });
    await useTrainer.getState().load();
    const taps = STARTER_ROUTINES.find((r) => r.id === 'starter:real-vs-air-taps')!;
    await useTrainer.getState().useRoutine(taps.id);
    expect(useTrainer.getState().routineName).toBe(taps.name);

    await useTrainer.getState().startTake(() => T0_MS);
    expect(useTrainer.getState().status).toBe('running');

    // The camera: a frame every 33 ms with the hand features the routine attends to.
    // `hand.pair.distance` dips to its minimum on the frame just before each clap sounds.
    const clapClicks = () => played.filter((c) => c.kind === 'beat' && useTrainer.getState().routine[useTrainer.getState().index]?.id === 'rva-clap');
    const rows: string[] = [];
    let tick = 0;
    let t = T0_MS;
    const clapTimes: number[] = [];
    while (useTrainer.getState().status !== 'done' && t < T0_MS + 400_000) {
      t += FRAME_MS;
      const s = useTrainer.getState();
      const onClap = s.routine[s.index]?.id === 'rva-clap';
      if (onClap) for (const c of clapClicks()) if (!clapTimes.includes(c.t)) clapTimes.push(c.t);
      // The hands close toward each clap and part after it: the minimum distance is the
      // last frame at or before the sound (the camera cannot see between frames).
      const nearest = clapTimes.reduce((m, c) => {
        const sound = c + CLAP_LAG_S * 1000;
        return Math.min(m, t <= sound ? sound - t : 1000 + (t - sound));
      }, Infinity);
      const vector: FeatureVector = {
        'hand.right.index.tip.y': 0.5 + 0.1 * Math.sin(t / 200),
        'hand.pair.distance': onClap ? 0.2 + nearest / 100 : 3,
      };
      rows.push(JSON.stringify({ tick: tick++, t: t / 1000, key: 'handVec.vector', value: vector }));
      rec.setLast(t);
      useTrainer.getState().sample(vector, t);
    }
    expect(useTrainer.getState().status).toBe('done');
    // `done` stops the take on a microtask.
    await new Promise((r) => setTimeout(r, 0));
    const r = rec.get()!;
    expect(r.session.streams.microphone).toBe(true);
    expect(r.session.name.startsWith('real-vs-air-')).toBe(true);

    // The room: taps on the real beats (soft/hard in fours for dynamics), claps on the
    // slate, and — unless we simulate a speaker leaking the click — silence in the air.
    const routine = useTrainer.getState().routine;
    const durationS = t / 1000 - r.t0 + 1;
    const pcm = new Float32Array(Math.ceil(durationS * SR));
    let seed = 7;
    for (let i = 0; i < pcm.length; i++) {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      pcm[i] = 0.0005 * (seed / 2147483648 - 1);
    }
    const annotation = r.annotations.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    const cueSpans = new Map<string, [number, number]>();
    for (const e of annotation.slice(1)) {
      const tag = String(e.tag);
      if (!tag.startsWith('cue:')) continue;
      const id = tag.slice(4);
      const span = cueSpans.get(id);
      cueSpans.set(id, span ? [span[0], Number(e.t)] : [Number(e.t), Number(e.t)]);
    }
    const spanOf = (tSec: number) => [...cueSpans.entries()].find(([, [a, b]]) => tSec >= a && tSec <= b)?.[0];
    const beatsByCue = new Map<string, Click[]>();
    for (const c of played) {
      if (c.kind !== 'beat') continue;
      const id = spanOf(c.t / 1000);
      if (!id) continue;
      beatsByCue.set(id, [...(beatsByCue.get(id) ?? []), c]);
    }
    for (const [id, beats] of beatsByCue) {
      for (const c of beats) {
        const at = c.t / 1000 - r.t0;
        if (id === 'rva-clap') burst(pcm, at + CLAP_LAG_S, 0.6, c.index + 11);
        else if (id.endsWith('-real')) {
          const hard = id === 'rva-dynamics-real' ? Math.floor(c.index / 4) % 2 === 1 : true;
          burst(pcm, at + TAP_LAG_S, hard ? 0.5 : 0.08, c.index + 101);
        } else if (opts.bleed && id.endsWith('-air')) burst(pcm, at + 0.002, 0.2, c.index + 301);
      }
    }
    expect(routine.map((c) => c.id)).toEqual(STARTER_ROUTINES[0].cueIds);

    // The folder, named by the same plan the recorder uses.
    const stem = r.session.name;
    const plan = planRecording({ session: r.session, stem, audioMime: 'audio/webm;codecs=opus', videoMime: 'video/webm', includeAnnotations: true });
    const dir = join(root, stem);
    mkdirSync(dir, { recursive: true });
    const wav = Buffer.from(await encodeWav({ numberOfChannels: 1, sampleRate: SR, length: pcm.length, getChannelData: () => pcm }).arrayBuffer());
    const streams = [];
    for (const f of plan.files) {
      const path = join(dir, f.name);
      if (f.kind === 'features') writeFileSync(path, rows.join('\n') + '\n');
      else if (f.kind === 'annotations') writeFileSync(path, r.annotations);
      else if (f.kind === 'microphone' && f.ext === 'wav') writeFileSync(path, wav);
      else if (f.kind === 'manifest') continue;
      else writeFileSync(path, ''); // the camera and the native mic: not read by the pipeline
      streams.push({ file: f.name, kind: f.kind as Exclude<typeof f.kind, 'manifest'>, mime: f.mime, ...(f.kind === 'microphone' && f.ext === 'wav' ? { sampleRate: SR } : {}) });
    }
    const manifestFile = plan.files.find((f) => f.kind === 'manifest')!;
    writeFileSync(join(dir, manifestFile.name), serializeManifest(buildManifest({ startedAt: 'x', t0: r.t0, stem, instrument: r.opts.instrument, streams, meta: r.opts.meta })));
    return { dir, played };
  } finally {
    unregister();
    setClickPlayer(null);
    useTrainerStores(null);
  }
}

// Each case runs a whole ~2.5 minute routine through the store and the pipeline: about a
// second alone, several under a loaded parallel suite.
describe('scripts/cue: a synthetic real-vs-air take, end to end (#247)', { timeout: 30_000 }, () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'thoremin-cue-'));
    useTrainer.getState().reset();
    appFeatureDemand.reset();
  });
  afterEach(() => {
    useTrainer.getState().reset();
    rmSync(root, { recursive: true, force: true });
  });

  it('the take describes itself: microphone + clicks + the routine cue specs in the manifest', async () => {
    const { dir, played } = await recordSyntheticTake(root);
    const take = readTake(dir);
    expect(take.cues.map((c) => c.id)).toEqual(STARTER_ROUTINES[0].cueIds);
    expect(take.micWav).toMatch(/\.mic\.wav$/);
    // Every click the player heard is in the take, at the time it was scheduled.
    expect(take.clicks.map((c) => c.t)).toEqual(played.map((c) => c.t / 1000));
    expect(take.windows).toHaveLength(7);
    for (const id of STARTER_ROUTINES[0].cueIds) expect(take.outcomes[id]).toBe('enough');
  });

  it('pairs every phrase beat for beat, with the player lag, levels and the slate offset', async () => {
    const { dir } = await recordSyntheticTake(root);
    const take = readTake(dir);
    const audio = parseWav(new Uint8Array(readFileSync(take.micWav!)));
    expect(audio.sampleRate).toBe(SR);
    const result: PairResult = pairTake(take, audio, readFeatureRows(take.featuresPath));
    expect(result.warnings).toEqual([]);
    expect(result.phrases.map((p) => p.phrase)).toEqual(['taps', 'alternating', 'dynamics']);
    for (const p of result.phrases) {
      expect(p.bpm).toBe(80);
      expect(p.beats).toHaveLength(16);
      expect(p.real!.matched).toBe(16);
      expect(p.real!.clickLagMs!).toBeGreaterThan(TAP_LAG_S * 1000 - 1.5);
      expect(p.real!.clickLagMs!).toBeLessThan(TAP_LAG_S * 1000 + 1.5);
      expect(p.air!.onsets).toBe(0);
      for (const b of p.beats) {
        // The air half's label: its own click plus the lag measured on the real half.
        expect(b.air!.intended!).toBeCloseTo(b.air!.click + p.real!.clickLagMs! / 1000, 6);
        expect(b.air!.levelDb).toBe(b.real!.levelDb);
      }
    }
    // Soft and hard: the loud fours are loud, and the air half inherits which is which.
    const dyn = result.phrases.find((p) => p.phrase === 'dynamics')!;
    const soft = dyn.beats.filter((b) => Math.floor(b.index / 4) % 2 === 0).map((b) => b.air!.levelDb!);
    const hard = dyn.beats.filter((b) => Math.floor(b.index / 4) % 2 === 1).map((b) => b.air!.levelDb!);
    expect(Math.min(...hard) - Math.max(...soft)).toBeGreaterThan(12);
    // The slate: four claps heard and seen; the sound follows the visible contact.
    expect(result.slate!.claps).toHaveLength(4);
    expect(result.slate!.claps.every((c) => c.onset !== null && c.visual !== null)).toBe(true);
    expect(result.avOffsetMs!).toBeGreaterThanOrEqual(0);
    expect(result.avOffsetMs!).toBeLessThan(FRAME_MS);
  });

  it('runs from the zip a downloads take arrives as, and writes only under the data root', async () => {
    const { dir } = await recordSyntheticTake(root);
    const files: Record<string, Uint8Array> = {};
    for (const n of readdirSync(dir)) files[`${n}`] = new Uint8Array(readFileSync(join(dir, n)));
    const zip = join(root, 'take.zip');
    writeFileSync(zip, zipSync(files));
    const dataRoot = join(root, 'data');
    const { outDir, result, written } = runPairTake(zip, { env: { THOREMIN_DATA_DIR: dataRoot } });
    expect(outDir).toBe(join(dataRoot, 'datasets', 'cue', result.stem));
    expect(existsSync(join(dataRoot, 'takes', 'cue', 'take'))).toBe(true);
    expect(written).toEqual(
      expect.arrayContaining(['pairs.json', 'slate.features.jsonl', 'taps.real.features.jsonl', 'taps.air.features.jsonl', 'dynamics.air.features.jsonl', 'mic.wav']),
    );
    const pairs = JSON.parse(readFileSync(join(outDir, 'pairs.json'), 'utf8')) as PairResult;
    expect(pairs.phrases).toHaveLength(3);
    // A half's slice is exactly its frames: ~20 s of 30 fps, every row untouched.
    const slice = readFileSync(join(outDir, 'taps.air.features.jsonl'), 'utf8').trim().split('\n');
    expect(slice.length).toBeGreaterThan(500);
    expect(JSON.parse(slice[0]).key).toBe('handVec.vector');
  });

  it('says so when the microphone hears the air half on the beat (click bleed)', async () => {
    const { dir } = await recordSyntheticTake(root, { bleed: true });
    const take = readTake(dir);
    const result = pairTake(take, parseWav(new Uint8Array(readFileSync(take.micWav!))), []);
    expect(result.warnings.some((w) => w.includes('Click bleed'))).toBe(true);
  });
});

describe('scripts/cue: the audio labels', () => {
  it('finds sharp onsets to the millisecond, and a new strum over a ringing one', () => {
    const pcm = new Float32Array(SR * 2);
    const times = [0.2, 0.5, 0.9, 1.3];
    times.forEach((t, i) => burst(pcm, t, 0.4, i + 1));
    const got = detectOnsets(pcm, SR);
    expect(got).toHaveLength(4);
    got.forEach((t, i) => expect(Math.abs(t - times[i])).toBeLessThan(0.002));

    // A chord that rings (slow decay) re-strummed while still sounding at a third of its
    // level: the hysteresis detector would miss the second; a rise detector does not.
    const ring = new Float32Array(SR);
    for (const [t0, amp] of [[0.1, 0.3], [0.5, 0.3]] as const) {
      for (let i = Math.round(t0 * SR); i < ring.length; i++) {
        const dt = i / SR - t0;
        ring[i] += amp * Math.exp(-dt / 0.4) * (Math.sin(2 * Math.PI * 196 * dt) + Math.sin(2 * Math.PI * 247 * dt));
      }
    }
    const strums = detectOnsets(ring, SR);
    expect(strums).toHaveLength(2);
    expect(Math.abs(strums[1] - 0.5)).toBeLessThan(0.003);
  });

  it('reads a chord as its pitch classes', () => {
    // C major (C4 E4 G4) with a little of the octave.
    const pcm = new Float32Array(SR);
    for (let i = 0; i < pcm.length; i++) {
      const t = i / SR;
      pcm[i] = 0.2 * (Math.sin(2 * Math.PI * 261.63 * t) + Math.sin(2 * Math.PI * 329.63 * t) + Math.sin(2 * Math.PI * 392.0 * t));
    }
    const c = chroma(pcm, SR, 0.1);
    const top = c.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, i]) => i).sort((a, b) => a - b);
    expect(top).toEqual([0, 4, 7]);
    expect(Math.max(...c.filter((_, i) => ![0, 4, 7].includes(i)))).toBeLessThan(0.3);
  });

  it('matches clicks to onsets one to one, nearest first', () => {
    expect(matchToClicks([1, 2, 3], [1.02, 1.04, 3.1, 5], 0.2)).toEqual([1.02, null, 3.1]);
  });

  it('parses the WAV the browser recorder writes', async () => {
    const pcm = new Float32Array([0, 0.5, -0.5, 0.25]);
    const blob = encodeWav({ numberOfChannels: 2, sampleRate: 44100, length: 4, getChannelData: (c) => (c === 0 ? pcm : pcm.map((x) => -x)) });
    const wav = parseWav(new Uint8Array(await blob.arrayBuffer()));
    expect(wav.sampleRate).toBe(44100);
    // The two channels cancel when averaged (to within one 16-bit step).
    for (const x of wav.pcm) expect(Math.abs(x)).toBeLessThan(1 / 32768 + 1e-9);
    const mono = parseWav(new Uint8Array(await encodeWav({ numberOfChannels: 1, sampleRate: 8000, length: 4, getChannelData: () => pcm }).arrayBuffer()));
    [...mono.pcm].forEach((x, i) => expect(x).toBeCloseTo(pcm[i], 4));
  });

  it('every real-vs-air cue is a clicked performance cue, and every phrase has both halves', () => {
    const phrases = new Map<string, string[]>();
    for (const c of REAL_VS_AIR_CUES) {
      expect(c.produces).toBe('performance');
      expect(c.sufficiency.kind).toBe('clicked');
      if (c.pairing) phrases.set(c.pairing.phrase, [...(phrases.get(c.pairing.phrase) ?? []), c.pairing.surface]);
    }
    for (const [, surfaces] of phrases) expect(surfaces.sort()).toEqual(['air', 'real']);
    for (const r of STARTER_ROUTINES) for (const id of r.cueIds) expect(REAL_VS_AIR_CUES.some((c) => c.id === id)).toBe(true);
  });
});
