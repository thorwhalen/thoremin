/**
 * TimingChip — the camera status line (step 0 of the 2026-10-05 timing plan): what the
 * timing resource measured, in one short line under the face chip, and the warnings a
 * player must act on ("audio interrupted: tap to resume", an output stage this browser
 * cannot report, an output that glitched in the last minute (#240), a camera delivering
 * under 24 fps, stamps that are not capture times).
 *
 * The resource itself is not a shell feature; this line is, and it is the one place a
 * player learns that the instrument knows how old its frames are and how late its
 * sounds land (the shipping rule: a feature nobody can find is not shipped). Words from
 * `timing/describe.ts`, so they are unit-tested; the probe's panel prints the same.
 */
import { useTimingStatus } from './timingStatus';
import { describeTiming } from './timing/describe';
import { useControls } from './store';
import { latencyHintInForce, useLatencyHintInEffect } from './timing/audioPrefs';

export default function TimingChip() {
  const reading = useTimingStatus((s) => s.reading);
  // Re-render when the box flips or a context is created with another hint; blame the box
  // only when the running context took the hint.
  const boxTicked = useControls((s) => s.audioPrefs.lowLatency);
  const hintInForce = useLatencyHintInEffect((s) => latencyHintInForce(s.hint));
  if (!reading) return null;
  const { line, warnings } = describeTiming(reading, { lowLatencyAudio: boxTicked && hintInForce });
  if (!line && warnings.length === 0) return null;
  return (
    <div data-timing-chip className="pointer-events-none absolute left-3 top-[4.75rem] flex max-w-[min(90vw,32rem)] flex-col gap-1">
      {line && (
        <div className="flex items-center gap-1.5 rounded-full bg-black/40 px-2 py-0.5 text-[9px] uppercase tracking-widest text-white/60 backdrop-blur" title="Camera and audio timing: delivered frame rate, capture-stamped frames, the frame's age at the decision, the audio output stage">
          {line}
        </div>
      )}
      {warnings.map((w) => (
        <div key={w} className="rounded-full bg-amber-500/80 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-black backdrop-blur">
          {w}
        </div>
      ))}
    </div>
  );
}
