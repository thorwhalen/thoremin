/**
 * The camera status line's words (step 0 of the timing plan): what the timing resource
 * says to a player, and which states earn a warning. Pure, so the shell chip and the
 * probe's panel are covered without a DOM.
 */
import { describe, it, expect } from 'vitest';
import { UNSTAMPED_SOURCE, type TimingReading } from '@thoremin/sdk/timing/tracker';
import { describeTiming, LOW_LIGHT_FPS, MIN_FRAMES_FOR_STAMP_HINT } from '@/app/timing/describe';
import { makeTimingReporter, timingStatusKey } from '@/app/timingStatus';

function reading(over: Partial<TimingReading> = {}): TimingReading {
  return {
    outputStage: { value: 0.032, source: 'measured' },
    audioEpoch: 0,
    frameAge: { mean: 0.027, p95: 0.035 },
    framePeriod: 1 / 30,
    deliveredFps: 30,
    stampSources: { capture: 88, estimated: 2 },
    dominantSource: 'capture',
    skippedFrames: 0,
    frames: 300,
    scheduleToSpeaker: 0.0329,
    audio: { state: 'running', sampleRate: 48000, baseLatency: 0.0058, outputLatency: 0.032, outputLatencyKnown: true, glitches: { total: 0, recent: 0, underrunS: NaN, source: 'none' } },
    camera: { frameRate: 30, width: 1280, height: 720 },
    leadBudget: 0.067,
    ...over,
  };
}

describe('describeTiming', () => {
  it('one line: the delivered rate, the capture-stamp share, the age, the output stage with its source', () => {
    const d = describeTiming(reading());
    expect(d.line).toBe('30 fps · capture stamps 98 % · age 27 ms · out 32 ms measured');
    expect(d.warnings).toEqual([]);
  });

  it('says nothing before a frame', () => {
    expect(describeTiming(reading({ frames: 0, stampSources: {}, deliveredFps: NaN, frameAge: { mean: NaN, p95: NaN } })).line).toBe('');
  });

  it('warns when the audio is interrupted, when the output stage is unknown with audio running, and when it is Bluetooth-sized', () => {
    expect(describeTiming(reading({ audio: { ...reading().audio, state: 'interrupted' } })).warnings).toContain('audio interrupted: tap to resume');
    const unknown = describeTiming(reading({ outputStage: { value: 0.02, source: 'prior' } }));
    expect(unknown.warnings).toEqual(['audio output latency unknown on this browser: run the strike test (?probe=latency)']);
    expect(unknown.line).toContain('out 20 ms assumed');
    // Before the first tap nothing is known and nothing is wrong: no warning.
    expect(describeTiming(reading({ outputStage: { value: 0.02, source: 'prior' }, audio: { ...reading().audio, state: 'suspended' } })).warnings).toEqual([]);
    expect(describeTiming(reading({ outputStage: { value: 0.15, source: 'measured' } })).warnings).toEqual(['your audio output adds 150 ms']);
  });

  it('warns about a slow camera (low light) and about stamps that are not capture times', () => {
    expect(describeTiming(reading({ deliveredFps: LOW_LIGHT_FPS - 6 })).warnings).toEqual(['camera delivers 18 fps (low light?)']);
    const clocked = reading({ deliveredFps: NaN, dominantSource: 'clock', stampSources: { clock: MIN_FRAMES_FOR_STAMP_HINT } });
    expect(describeTiming(clocked).warnings).toEqual(['frames carry clock stamps, not capture times']);
    expect(describeTiming(clocked).line).toContain('30 fps processed');
    expect(describeTiming(reading({ dominantSource: 'clock', stampSources: { clock: MIN_FRAMES_FOR_STAMP_HINT - 1 } })).warnings).toEqual([]);
  });

  it('says nothing about stamps when the frames carry none (a synthetic source) or theirs were not used (a replay)', () => {
    const unstamped = reading({ deliveredFps: NaN, dominantSource: UNSTAMPED_SOURCE, stampSources: { [UNSTAMPED_SOURCE]: MIN_FRAMES_FOR_STAMP_HINT * 2 } });
    expect(describeTiming(unstamped).warnings).toEqual([]);
    expect(describeTiming(unstamped).line).toContain('capture stamps 0 %');
  });

  it('warns when the audio output glitched in the last minute, and names the low-latency box when it is on (#240)', () => {
    const glitched = (recent: number) => reading({ audio: { ...reading().audio, glitches: { total: recent + 3, recent, underrunS: 0.01, source: 'playbackStats' } } });
    expect(describeTiming(glitched(0)).warnings).toEqual([]);
    expect(describeTiming(glitched(1)).warnings).toEqual(['audio glitched once in the last minute']);
    expect(describeTiming(glitched(4)).warnings).toEqual(['audio glitched 4 times in the last minute']);
    expect(describeTiming(glitched(2), { lowLatencyAudio: true }).warnings).toEqual(['audio glitched 2 times: turn off low-latency audio']);
    expect(describeTiming(glitched(0), { lowLatencyAudio: true }).warnings).toEqual([]);
  });

  it('counts skipped frames in the line', () => {
    expect(describeTiming(reading({ skippedFrames: 12 })).line).toContain('12 skipped');
  });
});

describe('makeTimingReporter', () => {
  it('reports only when the line changes, and at most every half second', () => {
    let r = reading();
    const reports: TimingReading[] = [];
    const report = makeTimingReporter(() => r, { report: (x) => void reports.push(x) });
    report(0);
    report(100);
    report(600);
    expect(reports).toHaveLength(1); // nothing changed
    r = reading({ deliveredFps: 15 });
    report(700);
    expect(reports).toHaveLength(2);
    expect(timingStatusKey(reports[1])).not.toBe(timingStatusKey(reports[0]));
    r = reading({ deliveredFps: 16 });
    report(900);
    expect(reports).toHaveLength(2); // changed, but under the pacing since the last report
    report(1300);
    expect(reports).toHaveLength(3);
    r = reading({ deliveredFps: 16, audioEpoch: 1 });
    report(2000);
    expect(reports).toHaveLength(4); // an epoch bump is a change
  });
});
