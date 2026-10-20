/**
 * Adversarial audit of the timing tracker (2026-10-20 review lane): a context resumed from a
 * suspend can hand back the output-timestamp pair it had before the suspend, which reads as
 * a schedule-to-speaker of minus the suspended seconds; after an epoch reset that one reading
 * IS the smoothed estimate until some eighty ticks have washed it out. A reading no output
 * stage can have (negative, or longer than a second) is not a sample.
 */
import { describe, expect, it } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import { TimingTracker } from '@thoremin/sdk/timing/tracker';

function tick(tracker: TimingTracker, n: number, time: number) {
  const ctx: NodeContext = { tick: n, time, dt: n ? 1 / 60 : 0, resources: { timeScale: 1 } };
  tracker.onValue('merge.params', 1, ctx);
}

describe('the output-timestamp pair after a resume', () => {
  it('ignores a stale pair that reads as a negative schedule-to-speaker', () => {
    let clockMs = 0;
    let stale = false;
    const ac = {
      state: 'running',
      currentTime: 0,
      sampleRate: 48000,
      baseLatency: 0.0058,
      outputLatency: 0.032,
      getOutputTimestamp() {
        // Stale: the pair the browser had when the context suspended 30 s ago. The context
        // clock did not advance while suspended, so its context time is about now's; the
        // performance time is 30 s old.
        return stale ? { contextTime: this.currentTime, performanceTime: clockMs - 30000 } : { contextTime: this.currentTime, performanceTime: clockMs + 33 };
      },
    };
    const tracker = new TimingTracker({ now: () => clockMs, audio: () => ac });
    for (let n = 0; n < 20; n++) {
      clockMs = n * 16;
      ac.currentTime = n / 60;
      tick(tracker, n, n / 60);
    }
    expect(tracker.reading().scheduleToSpeaker).toBeCloseTo(0.033, 3);
    tracker.bumpEpoch();
    stale = true;
    clockMs += 16;
    ac.currentTime += 1 / 60;
    tick(tracker, 20, ac.currentTime);
    const r = tracker.reading();
    expect(Number.isNaN(r.scheduleToSpeaker) || r.scheduleToSpeaker >= 0).toBe(true);
    expect(r.outputStage.value).toBeGreaterThan(0);
  });
});
