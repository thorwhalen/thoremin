/** The analyser table, the processor's chain, the offline loop and the input stage's choice rule. */
import { describe, expect, it } from 'vitest';
import { ANALYSERS, createAnalyser, createAnalyserChain, runAnalysers } from '@thoremin/sdk/audio/analysers';
import { synthTake } from '@thoremin/sdk/audio/synthetic_taps';
import { chooseInputStage, heardAtContextTime, INPUT_STAGE_PRIOR_S } from '@thoremin/sdk/timing/input_stage';

const SR = 48000;

describe('audio analysers by name', () => {
  // Spaced taps: these tests are about routing, not about a soft tap under a ringing pot.
  const take = synthTake({ sampleRate: SR, seed: 2, perSurface: 3, gapMin: 0.4, gapMax: 0.6 });

  it('runs the onset analyser offline: every tap, levels, no classes', () => {
    const events = runAnalysers(take.pcm, SR, [{ name: 'onset' }]);
    const onsets = events.filter((e) => e.event.kind === 'onset');
    expect(onsets).toHaveLength(take.taps.length);
    expect(events.some((e) => e.event.kind === 'level')).toBe(true);
    expect(events.every((e) => e.event.kind !== 'class' && e.source === 'onset')).toBe(true);
  });

  it('tags each event with its analyser, so two consumers never see each other', () => {
    const events = runAnalysers(take.pcm, SR, [{ name: 'onset' }, { name: 'sound-mapper', id: 'mapper' }]);
    expect(events.filter((e) => e.source === 'onset' && e.event.kind === 'onset')).toHaveLength(take.taps.length);
    // The mapper with no model still decides (null) once per onset, and only on its own events.
    expect(events.filter((e) => e.source === 'mapper' && e.event.kind === 'class')).toHaveLength(take.taps.length);
    expect(events.filter((e) => e.source === 'onset' && e.event.kind === 'class')).toHaveLength(0);
  });

  it('refuses an unknown name (naming the known ones) and a duplicate id', () => {
    expect(() => createAnalyser({ name: 'nope' }, SR)).toThrow(/known: .*onset/);
    expect(() => createAnalyserChain([{ name: 'onset' }, { name: 'onset' }], SR)).toThrow(/share an id/);
    expect(Object.keys(ANALYSERS)).toEqual(expect.arrayContaining(['onset', 'sound-mapper']));
  });

  it('routes a message to one analyser by id', () => {
    const chain = createAnalyserChain([{ name: 'sound-mapper', id: 'm' }], SR);
    const out: string[] = [];
    chain.configure('m', { type: 'capture', on: true });
    chain.configure('unknown', { type: 'capture', on: true });
    const q = 128;
    for (let b = 0; b * q < take.pcm.length; b++) chain.process(take.pcm.slice(b * q, (b + 1) * q), new Float32Array(q), b * q, (_s, e) => out.push(e.kind));
    expect(out.filter((k) => k === 'snippet')).toHaveLength(take.taps.length);
  });
});

describe('input stage', () => {
  it('trusts a measurement over a report over the prior, and never reports 0 as known', () => {
    expect(chooseInputStage([])).toEqual({ seconds: INPUT_STAGE_PRIOR_S, source: 'prior' });
    expect(chooseInputStage([{ seconds: 0, source: 'reported' }]).source).toBe('prior');
    expect(chooseInputStage([{ seconds: 0.01, source: 'reported' }, { seconds: 0.02, source: 'tap' }])).toEqual({ seconds: 0.02, source: 'tap' });
    expect(chooseInputStage([{ seconds: 0.03, source: 'loopback' }, { seconds: 0.012, source: 'measured' }, null])).toEqual({ seconds: 0.012, source: 'measured' });
    expect(chooseInputStage([{ seconds: Number.NaN, source: 'measured' }]).source).toBe('prior');
  });

  it('moves a stamped frame back by the stage', () => {
    expect(heardAtContextTime(48000, 48000, { seconds: 0.01, source: 'prior' })).toBeCloseTo(0.99, 12);
  });
});
