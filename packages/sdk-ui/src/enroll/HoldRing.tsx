/**
 * The hold ring (#385 E2): makes the still-point sampler's dwell and latch visible, the cheapest
 * fix for recording blind. It fills while a pose is held (`settling`, over the sampler's dwell),
 * closes and flashes when a hold is taken (the `taken` count went up), and while the sampler
 * is latched (`latched`: that pose was already given) it asks for a new one. Purely presentational: the state
 * comes from the take (`HoldState` in the carve tool), the words from the host. `taken` and
 * `latched` both show a closed ring; only `taken` (a hold just taken) is green.
 */
import { useEffect, useRef, useState } from 'react';

export type HoldRingState = 'open' | 'settling' | 'taken' | 'latched';

export const HOLD_RING_DEFAULTS = {
  /** The sampler's dwell, ms: how long the ring takes to fill. */
  dwellMs: 220,
  /** How long the flash lasts after a hold is taken, ms. */
  flashMs: 450,
  size: 22,
} as const;

export interface HoldRingProps {
  state: HoldRingState;
  /** Holds taken so far: an increase flashes the ring. */
  taken?: number;
  /** The line beside the ring, per state. */
  words: Readonly<Record<HoldRingState, string>>;
  dwellMs?: number;
}

export function HoldRing({ state, taken = 0, words, dwellMs = HOLD_RING_DEFAULTS.dwellMs }: HoldRingProps) {
  const [flash, setFlash] = useState(false);
  const last = useRef(taken);
  useEffect(() => {
    if (taken > last.current) {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), HOLD_RING_DEFAULTS.flashMs);
      last.current = taken;
      return () => clearTimeout(timer);
    }
    last.current = taken;
    return undefined;
  }, [taken]);
  const size = HOLD_RING_DEFAULTS.size;
  const r = size / 2 - 2.5;
  const circumference = 2 * Math.PI * r;
  const filled = state === 'open' ? 0 : 1;
  // Filling animates over the dwell; emptying (a move) is immediate.
  const transition = state === 'settling' ? `stroke-dashoffset ${dwellMs}ms linear` : 'none';
  const color = flash ? '#6ee7b7' : state === 'taken' ? '#34d399' : state === 'latched' ? 'rgba(255,255,255,0.45)' : '#e5e7eb';
  return (
    <span className="inline-flex items-center gap-1.5" data-hold-ring={state} data-hold-flash={flash ? 'on' : undefined} role="status" aria-live="polite">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className={flash ? 'scale-110 transition-transform' : 'transition-transform'}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={3} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill={state === 'taken' ? 'rgba(52,211,153,0.25)' : 'none'}
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - filled)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition }}
        />
      </svg>
      <span className="text-[11px] text-white/75">{flash ? words.taken : words[state]}</span>
    </span>
  );
}

export default HoldRing;
