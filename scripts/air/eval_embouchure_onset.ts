/**
 * Measure the embouchure's lead over the flute's audio onset (#248) on every flute
 * source that has a face: the oracle profile of each mouth signal around each refined
 * note onset, and the causal detector's hit / miss / false-alarm rates and lead
 * distribution, per source, per player and pooled. Writes
 * `results/air/flute/embouchure_onset.results.json` and `.md` (local) and prints the
 * markdown.
 *
 * The reference is `label_note_onsets.py`'s `t` (the 50 % band-power crossing). Onsets
 * are split by what the mouth has to do: `rest` onsets after at least `--min-gap`
 * seconds of silence (the embouchure is formed from nothing: the case for a mouth
 * anchor), `short` rest onsets after a shorter gap (a breath inside a phrase), and
 * `change` onsets (a fingering change under one breath, where the mouth need not move:
 * the control).
 *
 * Usage:
 *   npx vite-node scripts/air/eval_embouchure_onset.ts [--rest-gap 2] [--min-gap 0.5] [--before 0.6] [--after 0.1] [--ref rise50|rise10] [--only ID ...]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { effectiveSigma } from '@/enroll/noise';
import { airDir } from './lib_air_paths';
import {
  allSeries,
  BLENDSHAPE_SIGNALS,
  coveredSeconds,
  jitterSigma,
  leadStats,
  matchEvents,
  median,
  MOUTH_SIGNALS,
  nearAny,
  onsetProfile,
  quantile,
  readMouthFrames,
  detectOnsets,
  type EmbouchureDetectorOptions,
  type LeadStats,
  type MouthFrame,
  type ProfiledOnset,
} from './lib_embouchure_onset';
import { parseSourcesFor } from './lib_sources';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function list(name: string): string[] {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return [];
  const out: string[] = [];
  for (const a of process.argv.slice(i + 1)) {
    if (a.startsWith('--')) break;
    out.push(a);
  }
  return out;
}

const MIN_GAP = Number(arg('min-gap', '0.5')); // a rest shorter than this is "short": a breath inside a phrase
const REST_GAP = Number(arg('rest-gap', '2')); // a rest at least this long is "rest": the embouchure is formed from nothing
const WINDOW = { before: Number(arg('before', '0.6')), after: Number(arg('after', '0.1')) };
const ONLY = list('only');
const THRESHOLDS = [4, 6, 8, 12];
/** The single signals plus one combined reading: the whole embouchure's distance from
 *  its resting shape, in noise units over the twenty blendshapes (the trainer's own
 *  distance), against a causal three-second baseline per blendshape. */
const SIGNALS: readonly string[] = [...MOUTH_SIGNALS, 'embouchure.distance'];
const DISTANCE_TAU = 3;

function embouchureDistance(ser: Record<string, { t: number[]; x: number[] }>): { t: number[]; x: number[] } {
  const sigmaOf = (id: string) => effectiveSigma(jitterSigma(ser[id].x), quantile(ser[id].x, 0.99) - quantile(ser[id].x, 0.01), 0.01);
  // A blendshape that never moves (a constant zero) has no noise unit and is left out.
  const ids = BLENDSHAPE_SIGNALS.filter((id) => ser[id]?.x.length > MIN_SERIES_FRAMES && sigmaOf(id) > 0);
  if (!ids.length) return { t: [], x: [] };
  const n = ser[ids[0]].t.length;
  if (!ids.every((id) => ser[id].t.length === n)) return { t: [], x: [] }; // blendshapes share the frames
  const sigma = ids.map(sigmaOf);
  const t = ser[ids[0]].t;
  const base = ids.map((id) => ser[id].x[0]);
  const x: number[] = [];
  for (let i = 0; i < n; i++) {
    let d2 = 0;
    const a = i > 0 ? 1 - Math.exp(-(t[i] - t[i - 1]) / DISTANCE_TAU) : 0;
    for (let k = 0; k < ids.length; k++) {
      const v = ser[ids[k]].x[i];
      d2 += ((v - base[k]) / sigma[k]) ** 2;
      base[k] += a * (v - base[k]);
    }
    x.push(Math.sqrt(d2 / ids.length));
  }
  return { t, x };
}
const PLAYING_PAD = 2; // seconds around any note onset that count as "playing"
const MAX_SPAN = Number(arg('max-span', '3')); // the longest silence before an onset the profile looks back over
/** The shortest span the profile reads: a short rest or a note change compares the
 *  mouth over the previous note's last half second with the mouth on this note, so the
 *  resting window always holds at least five frames at 30 fps. */
const MIN_SPAN = 0.5;
const REF = arg('ref', 'rise50') as 'rise10' | 'rise50'; // which audio crossing is the reference onset
const MIN_SERIES_FRAMES = 100;
const MAX_DETECTOR_ROWS = 40;

interface NoteOnset {
  t: number;
  rise10: number;
  rise50: number;
  kind: 'rest' | 'change';
  gapBefore: number;
  label: string;
}
type OnsetSet = 'rest' | 'breath' | 'short' | 'change';
const SETS: readonly OnsetSet[] = ['rest', 'breath', 'short', 'change'];

function onsetSet(o: NoteOnset): OnsetSet {
  if (o.kind === 'change') return 'change';
  if (o.gapBefore >= REST_GAP) return 'rest';
  return o.gapBefore >= MIN_GAP ? 'breath' : 'short';
}

interface ProfileRow {
  signal: string;
  set: OnsetSet;
  /** Onsets in the set. */
  n: number;
  /** Onsets whose resting and playing windows both had frames (a face); every fraction
   *  below is over these, never over `n`. */
  measured: number;
  movedFraction: number;
  /** Fraction of moved onsets where the signal ROSE into playing. */
  risingFraction: number;
  medianChangeNoiseUnits: number;
  lead10: LeadStats;
  lead50: LeadStats;
  lead90: LeadStats;
  /** Over every onset whose excursion cleared the threshold, moved or not. */
  leadPeak: LeadStats;
}

interface DetectorRow {
  signal: string;
  mode: 'level' | 'velocity';
  threshold: number;
  events: number;
  recall: Record<OnsetSet, number>;
  n: Record<OnsetSet, number>;
  /** Fraction of events matched to any note onset. */
  precision: number;
  /** Unmatched events per minute of playing time, and per minute outside it. */
  falsePerMinutePlaying: number;
  falsePerMinuteIdle: number;
  lead: LeadStats;
  leadRest: LeadStats;
}

interface SourceResult {
  id: string;
  player: string;
  stream: 'mouth' | 'face';
  frames: number;
  faceFrames: number;
  fps: number;
  onsets: Record<OnsetSet, number>;
  jitter: Record<string, number>;
  profile: ProfileRow[];
  detector: DetectorRow[];
  /** Raw per-onset leads for pooling across a player's sources. */
  raw: {
    profile: Record<string, Record<OnsetSet, { moved: number; n: number; measured: number; rising: number; change: number[]; l10: number[]; l50: number[]; l90: number[]; lpk: number[] }>>;
    detector: Record<string, { events: number; hits: Record<OnsetSet, number>; n: Record<OnsetSet, number>; matched: number; falsePlaying: number; falseIdle: number; playingSeconds: number; idleSeconds: number; leads: number[]; leadsRest: number[] }>;
  };
}

const doc = parseSourcesFor(readFileSync(join(__dirname, 'sources', 'flute.json'), 'utf8'), 'flute');
const results: SourceResult[] = [];

for (const src of doc.sources) {
  if (ONLY.length && !ONLY.includes(src.id)) continue;
  if (!src.face) continue;
  const mouthPath = join(airDir('landmarks', 'flute'), `${src.id}.mouth.ndjson.gz`);
  const facePath = join(airDir('landmarks', 'flute'), `${src.id}.face.ndjson`);
  const onsetsPath = join(airDir('labels', 'flute'), `${src.id}.note_onsets.json`);
  const streamPath = existsSync(mouthPath) ? mouthPath : facePath;
  if (!existsSync(streamPath) || !existsSync(onsetsPath)) {
    console.error(`skip ${src.id}: no face stream or no note onsets`);
    continue;
  }
  const frames: MouthFrame[] = readMouthFrames(streamPath);
  const faceFrames = frames.filter((f) => f.present).length;
  const MIN_FACE_FRAMES = 100;
  const onsets = (JSON.parse(readFileSync(onsetsPath, 'utf8')) as { onsets: NoteOnset[] }).onsets.map((o) => ({ ...o, t: o[REF] ?? o.t }));
  if (faceFrames < MIN_FACE_FRAMES || onsets.length === 0) {
    console.error(`skip ${src.id}: ${faceFrames} face frames, ${onsets.length} onsets`);
    continue;
  }
  const fps = frames.length > 1 ? (frames.length - 1) / (frames[frames.length - 1].t - frames[0].t) : NaN;
  const duration = frames[frames.length - 1].t;
  const sets: Record<OnsetSet, number[]> = { rest: [], breath: [], short: [], change: [] };
  const profiled: Record<OnsetSet, ProfiledOnset[]> = { rest: [], breath: [], short: [], change: [] };
  for (const o of onsets) {
    const set = onsetSet(o);
    sets[set].push(o.t);
    // The search span: the silence before a rest onset, between MIN_SPAN and MAX_SPAN;
    // for a note change (or a rest shorter than MIN_SPAN) the previous note's last
    // MIN_SPAN seconds, so "at rest" is the mouth on the previous note: the control.
    profiled[set].push({ t: o.t, from: o.t - Math.max(MIN_SPAN, Math.min(MAX_SPAN, o.kind === 'rest' ? o.gapBefore : 0)) });
  }
  const allOnsets = onsets.map((o) => o.t).sort((a, b) => a - b);
  const setOf = new Map<number, OnsetSet>(onsets.map((o) => [o.t, onsetSet(o)]));
  const playingSeconds = coveredSeconds(allOnsets, PLAYING_PAD, 0, duration);
  const idleSeconds = Math.max(0, duration - playingSeconds);
  console.error(`=== ${src.id} (${src.player}): ${frames.length} frames @ ${fps.toFixed(1)} fps, face ${faceFrames}, onsets rest ${sets.rest.length} / breath ${sets.breath.length} / short ${sets.short.length} / change ${sets.change.length}, ${existsSync(mouthPath) ? 'mouth' : 'face'} stream`);

  const ser = allSeries(frames);
  ser['embouchure.distance'] = embouchureDistance(ser);
  const jitter: Record<string, number> = {};
  const profile: ProfileRow[] = [];
  const detector: DetectorRow[] = [];
  const raw: SourceResult['raw'] = { profile: {}, detector: {} };

  for (const signal of SIGNALS) {
    const { t, x } = ser[signal];
    if (x.length < MIN_SERIES_FRAMES) continue;
    // The noise unit, floored at 1 % of the signal's range (the `src/enroll/noise.ts`
    // rule), so a blendshape that barely jitters does not make every drift a "move".
    const sigma = effectiveSigma(jitterSigma(x), quantile(x, 0.99) - quantile(x, 0.01), 0.01);
    jitter[signal] = sigma;
    if (!(sigma > 0)) continue;
    raw.profile[signal] = {} as SourceResult['raw']['profile'][string];
    for (const set of SETS) {
      const prof = onsetProfile(t, x, profiled[set], { sigma });
      const measured = prof.filter((p) => p.measured);
      const moved = prof.filter((p) => p.moved);
      const rising = moved.filter((p) => p.changeNoiseUnits > 0).length;
      const l10 = moved.map((p) => p.lead10).filter(Number.isFinite);
      const l50 = moved.map((p) => p.lead50).filter(Number.isFinite);
      const l90 = moved.map((p) => p.lead90).filter(Number.isFinite);
      const lpk = prof.map((p) => p.leadPeak).filter(Number.isFinite);
      raw.profile[signal][set] = { moved: moved.length, n: prof.length, measured: measured.length, rising, change: moved.map((p) => p.changeNoiseUnits), l10, l50, l90, lpk };
      profile.push({
        signal,
        set,
        n: prof.length,
        measured: measured.length,
        movedFraction: measured.length ? moved.length / measured.length : NaN,
        risingFraction: moved.length ? rising / moved.length : NaN,
        medianChangeNoiseUnits: median(moved.map((p) => p.changeNoiseUnits)),
        lead10: leadStats(l10),
        lead50: leadStats(l50),
        lead90: leadStats(l90),
        leadPeak: leadStats(lpk),
      });
    }
    // The detector's sign follows the profile: the direction this signal moves into
    // playing on the rest onsets of THIS source (the app would enrol it the same way).
    const restProf = raw.profile[signal].rest;
    const sign: 1 | -1 = restProf.moved && restProf.rising < restProf.moved / 2 ? -1 : 1;
    for (const mode of ['level', 'velocity'] as const) {
      for (const threshold of THRESHOLDS) {
        const opts: EmbouchureDetectorOptions = { mode, thresholdNoiseUnits: threshold, sign: mode === 'level' ? sign : 0 };
        const events = detectOnsets(t, x, opts).map((a) => a.t);
        const key = `${signal}|${mode}|${threshold}`;
        const hits = { rest: 0, breath: 0, short: 0, change: 0 } as Record<OnsetSet, number>;
        const n = { rest: sets.rest.length, breath: sets.breath.length, short: sets.short.length, change: sets.change.length };
        // One joint one-to-one matching against every onset; hits are then attributed
        // to their set, so an event cannot be a hit for two onsets.
        const all = matchEvents(allOnsets, events, WINDOW);
        const leadsRest: number[] = [];
        for (const p of all.pairs) {
          const set = setOf.get(p.ref);
          if (!set) continue;
          hits[set]++;
          if (set === 'rest') leadsRest.push(p.lead);
        }
        let falsePlaying = 0;
        let falseIdle = 0;
        for (const e of all.extra) {
          if (nearAny(allOnsets, e, PLAYING_PAD)) falsePlaying++;
          else falseIdle++;
        }
        raw.detector[key] = { events: events.length, hits, n, matched: all.pairs.length, falsePlaying, falseIdle, playingSeconds, idleSeconds, leads: all.pairs.map((p) => p.lead), leadsRest };
        detector.push({
          signal,
          mode,
          threshold,
          events: events.length,
          recall: { rest: n.rest ? hits.rest / n.rest : NaN, breath: n.breath ? hits.breath / n.breath : NaN, short: n.short ? hits.short / n.short : NaN, change: n.change ? hits.change / n.change : NaN },
          n,
          precision: events.length ? all.pairs.length / events.length : NaN,
          falsePerMinutePlaying: playingSeconds > 0 ? (falsePlaying / playingSeconds) * 60 : NaN,
          falsePerMinuteIdle: idleSeconds > 0 ? (falseIdle / idleSeconds) * 60 : NaN,
          lead: leadStats(all.pairs.map((p) => p.lead)),
          leadRest: leadStats(leadsRest),
        });
      }
    }
  }
  results.push({ id: src.id, player: src.player, stream: existsSync(mouthPath) ? 'mouth' : 'face', frames: frames.length, faceFrames, fps, onsets: { rest: sets.rest.length, breath: sets.breath.length, short: sets.short.length, change: sets.change.length }, jitter, profile, detector, raw });
}

// ---- Pooling -------------------------------------------------------------------------

type Group = { name: string; ids: string[] };
const players = [...new Set(results.map((r) => r.player))];
const groups: Group[] = [
  ...players.map((p) => ({ name: p, ids: results.filter((r) => r.player === p).map((r) => r.id) })),
  { name: 'pooled', ids: results.map((r) => r.id) },
];

function poolProfile(group: Group, signal: string, set: OnsetSet): ProfileRow | null {
  const parts = results.filter((r) => group.ids.includes(r.id)).map((r) => r.raw.profile[signal]?.[set]).filter(Boolean);
  if (!parts.length) return null;
  const n = parts.reduce((a, p) => a + p.n, 0);
  const measured = parts.reduce((a, p) => a + p.measured, 0);
  const moved = parts.reduce((a, p) => a + p.moved, 0);
  const rising = parts.reduce((a, p) => a + p.rising, 0);
  const cat = (k: 'change' | 'l10' | 'l50' | 'l90' | 'lpk') => parts.flatMap((p) => p[k]);
  return { signal, set, n, measured, movedFraction: measured ? moved / measured : NaN, risingFraction: moved ? rising / moved : NaN, medianChangeNoiseUnits: median(cat('change')), lead10: leadStats(cat('l10')), lead50: leadStats(cat('l50')), lead90: leadStats(cat('l90')), leadPeak: leadStats(cat('lpk')) };
}

function poolDetector(group: Group, key: string): DetectorRow | null {
  const parts = results.filter((r) => group.ids.includes(r.id)).map((r) => r.raw.detector[key]).filter(Boolean);
  if (!parts.length) return null;
  const [signal, mode, thr] = key.split('|');
  const sum = (f: (p: (typeof parts)[number]) => number) => parts.reduce((a, p) => a + f(p), 0);
  const n = { rest: sum((p) => p.n.rest), breath: sum((p) => p.n.breath), short: sum((p) => p.n.short), change: sum((p) => p.n.change) };
  const hits = { rest: sum((p) => p.hits.rest), breath: sum((p) => p.hits.breath), short: sum((p) => p.hits.short), change: sum((p) => p.hits.change) };
  const events = sum((p) => p.events);
  const matched = sum((p) => p.matched);
  const playing = sum((p) => p.playingSeconds);
  const idle = sum((p) => p.idleSeconds);
  return {
    signal,
    mode: mode as 'level' | 'velocity',
    threshold: Number(thr),
    events,
    recall: { rest: n.rest ? hits.rest / n.rest : NaN, breath: n.breath ? hits.breath / n.breath : NaN, short: n.short ? hits.short / n.short : NaN, change: n.change ? hits.change / n.change : NaN },
    n,
    precision: events ? matched / events : NaN,
    falsePerMinutePlaying: playing > 0 ? (sum((p) => p.falsePlaying) / playing) * 60 : NaN,
    falsePerMinuteIdle: idle > 0 ? (sum((p) => p.falseIdle) / idle) * 60 : NaN,
    lead: leadStats(parts.flatMap((p) => p.leads)),
    leadRest: leadStats(parts.flatMap((p) => p.leadsRest)),
  };
}

// ---- Report --------------------------------------------------------------------------

const ms = (s: number) => (Number.isFinite(s) ? `${Math.round(s * 1000)}` : '');
const pct = (f: number) => (Number.isFinite(f) ? `${(100 * f).toFixed(0)}%` : '');
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '');

const lines: string[] = [];
lines.push(`# Embouchure onset vs audio onset (flute)`, '');
lines.push(`Reference: the ${REF === 'rise10' ? '10' : '50'} % band-power crossing of each note (\`label_note_onsets.py\`). Onset sets: \`rest\` = after >= ${REST_GAP} s of silence, \`breath\` = after ${MIN_GAP} to ${REST_GAP} s, \`short\` = after a shorter rest, \`change\` = a note change under one breath. Profile search span: the silence before the onset, up to ${MAX_SPAN} s. Detector match window: the mouth event may lead by up to ${ms(WINDOW.before)} ms and trail by up to ${ms(WINDOW.after)} ms. Leads in ms, positive = the mouth first; spread = 1.4826 x MAD.`, '');
lines.push(`| source | player | stream | frames | face | fps | rest | breath | short | change | jitter σ: mouthPucker / jawOpen / lip.aperture |`, `|---|---|---|---|---|---|---|---|---|---|---|`);
const sig = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '' : v.toExponential(1));
for (const r of results) lines.push(`| ${r.id} | ${r.player} | ${r.stream} | ${r.frames} | ${pct(r.faceFrames / r.frames)} | ${r.fps.toFixed(0)} | ${r.onsets.rest} | ${r.onsets.breath} | ${r.onsets.short} | ${r.onsets.change} | ${sig(r.jitter['face.mouthPucker'])} / ${sig(r.jitter['face.jawOpen'])} / ${sig(r.jitter['lip.aperture'])} |`);
lines.push('');

const signalsPresent = SIGNALS.filter((s) => results.some((r) => r.raw.profile[s]));

for (const group of groups) {
  lines.push(`## ${group.name} (${group.ids.join(', ')})`, '');
  lines.push(`### Profile: did the signal move, and when (oracle, around known onsets)`, '');
  lines.push(`| signal | set | n (measured) | moved | rising | change (σ) | lead 10 % med / spread [p10..p90] | lead 50 % | lead 90 % (settled) [p10..p90] | lead of peak excursion |`, `|---|---|---|---|---|---|---|---|---|---|`);
  const rows: ProfileRow[] = [];
  for (const s of signalsPresent) for (const set of SETS) {
    const row = poolProfile(group, s, set);
    if (row) rows.push(row);
  }
  // Rank signals by how often they move on rest onsets, then by the tightness of the 10 % lead.
  // Moved fraction first (in thousandths), the tightness of the first-movement lead
  // (seconds of spread, never more than a few) as the tie-breaker.
  const NEVER_MEASURED_SPREAD = 9;
  const rank = new Map<string, number>();
  for (const r of rows) if (r.set === 'rest') rank.set(r.signal, (r.movedFraction || 0) * 1000 - (Number.isFinite(r.lead10.mad) ? r.lead10.mad : NEVER_MEASURED_SPREAD));
  rows.sort((a, b) => (rank.get(b.signal) ?? -1) - (rank.get(a.signal) ?? -1) || a.signal.localeCompare(b.signal) || SETS.indexOf(a.set) - SETS.indexOf(b.set));
  for (const r of rows) {
    lines.push(`| ${r.signal} | ${r.set} | ${r.n} (${r.measured}) | ${pct(r.movedFraction)} | ${pct(r.risingFraction)} | ${f1(r.medianChangeNoiseUnits)} | ${ms(r.lead10.median)} / ${ms(r.lead10.mad)} [${ms(r.lead10.p10)}..${ms(r.lead10.p90)}] | ${ms(r.lead50.median)} / ${ms(r.lead50.mad)} | ${ms(r.lead90.median)} / ${ms(r.lead90.mad)} [${ms(r.lead90.p10)}..${ms(r.lead90.p90)}] | ${ms(r.leadPeak.median)} / ${ms(r.leadPeak.mad)} (n=${r.leadPeak.n}) |`);
  }
  lines.push('');
  lines.push(`### Detector: causal, scored (hit = an event inside the window of a note onset). Rows are the best of the ${signalsPresent.length} x 2 x ${THRESHOLDS.length} operating points by recall on rest x precision, with no held-out split: a maximum over the sweep, not a pre-registered detector.`, '');
  lines.push(`| signal | mode | thr (σ) | events | recall rest | recall breath | recall short | recall change | precision | false/min playing | false/min idle | lead (rest) med / spread | lead (all) med / spread |`, `|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  const drows: DetectorRow[] = [];
  for (const s of signalsPresent) for (const mode of ['level', 'velocity']) for (const thr of THRESHOLDS) {
    const row = poolDetector(group, `${s}|${mode}|${thr}`);
    if (row) drows.push(row);
  }
  // Best operating points first: recall on rest onsets times precision.
  drows.sort((a, b) => (b.recall.rest || 0) * (b.precision || 0) - (a.recall.rest || 0) * (a.precision || 0));
  for (const r of drows.slice(0, MAX_DETECTOR_ROWS)) {
    lines.push(`| ${r.signal} | ${r.mode} | ${r.threshold} | ${r.events} | ${pct(r.recall.rest)} | ${pct(r.recall.breath)} | ${pct(r.recall.short)} | ${pct(r.recall.change)} | ${pct(r.precision)} | ${f1(r.falsePerMinutePlaying)} | ${f1(r.falsePerMinuteIdle)} | ${ms(r.leadRest.median)} / ${ms(r.leadRest.mad)} (n=${r.leadRest.n}) | ${ms(r.lead.median)} / ${ms(r.lead.mad)} (n=${r.lead.n}) |`);
  }
  lines.push('');
}

const outDir = airDir('results', 'flute');
mkdirSync(outDir, { recursive: true });
const slim = results.map(({ raw: _raw, ...rest }) => rest);
writeFileSync(join(outDir, 'embouchure_onset.results.json'), JSON.stringify({ minGap: MIN_GAP, window: WINDOW, thresholds: THRESHOLDS, sources: slim }, null, 1));
writeFileSync(join(outDir, 'embouchure_onset.results.md'), lines.join('\n'));
console.log(lines.join('\n'));
