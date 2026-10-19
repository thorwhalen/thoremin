/**
 * Conduct a chord chart (H9 of #613, the design's 6.6): a score reduced to its chords beat by
 * beat (passing tones aside, percussion ignored), walked by the conductor's beat; the chord in
 * force sounds, holds through a fermata, and nothing sounds before the downbeat. The shipped
 * Haydn quartet is read too.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadScore } from '@/score/load';
import { chartAt, chartOfScore } from '@thoremin/ext-air/lib/chord_chart';
import { chordChartNode, CHORD_CHART_VOICE_ID_BASE, type ChordChartStatus } from '@thoremin/ext-air/nodes/chord_chart';
import { freqToMidi } from '@thoremin/sdk/music/theory';
import type { SynthParams } from '@thoremin/sdk/nodes/domain';
import type { ScoreDoc } from '@thoremin/sdk/score/schema';
import { AIR } from '../helpers/extensions';
import { branchIdsFor, composeInstrumentGraph } from '@/app/graph';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';

const note = (midi: number, start: number, duration: number) => ({ midi, start, duration, velocity: 0.8 });
/** C (bars of two beats), F, G7, C; a quick passing D over the C, and a drum part. */
const DOC = {
  v: 1,
  title: 'chart',
  source: 'builtin',
  parts: [
    { name: 'keys', program: 0, percussion: false, notes: [48, 52, 55].map((m) => note(m, 0, 2)).concat([note(62, 0.5, 0.25)], [53, 57, 60].map((m) => note(m, 2, 2)), [43, 47, 50, 53].map((m) => note(m, 4, 2)), [48, 52, 55].map((m) => note(m, 6, 2))) },
    { name: 'drums', program: 0, percussion: true, notes: [note(36, 0, 0.5), note(38, 1, 0.5), note(42, 2.5, 0.25)] },
  ],
  tempoMap: [],
  timeSignatures: [],
  dynamics: [],
  fermatas: [],
  lengthBeats: 8,
} as unknown as ScoreDoc;

describe.runIf(AIR)('the chord chart', () => {
  it('reads a score\'s chords beat by beat, passing tones and drums aside, and walks it', () => {
    const chart = chartOfScore(DOC);
    expect(chart.segments.map((s) => [s.beat, s.chord.root, s.chord.quality])).toEqual([
      [0, 0, 'maj'],
      [2, 5, 'maj'],
      [4, 7, '7'],
      [6, 0, 'maj'],
    ]);
    expect(chartAt(chart, 4.5)!.segment.chord).toEqual({ root: 7, quality: '7' });
    expect(chartAt(chart, 9)!.segment.chord.root).toBe(0); // past the end: round again, as the conductor loops
    expect(chartAt(chart, 7)!.next.chord.root).toBe(0);
  });

  it('reads the shipped Haydn quartet; a coarser step makes fewer changes', async () => {
    const doc = await loadScore(new Uint8Array(readFileSync('public/scores/haydn-op76-3.mxl')), 'haydn-op76-3.mxl');
    const everyBeat = chartOfScore(doc, { step: 1 });
    const everyBar = chartOfScore(doc, { step: 4 });
    expect(everyBeat.segments.length).toBeGreaterThan(50);
    expect(everyBar.segments.length).toBeLessThan(everyBeat.segments.length);
  });
});

describe.runIf(AIR)('the chord-chart node', () => {
  interface Out {
    params: SynthParams;
    status: ChordChartStatus;
    triad: number[];
  }
  const pcs = (p: SynthParams) => [...new Set(p.voices.filter((v) => v.id >= CHORD_CHART_VOICE_ID_BASE && v.present && v.gain > 0).map((v) => Math.round(freqToMidi(v.freq)) % 12))].sort((a, b) => a - b);
  const time = (t: number, beat: number, state: string) => ({ t, beat, tempo: 120, state, phase: 0, period: 0.5, confidence: 1, nextBeatAt: 0, beatsPerBar: 4, beatInBar: 0, anchors: 0 });
  function run(timeAt: (t: number) => unknown, config: Record<string, unknown> = { enabled: true, rendering: 'sustained' }, seconds = 4) {
    const h = chordChartNode.make(chordChartNode.params.parse({}));
    const outs: { t: number; out: Out }[] = [];
    for (let i = 0; i < seconds * 30; i++) {
      const t = i / 30;
      outs.push({ t, out: h.process({ time: timeAt(t), doc: DOC, config, octaveShift: 0 }, { time: t, dt: 1 / 30, tick: i, resources: {} } as never) as unknown as Out });
    }
    return outs;
  }

  it('plays the chord at the conductor\'s beat, holds through a fermata, waits for the downbeat', () => {
    // Waiting until t = 0.5, then running at 120 bpm from beat 0; a fermata on beat 3 from t = 2.
    const outs = run((t) => (t < 0.5 ? time(t, 0, 'ready') : t < 2 ? time(t, (t - 0.5) * 2, 'running') : time(t, 3, 'hold')));
    const at = (t: number) => outs.find((o) => o.t >= t)!.out;
    expect(at(0.2).status).toMatchObject({ running: false, chord: null, changes: 4 });
    expect(pcs(at(0.2).params)).toEqual([]);
    expect(at(1.0).status).toMatchObject({ running: true, chord: 'C', next: 'F' }); // beat 1
    expect(pcs(at(1.0).params)).toEqual([0, 4, 7]);
    expect(at(1.8).status.chord).toBe('F'); // beat 2.6
    expect(at(3.5).status).toMatchObject({ chord: 'F', running: true }); // the fermata holds beat 3
    expect(pcs(at(3.5).params)).toEqual([0, 5, 9]);
  });

  it('is silent with the chart off', () => {
    const outs = run((t) => time(t, t * 2, 'running'), { enabled: false });
    expect(outs.every((o) => pcs(o.out.params).length === 0)).toBe(true);
  });
});

describe.runIf(AIR)('Conduct the Chords', () => {
  it('composes the chart with the conductor, the piece and the beat wired in', () => {
    const settings = settingsFromLayer(SEED_INSTRUMENTS.find((s) => s.name === 'Conduct the Chords')!.layer);
    expect(settings.chordChart.enabled).toBe(true);
    expect(settings.conductor).toMatchObject({ enabled: true, piece: 'haydn-op76-3' });
    const ids = branchIdsFor(settings);
    expect(ids).toEqual(expect.arrayContaining(['chord-chart', 'conductor']));
    const g = composeInstrumentGraph(ids).spec;
    const has = (fn: string, fp: string, tn: string, tp: string) => g.edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    expect(has('conductor', 'time', 'chordChart', 'time')).toBe(true);
    expect(has('ui', 'scoreDoc', 'chordChart', 'doc')).toBe(true);
    expect(g.edges.some((e) => e.from.node === 'chordChart' && e.from.port === 'params' && e.to.node === 'merge')).toBe(true);
  });
});
