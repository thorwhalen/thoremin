/**
 * Countdown (#92, design §6) — the centered lead-in countdown. When a tag with a
 * lead-in opens, the performer needs `leadIn` seconds to physically start the action;
 * this tells them when the tagged action officially begins (at `tCorrected`).
 *
 * It is PURELY presentational: the stored event time is the click instant; the
 * countdown never gates logging. A subscriber to the tagging store's `countdown`
 * state; it ticks itself off `performance.now()` and clears when the lead-in elapses
 * (showing a brief "GO"). Part of the build-checked React layer.
 */
import { useEffect, useState } from 'react';
import { useTagging } from './store';

export default function Countdown() {
  const countdown = useTagging((s) => s.countdown);
  const clear = useTagging((s) => s.clearCountdown);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!countdown) return;
    let raf = 0;
    const tick = () => {
      const rem = countdown.leadIn - (performance.now() / 1000 - countdown.startPerf);
      setRemaining(rem);
      // Hold "GO" for ~0.4s past zero, then dismiss.
      if (rem <= -0.4) {
        clear();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [countdown, clear]);

  if (!countdown) return null;
  const label = remaining > 0 ? String(Math.ceil(remaining)) : 'GO';
  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
      <div className="flex flex-col items-center gap-2">
        <div className="text-[120px] font-black leading-none text-white drop-shadow-[0_0_30px_rgba(0,0,0,0.9)]">
          {label}
        </div>
        <div className="rounded-full bg-black/60 px-4 py-1 text-xs uppercase tracking-widest text-white/80 backdrop-blur">
          {countdown.label} starting
        </div>
      </div>
    </div>
  );
}
