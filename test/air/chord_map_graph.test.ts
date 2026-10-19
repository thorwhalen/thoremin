/**
 * The chord map inside the real default graph, on the #147 template: the dial, the key, the
 * chord settings and the octave shift reach the node as LIVE inputs, the hands reach it, its
 * strums reach their own pluck scheduler, its voices reach the synth merge and its grid the
 * overlay. Then the production graph headless on a synthetic performance: holding a chord puts
 * its tones on the merged voices, strumming asks a mock pluck sink for the chord's voicing, and
 * the shipped instruments compose the branch.
 */
import { describe, it, expect } from 'vitest';
import { runHeadless } from '@thoremin/dag';
import { createAppRegistry } from '@/nodes/browser';
import { defaultGraph, branchIdsFor, composeInstrumentGraph } from '@/app/graph';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';
import { DEFAULT_CHORD_MAP } from '@thoremin/ext-air/dials';
import { chordMapRegions, CHORD_MAP_MELODY_VOICE_ID, CHORD_MAP_VOICE_ID_BASE } from '@thoremin/ext-air/nodes/chord_map';
import { layoutCells } from '@thoremin/ext-air/lib/chord_map';
import { guitarVoicing, parseChordName } from '@thoremin/ext-air/lib/guitar';
import { freqToMidi } from '@thoremin/sdk/music/theory';
import type { SynthParams } from '@thoremin/sdk/nodes/domain';
import { chordMapTake, W, H } from './synthetic_chord_map';
import { AIR } from '../helpers/extensions';

const VOICE = { root: 0, type: 'major', octaves: 2, baseOctave: 3, sound: 'sine' } as const;
const tonic = () => layoutCells('harmonic', chordMapRegions('left', 0.65).chords, { aspect: W / H, cellSize: 0.2 }).find((c) => c.q === 0 && c.r === 0)!;

describe.runIf(AIR)('the chord map in the default graph', () => {
  it('wires the dial, the key, the chord settings, the octave shift, the hands, the strums, the voices and the grid', () => {
    const g = defaultGraph();
    const has = (fn: string, fp: string, tn: string, tp: string) =>
      g.edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    expect(g.nodes.some((n) => n.id === 'chordMap' && n.type === 'chord-map')).toBe(true);
    expect(g.nodes.find((n) => n.id === 'chordStrumOut')?.params).toMatchObject({ timbre: 'guitar', mono: false });
    expect(has('ui', 'chordMap', 'chordMap', 'config')).toBe(true);
    expect(has('ui', 'chordSpec', 'chordMap', 'spec')).toBe(true);
    expect(has('ui', 'chordConfig', 'chordMap', 'chordConfig')).toBe(true);
    expect(has('ui', 'octaveShift', 'chordMap', 'octaveShift')).toBe(true);
    expect(has('dwelled', 'hands', 'chordMap', 'hands')).toBe(true); // through the handedness dwell (#314)
    expect(has('chordMap', 'notes', 'chordStrumOut', 'notes')).toBe(true);
    expect(has('chordMap', 'grid', 'overlay', 'cellGrid')).toBe(true);
    expect(g.edges.some((e) => e.from.node === 'chordMap' && e.from.port === 'params' && e.to.node === 'merge')).toBe(true);
    // Every input the node declares is connected: none left to its default by accident.
    const inbound = new Set(g.edges.filter((e) => e.to.node === 'chordMap').map((e) => e.to.port));
    expect([...inbound].sort()).toEqual(['chordConfig', 'config', 'face', 'hands', 'midi', 'octaveShift', 'spec']);
    expect(has('ui', 'chordMapMidi', 'chordMap', 'midi')).toBe(true); // the keyboard's held notes (H8)
    // The face's controls, through its own branch (H7 of #613).
    expect(has('faceFeat', 'features', 'chordMap', 'face')).toBe(true);
  });

  it('composes the face only while it colours the map (the Chord Map + Face instrument)', () => {
    const settingsOf = (name: string) => settingsFromLayer(SEED_INSTRUMENTS.find((s) => s.name === name)!.layer);
    const withFace = settingsOf('Chord Map + Face');
    expect(withFace.chordMap.face).toBe(true);
    expect(branchIdsFor(withFace)).toEqual(expect.arrayContaining(['chord-map', 'chord-map-face']));
    // The branch requires the face source, so composing it loads the face model.
    const faced = composeInstrumentGraph(branchIdsFor(withFace)).spec;
    expect(faced.edges).toContainEqual({ from: { node: 'faceFeat', port: 'features' }, to: { node: 'chordMap', port: 'face' } });
    const plain = composeInstrumentGraph(branchIdsFor(settingsOf('Chord Map'))).spec;
    expect(plain.nodes.some((n) => n.id === 'camFace')).toBe(false);
  });

  it('puts its chord on the shared chord display (the chord pool), after the face and pose chords', () => {
    const g = defaultGraph();
    const into = (from: string) => g.edges.find((e) => e.from.node === from && e.to.node === 'chordSel')?.to.port;
    expect(into('chordMap')).toBeDefined();
    expect(g.edges).toContainEqual({ from: { node: 'chordMap', port: 'triad' }, to: { node: 'chordSel', port: into('chordMap')! } });
    // Inputs go by priority: the face (30) and pose (20) chords keep theirs, the map (10) follows.
    expect([into('exprChord'), into('poseChord')]).toEqual(['a', 'b']);
    const used = g.edges.filter((e) => e.to.node === 'chordSel' && e.from.node !== 'chordMap').map((e) => e.to.port);
    expect(used).not.toContain(into('chordMap'));
  });

  it('the shipped Chord Map instruments compose the branch and draw the grid; others do not', () => {
    for (const name of ['Chord Map', 'Chord Map Strum']) {
      const seed = SEED_INSTRUMENTS.find((s) => s.name === name);
      expect(seed, name).toBeDefined();
      const settings = settingsFromLayer(seed!.layer);
      expect(settings.chordMap.enabled).toBe(true);
      expect(branchIdsFor(settings)).toContain('chord-map');
    }
    expect(settingsFromLayer(SEED_INSTRUMENTS.find((s) => s.name === 'Chord Map Strum')!.layer).chordMap.play).toBe('strum');
    const pentatonic = settingsFromLayer(SEED_INSTRUMENTS.find((s) => s.name === 'Pentatonic')!.layer);
    expect(branchIdsFor(pentatonic)).not.toContain('chord-map');
  });

  async function run(chordMap: Record<string, unknown>, frames = chordMapTake({ duration: 3, chordAt: () => tonic(), strumPeriod: chordMap.play === 'strum' ? 0.5 : undefined })) {
    const registry = createAppRegistry();
    const g = defaultGraph({ source: 'replay-hands' }, registry);
    g.nodes.find((n) => n.id === 'cam')!.params = { frames };
    const played: number[] = [];
    const { recorder } = await runHeadless(g, registry, {
      ticks: frames.length,
      nominalDt: 1 / 30,
      resources: {
        controls: () => ({ right: VOICE, left: VOICE, chordMap: { ...DEFAULT_CHORD_MAP, enabled: true, mirrorHandedness: false, ...chordMap } }),
        createPluckSink: () => ({ play: (midi: number, velocity: number) => void (velocity > 0 && played.push(midi)), close: () => {} }),
      },
      recordOnly: ['merge.params'],
    });
    return { played, merged: recorder.values('merge.params') as SynthParams[] };
  }

  it('headless: holding the tonic puts C major on the merged voices', async () => {
    const { merged } = await run({ play: 'hold' });
    const last = merged[merged.length - 1];
    // The chord map's own voices (the theremin hands also sound here: this run does not silence them).
    const mine = last.voices.filter((v) => v.id >= CHORD_MAP_VOICE_ID_BASE && v.id < CHORD_MAP_MELODY_VOICE_ID);
    expect(mine).toHaveLength(5); // a seventh chord's open voicing is five notes
    const pcs = new Set(mine.filter((v) => v.present && v.gain > 0).map((v) => ((Math.round(freqToMidi(v.freq)) % 12) + 12) % 12));
    expect([...pcs].sort((a, b) => a - b)).toEqual([0, 4, 7]);
  });

  it('headless: the chord display shows the chord the hand holds', async () => {
    const frames = chordMapTake({ duration: 1, chordAt: () => tonic() });
    const registry = createAppRegistry();
    const g = defaultGraph({ source: 'replay-hands' }, registry);
    g.nodes.find((n) => n.id === 'cam')!.params = { frames };
    const { recorder } = await runHeadless(g, registry, {
      ticks: frames.length,
      nominalDt: 1 / 30,
      resources: { controls: () => ({ right: VOICE, left: VOICE, chordMap: { ...DEFAULT_CHORD_MAP, enabled: true, mirrorHandedness: false } }) },
      recordOnly: ['chordSel.chord'],
    });
    const shown = recorder.values('chordSel.chord') as number[][];
    expect(new Set(shown.at(-1)!.map((n) => n % 12))).toEqual(new Set([0, 4, 7]));
  });

  it('headless: strumming asks the pluck sink for the C voicing', async () => {
    const { played } = await run({ play: 'strum' });
    const C = guitarVoicing(parseChordName('C')!).filter((n) => n !== null);
    expect(played.length).toBeGreaterThanOrEqual(3 * C.length);
    expect(played.slice(0, C.length)).toEqual(C);
  });
});
