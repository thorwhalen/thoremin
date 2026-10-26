/**
 * The chord instruments on REAL hands: every instrument of the stability suite
 * (`scripts/stability/suite.ts`) replayed through its actual graph on the real streams, its
 * stability measured (`scripts/stability/lib_metrics.ts`) and held to the committed baseline
 * (`docs/testing/data/stability-baseline.json`, the table in `docs/testing/stability.md`).
 *
 * A ratchet: a number may not get worse (more flicker, more chords nobody asked for, slower, more
 * missed), and a number that got better must be written down (`npm run stability -- --update`), so
 * the baseline always says where each instrument stands. The metric module has its own unit tests
 * (`metrics.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRecords, FIXTURES } from '../helpers/fixtures';
import { INSTRUMENTS, measure, type CaseResult } from '../../scripts/stability/suite';
import { ASL, BODY, CONDUCTOR, FACES, HARMONY } from '../helpers/extensions';

const meta = JSON.parse(readFileSync(join(FIXTURES, 'real_hands_signs', 'meta.json'), 'utf8'));
const baseline = JSON.parse(readFileSync(join(FIXTURES, '..', '..', 'docs', 'testing', 'data', 'stability-baseline.json'), 'utf8')) as CaseResult[];

const SIGN_INSTRUMENTS = ['ASL Chords', 'Sign Map', 'Sign Wheel'];

/** The numbers held: lower is better for each. */
const HELD: readonly { name: string; read: (r: CaseResult) => number }[] = [
  { name: 'chord changes while held', read: (r) => r.chord.changesWhileHeld },
  { name: 'flickers', read: (r) => r.chord.flickers },
  { name: 'entry flickers', read: (r) => r.chord.entryFlickers },
  { name: 'chords with no hand', read: (r) => r.chord.spuriousNoHand },
  { name: 'short chords', read: (r) => r.chord.shortChords },
  { name: 'sound blips', read: (r) => r.heard.blips },
  { name: 'missed chords', read: (r) => r.chord.latency?.missed ?? 0 },
  { name: 'latency p90 (ms)', read: (r) => Math.round(r.chord.latency?.p90Ms ?? 0) },
  // A sign instrument on hands that are not signing: every second of chord is a false reading.
  { name: 'seconds of chord with nobody signing', read: (r) => (SIGN_INSTRUMENTS.includes(r.instrument) && r.stream === 'choir' ? Math.round(r.chord.soundingS * 10) / 10 : 0) },
];

/** The extensions each instrument is built from (a build without one has no such seed). */
const needs = (instrument: string): boolean =>
  SIGN_INSTRUMENTS.includes(instrument)
    ? HARMONY && ASL
    : instrument === 'Conduct the Chords'
      ? HARMONY && CONDUCTOR
      : instrument === 'Hand-shape Chords' || instrument === 'Pose Chords'
        ? FACES && BODY
        : instrument === 'Head Chords'
          ? true
          : HARMONY;

describe('the baseline covers the suite', () => {
  it('has one entry per instrument and stream, and none for a case the suite dropped', () => {
    const cases = Object.entries(INSTRUMENTS).flatMap(([i, ss]) => ss.map((s) => `${i} / ${s}`));
    expect(baseline.map((r) => `${r.instrument} / ${r.stream}`).sort()).toEqual(cases.sort());
  });
});

for (const [instrument, streams] of Object.entries(INSTRUMENTS)) {
  describe.runIf(needs(instrument))(`${instrument} on real hands`, () => {
    for (const stream of streams) {
      it(`${stream}: no worse than the baseline, and the baseline is current`, async () => {
        const r = await measure(loadRecords, meta, instrument, stream);
        const base = baseline.find((b) => b.instrument === instrument && b.stream === stream)!;
        const worse = HELD.filter((m) => m.read(r) > m.read(base)).map((m) => `${m.name}: ${m.read(r)} (baseline ${m.read(base)})`);
        const better = HELD.filter((m) => m.read(r) < m.read(base)).map((m) => `${m.name}: ${m.read(r)} (baseline ${m.read(base)})`);
        expect(worse, `${instrument} / ${stream} got worse`).toEqual([]);
        expect(better, `${instrument} / ${stream} got better: run \`npm run stability -- --update\` and commit the baseline`).toEqual([]);
      }, 60_000);
    }
  });
}
