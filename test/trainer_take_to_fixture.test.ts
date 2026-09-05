/**
 * The trainer-take → fixture converter (#160 / #163 / #146).
 *
 * Tested against a SYNTHESIZED take rather than a recorded one, deliberately: the point
 * of the converter is that a take is machine-readable, so the test can build one from the
 * same schemas the app writes and assert the join without a camera, a browser or a
 * committed multi-megabyte input.
 *
 * The assertions that matter are the ones about what must NOT come out: no landmark
 * geometry, nothing outside a cue window, and no invented clock.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import {
  convertTake,
  carriesLandmarks,
  cueWindows,
  edgeEventsFromRows,
  insideAnyCue,
  findStem,
} from '../scripts/trainer_take_to_fixture';
import { resolveIntervals } from '@/taglog/affordances/resolve';
import { valuesFromNDJSON } from '@/dag';

const STEM = 'trainer-2026-08-23T12-00-00';
const T0 = 1000;

/** Build a take folder on disk: the anchor + cue rows + a feature stream. */
function makeTake(opts: {
  /** [cue id, startOffset, endOffset] — offsets in seconds from t0. */
  cues: [string, number, number][];
  /** Feature records as [key, offsetSeconds, value]. */
  features: [string, number, unknown][];
  /** Leave the last cue unclosed. */
  openEnded?: boolean;
} = { cues: [['look-left', 1, 3], ['look-right', 5, 7]], features: [] }): string {
  const dir = mkdtempSync(join(tmpdir(), 'take-'));
  const ann: string[] = [
    JSON.stringify({
      anchor: true,
      t: T0,
      clock: 'media',
      wallClockISO: '2026-08-23T12:00:00.000Z',
      recStartPerf: 1_000_000,
      session: STEM,
      schema: 'thoremin.annotations/1',
    }),
  ];
  let seq = 0;
  for (const [cue, s, e] of opts.cues) {
    ann.push(JSON.stringify({ t: T0 + s, tCorrected: T0 + s, tag: `cue:${cue}`, status: 'open', seq: seq++, clock: 'media', src: 'auto' }));
    ann.push(JSON.stringify({ t: T0 + (s + e) / 2, tCorrected: T0 + (s + e) / 2, tag: 'verdict:enough', status: 'point', seq: seq++, clock: 'media', src: 'auto' }));
    if (!opts.openEnded) {
      ann.push(JSON.stringify({ t: T0 + e, tCorrected: T0 + e, tag: `cue:${cue}`, status: 'close', seq: seq++, clock: 'media', src: 'auto' }));
    }
  }
  writeFileSync(join(dir, `${STEM}.annotations.jsonl`), ann.join('\n') + '\n');

  const feats = opts.features.map(([key, off, value], i) => JSON.stringify({ tick: i, t: T0 + off, key, value }));
  writeFileSync(join(dir, `${STEM}.features.jsonl`), feats.join('\n') + '\n');
  writeFileSync(join(dir, `${STEM}.manifest.json`), JSON.stringify({ t0: T0, fps: 30, streams: [] }));
  return dir;
}

function outRoot(): string {
  return mkdtempSync(join(tmpdir(), 'fixtures-'));
}

describe('landmark refusal — the guarantee about what enters the repo', () => {
  it('detects a face mesh however deeply it is nested', () => {
    expect(carriesLandmarks({ present: true, blendshapes: { smile: 0.4 } })).toBe(false);
    expect(carriesLandmarks({ present: true, landmarks: [{ x: 1, y: 2, z: 3 }] })).toBe(true);
    expect(carriesLandmarks({ outer: { inner: { landmarks: [] } } })).toBe(true);
    expect(carriesLandmarks([{ a: 1 }, { landmarks: [{ x: 0 }] }])).toBe(true);
    // Hand keypoints are the same class of thing under a different name.
    expect(carriesLandmarks({ hands: [{ keypoints: [{ x: 1, y: 2 }] }] })).toBe(true);
  });

  it('REFUSES the whole take rather than trimming the mesh out of it', () => {
    const dir = makeTake({
      cues: [['look-left', 1, 3]],
      features: [
        ['faceVec.vector', 2, { 'face.head.yaw': -20 }],
        ['camFace.face', 2, { present: true, landmarks: [{ x: 0.5, y: 0.5, z: 0 }] }],
      ],
    });
    expect(() => convertTake(dir, 'scratch', { fixturesRoot: outRoot() })).toThrow(/landmarks\/keypoints/);
  });

  it('the refusal names the edge and the fix, not just the failure', () => {
    const dir = makeTake({
      cues: [['look-left', 1, 3]],
      features: [['camFace.face', 2, { landmarks: [{ x: 0, y: 0, z: 0 }] }]],
    });
    try {
      convertTake(dir, 'scratch', { fixturesRoot: outRoot() });
      expect.unreachable('should have thrown');
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      expect(m).toContain('camFace.face');
      expect(m).toContain('featureEdges');
    }
  });
});

describe('slicing by cue interval', () => {
  it('keeps only records inside a cue and drops the dead time between them', () => {
    const dir = makeTake({
      cues: [['look-left', 1, 3], ['look-right', 5, 7]],
      features: [
        ['faceVec.vector', 0.5, { 'face.head.yaw': 0 }], // before the first cue
        ['faceVec.vector', 2, { 'face.head.yaw': -25 }], // inside cue 1
        ['faceVec.vector', 4, { 'face.head.yaw': 0 }], // between cues
        ['faceVec.vector', 6, { 'face.head.yaw': 30 }], // inside cue 2
        ['faceVec.vector', 9, { 'face.head.yaw': 0 }], // after the last cue
      ],
    });
    const root = outRoot();
    const r = convertTake(dir, 'head_turns', { fixturesRoot: root });

    expect(r.streams).toHaveLength(1);
    expect(r.streams[0]).toMatchObject({ key: 'faceVec.vector', kept: 2, total: 5 });

    const values = valuesFromNDJSON(readFileSync(join(root, 'head_turns', 'faceVec.vector.ndjson'), 'utf8'));
    expect(values).toEqual([{ 'face.head.yaw': -25 }, { 'face.head.yaw': 30 }]);
  });

  it('preserves the take\'s own tick and t, so streams stay mutually aligned', () => {
    const dir = makeTake({
      cues: [['look-left', 1, 3]],
      features: [
        ['faceVec.vector', 2, { a: 1 }],
        ['handVec.vector', 2, { b: 2 }],
      ],
    });
    const root = outRoot();
    convertTake(dir, 'aligned', { fixturesRoot: root });
    const face = readFileSync(join(root, 'aligned', 'faceVec.vector.ndjson'), 'utf8').trim();
    const hand = readFileSync(join(root, 'aligned', 'handVec.vector.ndjson'), 'utf8').trim();
    // Absolute engine-clock time, not rebased to zero — that is what makes a join possible.
    expect(JSON.parse(face).t).toBe(T0 + 2);
    expect(JSON.parse(hand).t).toBe(T0 + 2);
    expect(JSON.parse(face).tick).toBe(0);
    expect(JSON.parse(hand).tick).toBe(1);
  });

  it('writes one file per edge, named so loadStream() finds it', () => {
    const dir = makeTake({
      cues: [['look-left', 1, 3]],
      features: [['faceVec.vector', 2, { a: 1 }], ['handVec.vector', 2, { b: 2 }]],
    });
    const root = outRoot();
    convertTake(dir, 'two_edges', { fixturesRoot: root });
    const names = readdirSync(join(root, 'two_edges')).sort();
    expect(names).toContain('faceVec.vector.ndjson');
    expect(names).toContain('handVec.vector.ndjson');
    expect(names).toContain('cues.json');
    expect(names).toContain('meta.json');
    expect(names).toContain('README.md');
  });
});

describe('the cue index', () => {
  it('records each cue as a take-relative window with its verdict', () => {
    const dir = makeTake({
      cues: [['look-left', 1, 3], ['look-right', 5, 7]],
      features: [['faceVec.vector', 2, { a: 1 }], ['faceVec.vector', 6, { a: 2 }]],
    });
    const root = outRoot();
    const r = convertTake(dir, 'cue_index', { fixturesRoot: root });
    expect(r.cues).toEqual([
      { cue: 'look-left', start: 1, end: 3, startAbs: T0 + 1, endAbs: T0 + 3, openEnded: false },
      { cue: 'look-right', start: 5, end: 7, startAbs: T0 + 5, endAbs: T0 + 7, openEnded: false },
    ]);
    const cues = JSON.parse(readFileSync(join(root, 'cue_index', 'cues.json'), 'utf8'));
    expect(cues.t0).toBe(T0);
    expect(cues.verdicts.map((v: { cue: string }) => v.cue)).toEqual(['look-left', 'look-right']);
  });

  it('resolves intervals through taglog rather than re-pairing opens and closes itself', () => {
    // The converter must agree with the exporters (Audacity/WebVTT/CSV) on where an
    // interval starts and ends, which it does by calling the same resolver they do.
    const rows = [
      { t: T0 + 1, tCorrected: T0 + 1, tag: 'cue:a', status: 'open', seq: 0, clock: 'media', src: 'auto' },
      { t: T0 + 3, tCorrected: T0 + 3, tag: 'cue:a', status: 'close', seq: 1, clock: 'media', src: 'auto' },
    ];
    const direct = cueWindows(resolveIntervals(edgeEventsFromRows(rows)), T0);
    expect(direct).toEqual([{ cue: 'a', start: 1, end: 3, startAbs: T0 + 1, endAbs: T0 + 3, openEnded: false }]);
  });

  // A cue left open is the cue the take stopped DURING — the one whose data an abandoned
  // take still has. taglog's resolver gives an unclosed open `end === start` unless told
  // when the recording ended, and taking that literally would keep zero of its samples.
  it('keeps the samples of a cue the take stopped during, and reports a real end time', () => {
    const dir = makeTake({
      cues: [['look-left', 1, 3]],
      features: [
        ['faceVec.vector', 0.5, { a: 'before' }],
        ['faceVec.vector', 2, { a: 'during' }],
        ['faceVec.vector', 6, { a: 'still-during' }],
      ],
      openEnded: true,
    });
    const root = outRoot();
    const r = convertTake(dir, 'open_ended', { fixturesRoot: root });
    expect(r.cues).toHaveLength(1);
    expect(r.cues[0].openEnded).toBe(true);
    // Sealed to the last record actually seen, not left as Infinity and not collapsed to 1.
    expect(r.cues[0].end).toBe(6);
    expect(Number.isFinite(r.cues[0].endAbs)).toBe(true);
    // The pre-cue record is still excluded; both in-cue records survive.
    const values = valuesFromNDJSON(readFileSync(join(root, 'open_ended', 'faceVec.vector.ndjson'), 'utf8'));
    expect(values).toEqual([{ a: 'during' }, { a: 'still-during' }]);
  });
});

describe('refusals that protect the caller', () => {
  it('rejects a scenario name that is a path', () => {
    const dir = makeTake({ cues: [['a', 1, 3]], features: [['faceVec.vector', 2, {}]] });
    expect(() => convertTake(dir, '../escape', { fixturesRoot: outRoot() })).toThrow(/lowercase letters/);
    expect(() => convertTake(dir, 'a/b', { fixturesRoot: outRoot() })).toThrow(/lowercase letters/);
  });

  it('says what to do when handed a zip instead of an unzipped folder', () => {
    const empty = mkdtempSync(join(tmpdir(), 'empty-'));
    expect(() => findStem(empty)).toThrow(/unzip/);
  });

  it('refuses a take with no cue intervals — there would be nothing to slice by', () => {
    const dir = makeTake({ cues: [], features: [['faceVec.vector', 2, {}]] });
    expect(() => convertTake(dir, 'nocues', { fixturesRoot: outRoot() })).toThrow(/no cue intervals/);
  });

  it('refuses when nothing fell inside a cue — the likeliest sign of a clock mismatch', () => {
    const dir = makeTake({ cues: [['a', 1, 3]], features: [['faceVec.vector', 99, {}]] });
    expect(() => convertTake(dir, 'nooverlap', { fixturesRoot: outRoot() })).toThrow(/share a clock/);
  });

  it('names the line number when the take is truncated mid-write', () => {
    const dir = makeTake({ cues: [['a', 1, 3]], features: [['faceVec.vector', 2, {}]] });
    const p = join(dir, `${STEM}.features.jsonl`);
    writeFileSync(p, readFileSync(p, 'utf8') + '{"tick":1,"t":100,"key":"x","val\n');
    expect(() => convertTake(dir, 'truncated', { fixturesRoot: outRoot() })).toThrow(/line 2 is not JSON/);
  });

  it('dry-run writes nothing', () => {
    const dir = makeTake({ cues: [['a', 1, 3]], features: [['faceVec.vector', 2, { v: 1 }]] });
    const root = outRoot();
    const r = convertTake(dir, 'dry', { fixturesRoot: root, dryRun: true });
    expect(r.streams[0].kept).toBe(1);
    expect(existsSync(join(root, 'dry'))).toBe(false);
  });
});

describe('the committed bytes', () => {
  it('gzips a large stream and leaves a small one plain, both loadable the same way', () => {
    const big: [string, number, unknown][] = [];
    for (let i = 0; i < 4000; i++) {
      big.push(['faceVec.vector', 1 + (i / 4000) * 2, { 'face.head.yaw': i * 0.001, 'face.head.pitch': i * 0.002 }]);
    }
    const dir = makeTake({ cues: [['look-left', 1, 3]], features: big });
    const root = outRoot();
    const r = convertTake(dir, 'big', { fixturesRoot: root });
    expect(r.streams[0].gzipped).toBe(true);
    const gz = join(root, 'big', 'faceVec.vector.ndjson.gz');
    expect(existsSync(gz)).toBe(true);
    const values = valuesFromNDJSON(gunzipSync(readFileSync(gz)).toString('utf8'));
    expect(values).toHaveLength(4000);
  });

  it('is byte-reproducible — the same take converts to the same bytes twice', () => {
    const dir = makeTake({
      cues: [['look-left', 1, 3]],
      features: Array.from({ length: 3000 }, (_, i): [string, number, unknown] => ['faceVec.vector', 1 + (i / 3000) * 2, { v: i }]),
    });
    const a = outRoot();
    const b = outRoot();
    const ra = convertTake(dir, 'repro', { fixturesRoot: a });
    convertTake(dir, 'repro', { fixturesRoot: b });
    const name = `faceVec.vector.ndjson${ra.streams[0].gzipped ? '.gz' : ''}`;
    const fa = readFileSync(join(a, 'repro', name));
    const fb = readFileSync(join(b, 'repro', name));
    expect(fa.equals(fb)).toBe(true);
  });
});

describe('insideAnyCue', () => {
  it('is inclusive at both ends, so a record exactly on the boundary is kept', () => {
    const w = [{ cue: 'a', start: 1, end: 3, startAbs: 1, endAbs: 3, openEnded: false }];
    expect(insideAnyCue(0.999, w)).toBe(false);
    expect(insideAnyCue(1, w)).toBe(true);
    expect(insideAnyCue(3, w)).toBe(true);
    expect(insideAnyCue(3.001, w)).toBe(false);
  });
});
