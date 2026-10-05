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
 * the air, claps both slates 10 ms after their clicks, and taps soft/hard in fours for
 * the dynamics phrase. The camera sees the hands meet at each clap on the last frame at
 * or before the sound. The simulated MICROPHONE is what makes the clocks matter: its file
 * starts 40 ms late and its clock runs 100 ppm fast, so every mic-clock time is off by
 * 40 ms and growing, and the row-clock fields must take that back out. Every number
 * asserted below is derived from those choices.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { strum } from '../helpers/strum';
import type { Click, FeatureVector } from '@thoremin/sdk/enroll';
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
  gridLag,
  matchOnGrid,
  matchToClicks,
  pairTake,
  parseWav,
  readFeatureRows,
  readTake,
  runPairTake,
  type PairResult,
} from '../../scripts/cue/lib_pair_take';

const SR = 44100;
const TAP_LAG_S = 0.025;
const CLAP_LAG_S = 0.01;
const FRAME_MS = 33;
/** The simulated microphone: its file starts this late against t0... */
const MIC_OFFSET_S = 0.04;
/** ...and its clock gains this much per second (100 ppm). */
const MIC_DRIFT = 1e-4;
/** Where a TRUE take-relative time lands in the microphone file. */
const micTime = (trueRel: number) => trueRel + MIC_OFFSET_S + MIC_DRIFT * trueRel;

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
async function recordSyntheticTake(
  root: string,
  opts: { bleed?: boolean; softAmp?: number; hideSecondSlate?: boolean; clickDelayS?: number; micDevice?: string } = {},
): Promise<{ dir: string; played: Click[]; t0: number }> {
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
    const onSlate = () => useTrainer.getState().routine[useTrainer.getState().index]?.tags.includes('slate') ?? false;
    const clapClicks = () => played.filter((c) => c.kind === 'beat');
    // Bluetooth headphones: the player hears each click this late, and plays to what
    // they hear. The take logs when the click was SCHEDULED; nothing in it knows the delay.
    const heard = opts.clickDelayS ?? 0;
    const rows: string[] = [];
    let tick = 0;
    let t = T0_MS;
    const clapTimes: number[] = [];
    while (useTrainer.getState().status !== 'done' && t < T0_MS + 400_000) {
      t += FRAME_MS;
      const s = useTrainer.getState();
      const onClap = onSlate();
      // (Only the clicks of the slate being played: those planned within the last 20 s.)
      if (onClap) for (const c of clapClicks()) if (Math.abs(c.t - t) < 20_000 && !clapTimes.includes(c.t)) clapTimes.push(c.t);
      // The hands close toward each clap and part after it at the same speed: the
      // distance is a V with its point at the sound, sampled once per frame.
      const nearest = clapTimes.reduce((m, c) => Math.min(m, Math.abs(t - (c + (heard + CLAP_LAG_S) * 1000))), Infinity);
      const vector: FeatureVector = {
        'hand.right.index.tip.y': 0.5 + 0.1 * Math.sin(t / 200),
        'hand.pair.distance': onClap && !(opts.hideSecondSlate && s.index > 0) ? 0.2 + nearest / 100 : NaN,
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
        if (id.startsWith('rva-clap')) burst(pcm, micTime(at + heard + CLAP_LAG_S), 0.6, c.index + 11);
        else if (id.endsWith('-real')) {
          const hard = id === 'rva-dynamics-real' ? Math.floor(c.index / 4) % 2 === 1 : true;
          burst(pcm, micTime(at + heard + TAP_LAG_S), hard ? 0.5 : (opts.softAmp ?? 0.08), c.index + 101);
        } else if (opts.bleed && id.endsWith('-air')) burst(pcm, micTime(at + 0.002), 0.2, c.index + 301);
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
      streams.push({
        file: f.name,
        kind: f.kind as Exclude<typeof f.kind, 'manifest'>,
        mime: f.mime,
        ...(f.kind === 'microphone' && f.ext === 'wav' ? { sampleRate: SR } : {}),
        ...(f.kind === 'microphone' && opts.micDevice ? { device: opts.micDevice } : {}),
      });
    }
    const manifestFile = plan.files.find((f) => f.kind === 'manifest')!;
    writeFileSync(join(dir, manifestFile.name), serializeManifest(buildManifest({ startedAt: 'x', t0: r.t0, stem, instrument: r.opts.instrument, streams, meta: r.opts.meta })));
    return { dir, played, t0: r.t0 };
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
    expect(take.windows).toHaveLength(STARTER_ROUTINES[0].cueIds.length);
    for (const id of STARTER_ROUTINES[0].cueIds) expect(take.outcomes[id]).toBe('enough');
  });

  it('pairs every phrase beat for beat, and the row-clock labels undo the microphone clock', async () => {
    const { dir } = await recordSyntheticTake(root);
    const take = readTake(dir);
    const audio = parseWav(new Uint8Array(readFileSync(take.micWav!)));
    expect(audio.sampleRate).toBe(SR);
    const result: PairResult = pairTake(take, audio, readFeatureRows(take.featuresPath));
    expect(result.warnings).toEqual([]);
    expect(result.phrases.map((p) => p.phrase)).toEqual(['taps', 'alternating', 'dynamics']);

    // Both slates heard and seen; the mapping recovers the microphone's offset (to within
    // the camera frame the seen clap is quantised to) and its drift.
    expect(result.slates.map((x) => x.cue)).toEqual(['rva-clap', 'rva-clap-again']);
    for (const sl of result.slates) expect(sl.claps.every((c) => c.onset !== null && c.visual !== null)).toBe(true);
    // The seen clap is interpolated between frames, so the offset is not a frame off.
    const m = result.micToRows!;
    const trueOffsetMs = (MIC_OFFSET_S + MIC_DRIFT * m.atS) * 1000;
    expect(Math.abs(m.offsetMs - trueOffsetMs)).toBeLessThan(3);
    expect(Math.abs(m.driftMsPerS - MIC_DRIFT * 1000)).toBeLessThan(0.05);
    for (const sl of result.slates) expect(sl.madMs!).toBeLessThan(5);

    const errs = { mic: [] as number[], row: [] as number[] };
    for (const p of result.phrases) {
      expect(p.bpm).toBe(80);
      expect(p.beats).toHaveLength(16);
      expect(p.real!.matched).toBe(16);
      expect(p.air!.onsets).toBe(0);
      for (const b of p.beats) {
        // The mic-clock label is the click plus the phrase's median mic-clock lag...
        expect(b.air!.intended!).toBeCloseTo(b.air!.click + p.real!.clickLagMs! / 1000, 6);
        expect(b.air!.levelDb).toBe(b.real!.levelDb);
        // ...and against the TRUTH (the player strikes 25 ms after the click, on every
        // surface) the mic clock is off by the microphone, the row clock is not.
        const truth = b.air!.click + TAP_LAG_S;
        errs.mic.push(Math.abs(b.air!.intended! - truth) * 1000);
        errs.row.push(Math.abs(b.air!.intendedRow! - truth) * 1000);
        expect(Math.abs(b.real!.onsetRow! - (b.real!.click + TAP_LAG_S)) * 1000).toBeLessThan(5);
      }
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(errs.mic)).toBeGreaterThan(MIC_OFFSET_S * 1000);
    expect(mean(errs.row)).toBeLessThan(3);

    // Soft and hard: the loud fours are loud, and the air half inherits which is which.
    const dyn = result.phrases.find((p) => p.phrase === 'dynamics')!;
    const soft = dyn.beats.filter((b) => Math.floor(b.index / 4) % 2 === 0).map((b) => b.air!.levelDb!);
    const hard = dyn.beats.filter((b) => Math.floor(b.index / 4) % 2 === 1).map((b) => b.air!.levelDb!);
    expect(Math.min(...hard) - Math.max(...soft)).toBeGreaterThan(12);
  });

  it('a slate the camera did not see is not used, and says so: the offset stands, no drift', async () => {
    const { dir } = await recordSyntheticTake(root, { hideSecondSlate: true });
    const take = readTake(dir);
    const result = pairTake(take, parseWav(new Uint8Array(readFileSync(take.micWav!))), readFeatureRows(take.featuresPath));
    expect(result.slates[1].offsetMs).toBeNull();
    expect(result.warnings.some((w) => w.startsWith('Slate "rva-clap-again"'))).toBe(true);
    expect(result.micToRows!.driftMsPerS).toBe(0);
    // Still within a few ms early on, and at worst the uncorrected drift (~14 ms) late.
    const taps = result.phrases[0].beats.map((b) => Math.abs(b.air!.intendedRow! - (b.air!.click + TAP_LAG_S)) * 1000);
    expect(Math.max(...taps)).toBeLessThan(6);
  });

  // Bluetooth headphones (#247 follow-up): the click is heard 150-300 ms after it is
  // logged, steadily. The real half measures that delay as part of the player's lag, and
  // the air half inherits it, so its label is still where the strike would have sounded.
  // At 400 ms (plus the 25 ms player lag) every tap is nearer the NEXT click than its own:
  // nearest-click matching would label each with the wrong beat; the grid lag does not.
  for (const delay of [0.2, 0.4]) {
    it(`a click heard ${delay * 1000} ms late (Bluetooth) still pairs every beat with its own tap`, async () => {
      const { dir } = await recordSyntheticTake(root, { clickDelayS: delay, micDevice: 'MacBook Pro Microphone' });
      const take = readTake(dir);
      const result = pairTake(take, parseWav(new Uint8Array(readFileSync(take.micWav!))), readFeatureRows(take.featuresPath));
      // Past half a beat, the pairing says what the numbering rests on; nothing else.
      for (const w of result.warnings) expect(w).toMatch(/over half a beat/);
      expect(result.warnings.length > 0).toBe(delay + TAP_LAG_S + MIC_OFFSET_S > 0.375);
      for (const sl of result.slates) expect(sl.claps.every((c) => c.onset !== null && c.visual !== null)).toBe(true);
      for (const p of result.phrases) {
        expect(p.real!.matched).toBe(16);
        // The mic-clock lag is the delay + the player + the microphone's start offset.
        expect(p.real!.clickLagMs!).toBeGreaterThan((delay + TAP_LAG_S + MIC_OFFSET_S) * 1000 - 2);
        expect(p.real!.clickLagMs!).toBeLessThan((delay + TAP_LAG_S + MIC_OFFSET_S) * 1000 + 20);
        p.beats.forEach((b, i) => {
          expect(b.index).toBe(i);
          // Each real onset is its OWN beat's tap, and each air label is its own beat's.
          expect(Math.abs(b.real!.onsetRow! - (b.real!.click + delay + TAP_LAG_S)) * 1000).toBeLessThan(5);
          expect(Math.abs(b.air!.intendedRow! - (b.air!.click + delay + TAP_LAG_S)) * 1000).toBeLessThan(6);
        });
      }
    });
  }

  it("warns when the microphone was a headset's (the call-quality profile)", async () => {
    const { dir } = await recordSyntheticTake(root, { clickDelayS: 0.2, micDevice: 'AirPods Pro (Hands-Free)' });
    const take = readTake(dir);
    expect(take.micDevice).toBe('AirPods Pro (Hands-Free)');
    const result = pairTake(take, parseWav(new Uint8Array(readFileSync(take.micWav!))), []);
    expect(result.warnings.some((w) => w.includes("a headset's"))).toBe(true);
  });

  it('names the unheard beats when soft taps are lost in the room', async () => {
    // Soft taps at the noise floor: the pairing cannot hear them and must say which.
    const { dir } = await recordSyntheticTake(root, { softAmp: 0.0008 });
    const take = readTake(dir);
    const result = pairTake(take, parseWav(new Uint8Array(readFileSync(take.micWav!))), readFeatureRows(take.featuresPath));
    const w = result.warnings.find((x) => x.startsWith('Phrase "dynamics"'));
    expect(w).toMatch(/8\/16 real beats heard \(unheard: 1, 2, 3, 4, 9, 10, 11, 12\)/);
  });

  it('a take whose microphone is only WebM says how to convert it', async () => {
    const { dir } = await recordSyntheticTake(root);
    const wav = readdirSync(dir).find((n) => n.endsWith('.mic.wav'))!;
    unlinkSync(join(dir, wav));
    const take = readTake(dir);
    expect(take.micWav).toBeNull();
    const result = pairTake(take, null, []);
    expect(result.warnings.join(' ')).toMatch(/only in .*\.mic\.webm.*ffmpeg/);
  });

  it('runs from the zip a downloads take arrives as, and writes only under the data root', async () => {
    const { dir } = await recordSyntheticTake(root);
    // As a Finder re-zip makes it: the folder inside, plus AppleDouble resource forks.
    const files: Record<string, Uint8Array> = {};
    for (const n of readdirSync(dir)) {
      files[`take/${n}`] = new Uint8Array(readFileSync(join(dir, n)));
      files[`__MACOSX/take/._${n}`] = new Uint8Array([0]);
    }
    const zip = join(root, 'take.zip');
    writeFileSync(zip, zipSync(files));
    const dataRoot = join(root, 'data');
    const { outDir, result, written } = runPairTake(zip, { env: { THOREMIN_DATA_DIR: dataRoot } });
    expect(outDir).toBe(join(dataRoot, 'datasets', 'cue', result.stem));
    expect(existsSync(join(dataRoot, 'takes', 'cue', 'take'))).toBe(true);
    expect(written).toEqual(
      expect.arrayContaining(['pairs.json', 'rva-clap.features.jsonl', 'rva-clap-again.features.jsonl', 'taps.real.features.jsonl', 'taps.air.features.jsonl', 'dynamics.air.features.jsonl', 'mic.wav']),
    );
    // And never into a repository: this test file's own work tree is refused.
    expect(() => runPairTake(zip, { env: { THOREMIN_DATA_DIR: dataRoot }, outDir: join(process.cwd(), 'pairs-out') })).toThrow(/git work tree/);
    expect(existsSync(join(process.cwd(), 'pairs-out'))).toBe(false);
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
  it('finds sharp onsets to the millisecond', () => {
    const pcm = new Float32Array(SR * 2);
    const times = [0.2, 0.5, 0.9, 1.3];
    times.forEach((t, i) => burst(pcm, t, 0.4, i + 1));
    const got = detectOnsets(pcm, SR);
    expect(got).toHaveLength(4);
    got.forEach((t, i) => expect(Math.abs(t - times[i])).toBeLessThan(0.002));
  });

  // Synthesising 15 s of a six-string, ten-partial strum at 48 kHz twice takes a few
  // seconds on a CI runner (8 s measured), past the 5 s default.
  it('hears every strum of a chord re-strummed while it still rings (the guitar routine)', { timeout: 60_000 }, () => {
    // Six strings, 8 ms strum spread, ringing with a 1.5 s time constant, 16 strums of
    // the SAME chord at 70 bpm: the level barely rises on each (measured: a level-rise
    // detector found 0 of 16); the attack's high partials still do.
    // At a browser's rate: the difference emphasis needs the attack's upper partials,
    // and at 16 kHz it misses one or two (the pipeline warns below 44.1 kHz).
    const rate = 48000;
    const times = Array.from({ length: 16 }, (_, i) => 0.5 + (i * 60) / 70);
    for (const [tauS, spreadMs] of [[0.6, 3], [1.5, 8]] as const) {
      const got = detectOnsets(strum({ sampleRate: rate, times, tauS, spreadMs, durationS: 15 }), rate);
      const m = matchToClicks(times, got, 0.03);
      expect(m.filter((x) => x !== null), `tau ${tauS} spread ${spreadMs}`).toHaveLength(16);
      expect(got).toHaveLength(16);
      m.forEach((x, i) => expect(Math.abs(x! - times[i])).toBeLessThan(spreadMs / 1000 + 0.002));
    }
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

  it('reads the player lag off the grid: early, late, or most of a beat late', () => {
    const clicks = Array.from({ length: 16 }, (_, i) => 10 + i * 0.75);
    for (const lag of [-0.03, 0.025, 0.2, 0.425, 0.55]) {
      const taps = clicks.map((c, i) => c + lag + (i % 3) * 0.004);
      expect(gridLag(clicks, taps, 0.75)!).toBeCloseTo(lag + 0.004, 2);
      const { matched } = matchOnGrid(clicks, taps, 0.75);
      matched.forEach((x, i) => expect(x).toBe(taps[i]));
    }
    // Beyond 3/4 of a beat the phase reads early (580 ms at 80 bpm reads -170 ms), and
    // the match count settles which beat: all heard, or the first tap unheard (the true
    // numbering then still matches one more). With the LAST tap unheard the two numberings
    // truly tie: without a prior the phrase is left unlabelled, with one it is right.
    const late = clicks.map((c) => c + 0.58);
    expect(matchOnGrid(clicks, late, 0.75).matched).toEqual(late);
    expect(matchOnGrid(clicks, late.slice(1), 0.75).matched).toEqual([null, ...late.slice(1)]);
    expect(matchOnGrid(clicks, late.slice(0, -1), 0.75).ambiguous).toBe(true);
    expect(matchOnGrid(clicks, late.slice(0, -1), 0.75, { priorLagS: 0.57 }).matched).toEqual([...late.slice(0, -1), null]);
    // A bounce 80 ms after every tap never replaces its tap.
    const taps = clicks.map((c) => c + 0.3);
    const withBounces = [...taps, ...taps.map((t) => t + 0.08)].sort((a, b) => a - b);
    expect(matchOnGrid(clicks, withBounces, 0.75).matched).toEqual(taps);
    // First four taps unheard (soft): numbering must not slide by four beats.
    const softStart = taps.map((t, i) => (i < 4 ? null : t));
    expect(matchOnGrid(clicks, taps.slice(4), 0.75).matched).toEqual(softStart);
    // Fast tempo (160 bpm, beat 375 ms), player 30 ms early, first tap unheard: lag -30
    // and lag +345 both match 15 of 16. Without a prior the phrase is left unlabelled;
    // with the player's lag from other phrases it is numbered right.
    const fast = Array.from({ length: 16 }, (_, i) => 10 + i * 0.375);
    const early = fast.map((c) => c - 0.03);
    const tie = matchOnGrid(fast, early.slice(1), 0.375);
    expect(tie.ambiguous).toBe(true);
    expect(tie.matched.every((x) => x === null)).toBe(true);
    const resolved = matchOnGrid(fast, early.slice(1), 0.375, { priorLagS: -0.02 });
    expect(resolved.ambiguous).toBeUndefined();
    expect(resolved.matched).toEqual([null, ...early.slice(1)]);
    // Nothing regular: no lag claimed.
    expect(gridLag(clicks, [10.0, 10.2, 10.45, 10.6], 0.75)).toBeNull(); // phases spread round the beat
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
