/**
 * The physical theremin on real hands: the seed's own composed graph (`runSeed`) fed REAL hand
 * landmarks placed by script (`lib_streams.performance`, the Chord Map's method), measured at
 * several assistance levels. The chord metrics of `lib_metrics.ts` do not apply to a continuous
 * pitch, so these are the theremin's own:
 *
 * - **Held warble, cents**: the RMS of the frame-to-frame pitch change while held (the first 0.5 s
 *   of a hold left out): what a still hand sounds like. A held real hand also drifts slowly (about
 *   a semitone over a hold here); that is the next column's business.
 * - **Note changes per held second**: how often the nearest semitone changes while held: a warble
 *   heard as two notes.
 * - **Sweep order**: the share of the sweep's frame-to-frame pitch steps that go the way the hand
 *   goes (toward the rod is up).
 * - **Open over fist, semitones**: the median pitch of the signer's open palm (B) less that of the
 *   fist (A), both held at the same place: aerial fingering on a real hand.
 *
 * Used by `test/theremin/theremin_stability.test.ts` and printed by `scripts/stability/theremin.ts`.
 */
import type { Hand, HandsFrame } from '@thoremin/sdk/nodes/domain';
import { runSeed } from './lib_run';
import { handTrack, performance, stillestRun, type Point, type Segment } from './lib_streams';
import { MAP_H, MAP_W, openPalmTemplate, type LoadRecords } from './suite';
import { DEFAULT_PHYSICAL_THEREMIN } from '@/slices/theremin/schema';
import type { PhysicalThereminStatus } from '@/slices/theremin/nodes/physical_theremin';

export const THEREMIN_SEED = 'Physical Theremin';
export const THEREMIN_NODE = 'physTheremin';
/** The player's right hand, as the mirrored webcam's model labels it. */
const PITCH_HAND = 'Left' as const;
const FPS = 30;

export interface ThereminMetrics {
  level: number;
  heldWarbleCents: number;
  noteChangesPerHeldS: number;
  sweepOrder: number;
  openOverFist: number;
}

/** The pitch per frame (null while silent or without a hand) from a run's recorded status. */
async function pitches(frames: readonly HandsFrame[], level: number): Promise<(number | null)[]> {
  const run = await runSeed(THEREMIN_SEED, frames, {
    patch: { physicalTheremin: { ...DEFAULT_PHYSICAL_THEREMIN, enabled: true, assist: { ...DEFAULT_PHYSICAL_THEREMIN.assist, level, custom: false } } },
    record: [`${THEREMIN_NODE}.status`],
  });
  return (run.values(`${THEREMIN_NODE}.status`) as PhysicalThereminStatus[]).map((s) => (s?.pitchHand && s.midi !== null ? s.midi : null));
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : NaN;
};

/** The holds and the sweep a player plays: four distances from the rod, then a slow sweep in. */
export function thereminScript(): { script: Segment[]; holds: Point[] } {
  const holds: Point[] = [0.78, 0.68, 0.58, 0.48].map((x) => ({ x, y: 0.45 }));
  const script: Segment[] = [
    { gone: 0.5 },
    ...holds.flatMap((p, i): Segment[] => [{ hold: p, s: 2.5, label: `h${i}` }, { move: [p, holds[i + 1] ?? holds[0]], s: 0.4 }]),
    { move: [{ x: 0.45, y: 0.45 }, { x: 0.8, y: 0.45 }], s: 4, label: 'sweep' },
    // Long enough to outlast the dropout hold: the hand has really gone.
    { gone: 1.2 },
  ];
  return { script, holds };
}

/** The stillest second of the first clip of a sign, as a template. */
function signTemplate(load: LoadRecords, meta: SignMeta, sign: string): (Hand | null)[] {
  const frames = load('real_hands_signs', 'gaps.hands').map((r) => r.value as HandsFrame);
  const seg = meta.performances.gaps.segments.find((s) => s.sign === sign);
  if (!seg) throw new Error(`no ${sign} clip in real_hands_signs`);
  return stillestRun(handTrack(frames.slice(seg.from, seg.to)), FPS);
}

type SignMeta = { performances: Record<string, { segments: { from: number; to: number; sign: string | null }[] }> };

export async function measureTheremin(load: LoadRecords, meta: SignMeta, level: number): Promise<ThereminMetrics> {
  const opts = { width: MAP_W, height: MAP_H, handedness: PITCH_HAND };
  const { script } = thereminScript();
  const perf = performance(openPalmTemplate(load, meta as never), script, opts);
  const p = await pitches(perf.frames, level);
  // Held jitter and note changes, per hold.
  let sq = 0;
  let n = 0;
  let changes = 0;
  let heldS = 0;
  const labels = [...new Set(perf.labels.filter((l): l is string => !!l && l.startsWith('h')))];
  for (const label of labels) {
    const idx = perf.labels.map((l, i) => (l === label ? i : -1)).filter((i) => i >= 0).slice(FPS / 2);
    const vals = idx.map((i) => p[i]).filter((v): v is number => v !== null);
    for (let k = 1; k < vals.length; k++) {
      sq += (100 * (vals[k] - vals[k - 1])) ** 2;
      n++;
    }
    for (let k = 1; k < vals.length; k++) if (Math.round(vals[k]) !== Math.round(vals[k - 1])) changes++;
    heldS += idx.length / FPS;
  }
  // The sweep goes toward the rod: the pitch should rise.
  const sweep = perf.labels.map((l, i) => (l === 'sweep' ? p[i] : null)).filter((v): v is number => v !== null);
  let up = 0;
  let steps = 0;
  for (let k = 1; k < sweep.length; k++) {
    if (sweep[k] === sweep[k - 1]) continue;
    steps++;
    if (sweep[k] > sweep[k - 1]) up++;
  }
  // Aerial fingering: the open palm and the fist, held at the same place.
  const at: Point = { x: 0.65, y: 0.45 };
  const held = async (sign: string) => {
    const perfSign = performance(signTemplate(load, meta, sign), [{ hold: at, s: 2 }], opts);
    return median((await pitches(perfSign.frames, level)).filter((v): v is number => v !== null));
  };
  return {
    level,
    heldWarbleCents: Math.sqrt(sq / Math.max(1, n)),
    noteChangesPerHeldS: changes / Math.max(1e-9, heldS),
    sweepOrder: steps ? up / steps : 0,
    openOverFist: (await held('b')) - (await held('a')),
  };
}

/** The table as Markdown. */
export function thereminTable(rows: readonly ThereminMetrics[]): string {
  const head = '| Assistance | Held warble, cents | Note changes / held s | Sweep order | Open over fist, semitones |\n|---|---|---|---|---|';
  return [head, ...rows.map((r) => `| ${r.level} | ${r.heldWarbleCents.toFixed(1)} | ${r.noteChangesPerHeldS.toFixed(2)} | ${(100 * r.sweepOrder).toFixed(0)}% | ${r.openOverFist.toFixed(1)} |`)].join('\n');
}
