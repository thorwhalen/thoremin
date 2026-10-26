/**
 * The stability suite: which instrument is played on which real stream, and what the player meant.
 * Shared by the baseline report (`baseline.ts`) and the regression tests (`test/stability/`), so
 * the numbers in `docs/testing/stability.md` and the thresholds the tests hold are measured the
 * same way.
 *
 * Streams (all real hands; see each fixture's `meta.json` for its source and licence):
 *
 * - `signs-gaps` / `signs-flow`: a real signer fingerspelling (`real_hands_signs`), each sign clip
 *   followed by the hand gone (gaps) or by a 0.2 s dropout (flow). The target of a chord letter's
 *   clip (A..G) is that letter's chord in the instrument's key; other letters and the gaps make no
 *   claim (an instrument may hold its chord through them).
 * - `map-script`: the Chord Map played by a REAL held hand (the stillest second of the signer's
 *   open-palm B clips) placed by script: holds on cell centres (each claims that cell's chord),
 *   a hold on the edge between two cells and one where three meet (no claim: either chord is
 *   fine, but it must not keep changing), a slow sweep, the hand gone and back.
 * - `choir`, `conducting`: hands that are NOT playing the instrument (a choir conductor, an
 *   orchestral conductor): every chord they start is a chord the player did not ask for, and the
 *   drift and flicker numbers say how the instrument copes with real hands moving. For Conduct
 *   the Chords, `conducting` IS playing: a real conductor beating 4/4.
 * - `body-conducting`: a choir conductor's body (`video_body_conducting_44`, Commons, CC BY 3.0),
 *   for the pose instruments; `head`: the maintainer's head-pose clip (`video_head_pose`), for the
 *   head instruments. Neither claims a chord: the numbers are how steady the chords are.
 */
import type { Hand, HandsFrame } from '@thoremin/sdk/nodes/domain';
import type { StreamRecord } from '@thoremin/dag';
import { diatonicTriad, letterChordSpec, letterDegree, type NoteLetter, type ScaleSpec } from '@thoremin/sdk/music/theory';
import { layoutCells } from '@thoremin/ext-harmony/lib/chord_map';
import { chordMapRegions } from '@thoremin/ext-harmony/nodes/chord_map';
import { readdirSync, readFileSync } from 'node:fs';
import { loadScore } from '@/slices/conductor/score/load';
import { join } from 'node:path';
import { loadAslModels, type AslModels } from '@thoremin/ext-asl/nodes/asl_signs';
import { createSharedSource } from '@thoremin/ext-faces/app/sharedModels';
import { categorizerChordPlay, CHORD_MODALITY } from '@thoremin/ext-faces/lib/categorizerChord';
import type { ChordModality } from '@thoremin/ext-faces/schema';
import { chordKey, runSeed, seedSettings, type SeedRun } from './lib_run';
import { handTrack, palmCentre, performance, resample, stillestRun, type Performance, type Point, type Segment } from './lib_streams';
import { heldFromMotion, stabilityMetrics, type StabilityMetrics, type Timeline } from './lib_metrics';

/** How the suite reads a committed fixture (the tests' loader, or the CLI's). */
export type LoadRecords = (scenario: string, key: string) => StreamRecord[];

export const STREAMS = ['signs-gaps', 'signs-flow', 'map-script', 'choir', 'conducting', 'body-conducting', 'head'] as const;
export type StreamId = (typeof STREAMS)[number];

export interface StreamCase {
  frames: HandsFrame[];
  /** The playing hand is seen, per frame. */
  hand: boolean[];
  /** The playing hand is held still, per frame. */
  held: boolean[];
  /** The intended chord per frame, from the run (it needs the instrument's key or cells). */
  target?: (run: SeedRun) => (string | null | undefined)[];
  /** A body or face stream played with it (the hands are then empty frames of the same length). */
  body?: readonly unknown[];
  face?: readonly unknown[];
}

/** The instruments the suite measures, and the streams each is played on. */
export const INSTRUMENTS: Readonly<Record<string, readonly StreamId[]>> = {
  'Chord Map': ['map-script', 'choir', 'conducting'],
  'Chord Map Paths': ['map-script', 'choir', 'conducting'],
  'Chord Map Strum': ['map-script', 'choir'],
  'Chord Wheel': ['choir', 'conducting'],
  'ASL Chords': ['signs-gaps', 'signs-flow', 'choir'],
  'Sign Map': ['signs-gaps', 'signs-flow', 'choir'],
  'Sign Wheel': ['signs-gaps', 'signs-flow', 'choir'],
  'Conduct the Chords': ['conducting', 'choir'],
  'Hand-shape Chords': ['signs-gaps', 'choir'],
  'Pose Chords': ['body-conducting'],
  'Head Chords': ['head'],
};

/** A palm moving slower than this (frame widths per second) is held. */
export const HELD_SPEED = 0.05;

const FPS = 30;

interface SignSegment {
  from: number;
  to: number;
  sign: string | null;
}

/** Every hand's palm, per frame (for the held test on a stream with no script). */
function heldAll(frames: readonly HandsFrame[]): boolean[] {
  const byLabel = (label: 'Left' | 'Right') =>
    heldFromMotion(
      frames.map((_, i) => i / FPS),
      handTrack(frames, label).map((h, i) => (h ? { x: palmCentre(h).x / frames[i].width, y: palmCentre(h).y / frames[i].height } : null)),
      { maxSpeed: HELD_SPEED },
    );
  const l = byLabel('Left');
  const r = byLabel('Right');
  return frames.map((f, i) => f.hands.length > 0 && f.hands.every((h) => (h.handedness === 'Left' ? l[i] : r[i])));
}

/** The chord a letter names in a key, as a chord key. */
export function letterChordKey(spec: ScaleSpec, letter: NoteLetter): string | null {
  return chordKey(diatonicTriad(letterChordSpec(spec), letterDegree(spec, letter)));
}

/** The instruments that turn signed letters into chords: the sign streams claim a chord for them. */
export const SIGN_INSTRUMENTS: readonly string[] = ['ASL Chords', 'Sign Map', 'Sign Wheel'];

function signCase(load: LoadRecords, which: 'gaps' | 'flow', meta: SuiteMeta, instrument: string): StreamCase {
  const frames = load('real_hands_signs', `${which}.hands`).map((r) => r.value as HandsFrame);
  const segments = meta.performances[which].segments;
  const sign = frames.map((_, i) => segments.find((s) => i >= s.from && i < s.to)?.sign ?? null);
  return {
    frames,
    hand: frames.map((f) => f.hands.length > 0),
    held: heldAll(frames),
    target: !SIGN_INSTRUMENTS.includes(instrument) ? undefined : (run) => {
      const spec = (run.values('ui.chordSpec') as (ScaleSpec | undefined)[]).find(Boolean);
      return sign.map((s) => {
        const letter = s?.toUpperCase();
        return spec && letter && 'ABCDEFG'.includes(letter) ? letterChordKey(spec, letter as NoteLetter) : undefined;
      });
    },
  };
}

/** The Chord Map's cells for a seed, in display fractions, for a frame of this size. */
export function mapCells(instrument: string, width: number, height: number) {
  const c = (seedSettings(instrument) as unknown as { chordMap: { layout: 'harmonic'; chordHand: 'left' | 'right'; split: number; cellSize: number } }).chordMap;
  return layoutCells(c.layout, chordMapRegions(c.chordHand, c.split).chords, { aspect: width / height, cellSize: c.cellSize });
}

/** The label the model gives the seed's chord hand (the map mirrors handedness by default). */
export function chordHandLabel(instrument: string): 'Left' | 'Right' {
  const c = (seedSettings(instrument) as unknown as { chordMap: { chordHand: 'left' | 'right'; mirrorHandedness: boolean } }).chordMap;
  return (c.chordHand === 'left') === c.mirrorHandedness ? 'Right' : 'Left';
}

/** The app's public files (the shipped demo categorizers). */
const PUBLIC = join(process.cwd(), 'public');

export const MAP_W = 1280;
export const MAP_H = 720;

type SuiteMeta = { performances: Record<string, { segments: SignSegment[] }> };

/** The open palm a Chord Map player holds up: the stillest second of the signer's B clips (the
 *  frames the model lost inside it stay lost). */
export function openPalmTemplate(load: LoadRecords, meta: SuiteMeta): (Hand | null)[] {
  const frames = load('real_hands_signs', 'gaps.hands').map((r) => r.value as HandsFrame);
  const b = meta.performances.gaps.segments.filter((s) => s.sign === 'b');
  const runs = b.map((s) => stillestRun(handTrack(frames.slice(s.from, s.to)), FPS));
  // The stillest of the B clips' stillest runs.
  const spread = (run: (Hand | null)[]) => {
    const pts = run.filter((h): h is Hand => !!h).map(palmCentre);
    const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    return Math.max(...pts.map((p) => Math.hypot(p.x - mx, p.y - my)));
  };
  return runs.reduce((best, r) => (spread(r) < spread(best) ? r : best));
}

/** The scripted Chord Map performance, by a real held hand. */
export function mapPerformance(template: readonly (Hand | null)[], instrument: string): Performance & { points: Point[] } {
  const cells = mapCells(instrument, MAP_W, MAP_H);
  const at = (i: number): Point => ({ x: cells[i].x, y: cells[i].y });
  const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const tri = (a: Point, b: Point, c: Point): Point => ({ x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 });
  // Cells 7 (the tonic in the middle row), 6, 11 and 2: four chords a player walks between.
  const [c0, c1, c2, c3] = [7, 6, 11, 2].map(at);
  const script: Segment[] = [
    { gone: 1 },
    { hold: c0, s: 2.5, label: 'c0' },
    { move: [c0, c1], s: 0.5 },
    { hold: c1, s: 2.5, label: 'c1' },
    { move: [c1, c2], s: 0.5 },
    { hold: c2, s: 2.5, label: 'c2' },
    { move: [c2, c3], s: 0.6 },
    { hold: c3, s: 2.5, label: 'c3' },
    { move: [c3, mid(c0, c1)], s: 0.6 },
    { hold: mid(c0, c1), s: 4, label: 'edge' },
    { move: [mid(c0, c1), tri(c0, c1, c2)], s: 0.3 },
    { hold: tri(c0, c1, c2), s: 3, label: 'vertex' },
    { move: [at(10), at(14)], s: 5 },
    { gone: 1.2 },
    { hold: c0, s: 2.5, label: 'c0' },
    { gone: 1 },
  ];
  const perf = performance(template, script, { width: MAP_W, height: MAP_H, handedness: chordHandLabel(instrument) });
  return { ...perf, points: [c0, c1, c2, c3] };
}

/** How far inside a cell (in cell widths from its centre) the scripted palm must be for the
 *  performance to claim that cell's chord: nearer an edge, either chord is fine. */
export const CELL_CLAIM = 0.35;

async function mapCase(template: readonly (Hand | null)[], instrument: string): Promise<StreamCase> {
  const perf = mapPerformance(template, instrument);
  const still = template.find((h): h is Hand => !!h)!;
  const cells = mapCells(instrument, MAP_W, MAP_H);
  // What each cell plays, one at a time (runs share nothing, but one at a time is cheap and sure).
  const keys: (string | null)[] = [];
  for (const c of cells) keys.push(await calibrateMap(instrument, still, { x: c.x, y: c.y }));
  const aspect = MAP_W / MAP_H;
  const claim = (p: Point | null): string | null | undefined => {
    if (!p) return undefined;
    let best = -1;
    let bestD = Infinity;
    cells.forEach((c, i) => {
      const d = Math.hypot((p.x - c.x) / c.w, (p.y - c.y) / (c.w * aspect));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best >= 0 && bestD <= CELL_CLAIM ? keys[best] : undefined;
  };
  return {
    frames: perf.frames,
    hand: perf.frames.map((f) => f.hands.length > 0),
    held: perf.holding.map((h, i) => h && perf.frames[i].hands.length > 0),
    // The edge and vertex holds claim nothing: either neighbour is right, changing is not.
    target: () => perf.at.map((p, i) => (perf.labels[i] === 'edge' || perf.labels[i] === 'vertex' ? undefined : claim(p))),
  };
}

function plainCase(frames: HandsFrame[]): StreamCase {
  return { frames, hand: frames.map((f) => f.hands.length > 0), held: heldAll(frames) };
}

/** A still, jitter-free hand at a point for a second: what a cell's chord IS, for the targets. */
async function calibrateMap(instrument: string, template: Hand, p: Point): Promise<string | null> {
  const perf = performance([template], [{ gone: 0.3 }, { hold: p, s: 1 }], { width: MAP_W, height: MAP_H, handedness: chordHandLabel(instrument) });
  const run = await runSeed(instrument, perf.frames);
  return run.chord[run.chord.length - 1];
}

/** Build one stream for one instrument. */
export async function buildCase(load: LoadRecords, meta: SuiteMeta, instrument: string, stream: StreamId): Promise<StreamCase> {
  switch (stream) {
    case 'signs-gaps':
      return signCase(load, 'gaps', meta, instrument);
    case 'signs-flow':
      return signCase(load, 'flow', meta, instrument);
    case 'choir':
      return plainCase(load('real_hands_choir', 'src.hands').map((r) => r.value as HandsFrame));
    case 'conducting':
      return plainCase(resample(load('conducting_44', 'src.hands'), FPS));
    case 'map-script':
      return mapCase(openPalmTemplate(load, meta), instrument);
    case 'body-conducting': {
      const body = load('video_body_conducting_44', 'camBody.body').map((r) => r.value as { present?: boolean; landmarks?: unknown[] });
      const seen = body.map((b) => !!b && (b.present ?? (b.landmarks?.length ?? 0) > 0));
      return { frames: body.map(() => ({ width: 640, height: 360, hands: [] })), hand: seen, held: seen.map(() => false), body };
    }
    case 'head': {
      const face = load('video_head_pose', 'face.pose').map((r) => r.value as { present?: boolean });
      return { frames: face.map(() => ({ width: 1280, height: 720, hands: [] })), hand: face.map((f) => !!f?.present), held: face.map(() => false), face };
    }
  }
}

export interface CaseResult {
  instrument: string;
  stream: StreamId;
  branches: string[];
  chord: StabilityMetrics;
  heard: StabilityMetrics;
}

/** The sign reader's weights, loaded once and handed over already resolved: the reader then has
 *  them from its first frame, the same frame on every run (a load racing the frames made the
 *  numbers depend on how fast the weights were read). */
let aslModels: Promise<AslModels> | null = null;
const readyAslModels = () => (aslModels ??= loadAslModels());

/** What the app hands a seed off the tick that a headless run must supply itself: a conducted
 *  seed's score (`scoreDoc`), or the shipped demo categorizer a categorizer-chords seed names, as the app resolves it off the
 *  tick (the `categorizerChordsModel` transient, read from the app's shared files), and the feature
 *  groups the app claims for it (without the claim the vector node computes nothing). */
async function appTransients(instrument: string): Promise<{ transients?: Record<string, unknown>; resources?: Record<string, unknown> }> {
  const settings = seedSettings(instrument) as unknown as { categorizerChords?: { id?: string }; conductor?: { enabled?: boolean; piece?: string } };
  // A conducted piece: the score the conductor slice's loader resolves into the `scoreDoc` transient.
  if (settings.conductor?.enabled && settings.conductor.piece) {
    const file = readdirSync(join(PUBLIC, 'scores')).find((f) => f.startsWith(`${settings.conductor!.piece}.`));
    if (!file) throw new Error(`no score for ${settings.conductor.piece} under public/scores`);
    return { transients: { scoreDoc: await loadScore(new Uint8Array(readFileSync(join(PUBLIC, 'scores', file))), file) } };
  }
  const id = settings.categorizerChords?.id;
  if (!id) return {};
  const [modality, ...rest] = id.split(':') as [ChordModality, ...string[]];
  const shared = createSharedSource({ fetchJson: async (path) => JSON.parse(readFileSync(join(PUBLIC, path), 'utf8')) as unknown });
  const record = await shared.load(rest.join(':'), modality);
  if (!record) throw new Error(`no shared categorizer ${id} under public/`);
  const groups = new Set(CHORD_MODALITY[modality].groups);
  return {
    transients: { categorizerChordsModel: categorizerChordPlay({ id, name: record.name, modality, categorizer: record.model.categorizer }) },
    resources: { featureDemand: () => groups },
  };
}

/** Run one instrument on one stream and measure it. */
export async function measure(load: LoadRecords, meta: SuiteMeta, instrument: string, stream: StreamId, patch?: Record<string, unknown>): Promise<CaseResult & { run: SeedRun; timeline: Timeline }> {
  const c = await buildCase(load, meta, instrument, stream);
  const models = await readyAslModels();
  const cat = await appTransients(instrument);
  const run = await runSeed(instrument, c.frames, {
    patch,
    record: ['ui.chordSpec'],
    resources: { loadAslModels: () => Promise.resolve(models), ...cat.resources },
    transients: cat.transients,
    body: c.body,
    face: c.face,
  });
  const target = c.target?.(run);
  const timeline: Timeline = { t: run.t, out: run.chord, hand: c.hand, held: c.held, target };
  return {
    instrument,
    stream,
    branches: run.branches,
    chord: stabilityMetrics(timeline),
    heard: stabilityMetrics({ ...timeline, out: run.heard, target: undefined }),
    run,
    timeline,
  };
}

