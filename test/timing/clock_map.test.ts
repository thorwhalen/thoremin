/**
 * The one engine-to-context map (step 0 of the timing plan): a sound meant for engine
 * time T is written one output stage before T on the context clock, so it leaves the
 * device at T; a past time is scheduled at once, never behind the render quantum.
 */
import { describe, it, expect } from 'vitest';
import { engineToContextTime, scheduleAt, MIN_SCHEDULE_AHEAD_S } from '@thoremin/sdk/timing/clock_map';

describe('engineToContextTime', () => {
  it('offsets from now by the distance to the tick, minus the output stage', () => {
    const ac = { currentTime: 5 };
    expect(engineToContextTime(ac, 12.05, 12.0, 0.032)).toBeCloseTo(5.018, 9);
    expect(engineToContextTime(ac, 12.05, 12.0, 0)).toBeCloseTo(5.05, 9);
    // The same relation the output timestamp pair states on Chromium: a context time
    // written now is heard `stage` later, so the pair's map and this one agree.
    const stage = 0.0329;
    const pair = { contextTime: 4.9, performanceTime: (12.0 - 0.1 + stage) * 1000 };
    const viaPair = pair.contextTime + (12.05 - pair.performanceTime / 1000);
    expect(engineToContextTime(ac, 12.05, 12.0, stage)).toBeCloseTo(viaPair, 9);
  });

  it('a Bluetooth route (150 ms) moves the write 150 ms earlier, not later', () => {
    expect(engineToContextTime({ currentTime: 5 }, 12.2, 12.0, 0.15)).toBeCloseTo(5.05, 9);
  });
});

describe('scheduleAt', () => {
  it('never behind the context clock', () => {
    const ac = { currentTime: 5 };
    expect(scheduleAt(ac, 12.01, 12.0, 0.032)).toBeCloseTo(5 + MIN_SCHEDULE_AHEAD_S, 9);
    expect(scheduleAt(ac, 12.1, 12.0, 0.032)).toBeCloseTo(5.068, 9);
  });
});
