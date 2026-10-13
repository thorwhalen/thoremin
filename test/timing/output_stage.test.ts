/**
 * The output-stage rule (step 0 of the timing plan): the one number every scheduler
 * subtracts, with its source, never 0. The cases are the ones the Safari red-team
 * measured in Playwright's WebKit and the research note read from the engines' sources.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveOutputStage,
  knownOutputLatency,
  pairIsPreLatency,
  pairScheduleToSpeaker,
  readOutputStage,
  FINGERPRINTING_BLOCK_FRAMES,
  OUTPUT_STAGE_PRIOR_S,
} from '@thoremin/sdk/timing/output_stage';

describe('knownOutputLatency', () => {
  it('treats 0, absent and the fingerprinting block as unknown', () => {
    expect(knownOutputLatency(0, 48000)).toBeNaN(); // a WebKit context not yet running
    expect(knownOutputLatency(undefined, 48000)).toBeNaN(); // Safari before 18.4
    expect(knownOutputLatency(FINGERPRINTING_BLOCK_FRAMES / 48000, 48000)).toBeNaN(); // fingerprinting protection
    expect(knownOutputLatency(FINGERPRINTING_BLOCK_FRAMES / 44100, 44100)).toBeNaN();
    expect(knownOutputLatency(0.016, 48000)).toBe(0.016);
    expect(knownOutputLatency(0.032, undefined)).toBe(0.032);
  });
});

describe('deriveOutputStage', () => {
  it('Chromium: the pair and outputLatency agree, and the stage is their max, measured', () => {
    expect(deriveOutputStage({ pairS: 0.0329, outputLatencyS: 0.032, baseLatencyS: 0.0058, sampleRate: 48000 })).toEqual({ value: 0.0329, source: 'measured' });
    expect(deriveOutputStage({ pairS: 0.0246, outputLatencyS: 0.024, baseLatencyS: 0.0029, sampleRate: 48000 })).toEqual({ value: 0.0246, source: 'measured' });
  });

  it('WebKit: the pair stops before the device (about 0 to 2 ms against 16 ms): the stage is outputLatency', () => {
    expect(pairIsPreLatency(0.0019, 0.0029)).toBe(true);
    expect(pairIsPreLatency(-0.001, 0.0029)).toBe(true);
    expect(pairIsPreLatency(0.0329, 0.0058)).toBe(false);
    expect(deriveOutputStage({ pairS: 0.0019, outputLatencyS: 0.016, baseLatencyS: 0.0029, sampleRate: 48000 })).toEqual({ value: 0.016, source: 'measured' });
    // AirPods on WebKit: the pair still reads about 0; the stage is the 150 ms the device reports.
    expect(deriveOutputStage({ pairS: 0.001, outputLatencyS: 0.15, baseLatencyS: 0.0029, sampleRate: 48000 })).toEqual({ value: 0.15, source: 'measured' });
  });

  it('Safari before the first tap, or under fingerprinting protection: nothing is known, so the prior, flagged, never 0', () => {
    expect(deriveOutputStage({ pairS: NaN, outputLatencyS: 0, baseLatencyS: 0.0029, sampleRate: 48000 })).toEqual({ value: OUTPUT_STAGE_PRIOR_S, source: 'prior' });
    expect(deriveOutputStage({ pairS: 0.001, outputLatencyS: FINGERPRINTING_BLOCK_FRAMES / 48000, baseLatencyS: 0.0029, sampleRate: 48000 })).toEqual({ value: OUTPUT_STAGE_PRIOR_S, source: 'prior' });
    expect(deriveOutputStage({})).toEqual({ value: OUTPUT_STAGE_PRIOR_S, source: 'prior' });
    expect(deriveOutputStage({ priorS: 0.03 })).toEqual({ value: 0.03, source: 'prior' });
  });

  it('a pair alone (Firefox synthesises one from currentTime - outputLatency) is used when it is not pre-latency', () => {
    expect(deriveOutputStage({ pairS: 0.045, baseLatencyS: 0 })).toEqual({ value: 0.045, source: 'pair' });
    expect(deriveOutputStage({ pairS: 0.002, baseLatencyS: 0 })).toEqual({ value: OUTPUT_STAGE_PRIOR_S, source: 'prior' });
  });

  it('a strike calibration for this device wins', () => {
    expect(deriveOutputStage({ pairS: 0.0329, outputLatencyS: 0.032, strikeS: 0.041 })).toEqual({ value: 0.041, source: 'strike' });
  });
});

describe('readOutputStage (one context, one reading)', () => {
  it('reads the pair as schedule-to-speaker and applies the rule', () => {
    // Chromium shaped: a context time written now is heard 32.9 ms from now.
    const chromium = { state: 'running', currentTime: 10, sampleRate: 48000, baseLatency: 0.0058, outputLatency: 0.032, getOutputTimestamp: () => ({ contextTime: 9.99, performanceTime: 5000 + 32.9 - 10 }) };
    expect(pairScheduleToSpeaker(chromium, 5000)).toBeCloseTo(0.0329, 6);
    expect(readOutputStage(chromium, 5000)).toEqual({ value: expect.closeTo(0.0329, 6), source: 'measured' });
    // WebKit shaped: the pair says 1 ms, the device 16.
    const webkit = { ...chromium, outputLatency: 0.016, baseLatency: 0.0029, getOutputTimestamp: () => ({ contextTime: 9.99, performanceTime: 5000 + 1 - 10 }) };
    expect(readOutputStage(webkit, 5000)).toEqual({ value: 0.016, source: 'measured' });
    // Suspended: no pair, and outputLatency reads 0 on WebKit: the prior.
    const suspended = { ...webkit, state: 'suspended', outputLatency: 0 };
    expect(readOutputStage(suspended, 5000)).toEqual({ value: OUTPUT_STAGE_PRIOR_S, source: 'prior' });
    // Chromium before the first render reports zeros: not a pair.
    const zeros = { ...chromium, getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }) };
    expect(pairScheduleToSpeaker(zeros, 5000)).toBeNaN();
    expect(readOutputStage(zeros, 5000)).toEqual({ value: 0.032, source: 'measured' });
  });
});
