/**
 * A progress ring (#403): the hold ring's shape (`HoldRing.tsx`), filled to a fraction, for a
 * step that ends by itself, such as the take's rest toward its 3 s and 60 frames. A `warn` tone
 * says that what the step needs is not happening ("stay relaxed"); the words come from the host.
 * Purely presentational, and announced as a progress bar.
 */
import { HOLD_RING_DEFAULTS } from './HoldRing';

export const PROGRESS_RING_DEFAULTS = {
  size: HOLD_RING_DEFAULTS.size,
  /** How long the ring takes to move to a new value, ms (it is fed in coarse steps). */
  easeMs: 200,
} as const;

export interface ProgressRingProps {
  /** How far along, 0..1 (clamped). */
  value: number;
  /** The line beside the ring. */
  words: string;
  /** What the progress bar is of, for assistive technology. */
  label: string;
  tone?: 'normal' | 'warn';
}

export function ProgressRing({ value, words, label, tone = 'normal' }: ProgressRingProps) {
  const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const size = PROGRESS_RING_DEFAULTS.size;
  const r = size / 2 - 2.5;
  const circumference = 2 * Math.PI * r;
  const color = tone === 'warn' ? '#fbbf24' : '#e5e7eb';
  const percent = Math.round(v * 100);
  return (
    <span
      className="inline-flex items-center gap-1.5"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${percent} %: ${words}`}
      data-progress-ring={percent}
      data-progress-tone={tone}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={3} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - v)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: `stroke-dashoffset ${PROGRESS_RING_DEFAULTS.easeMs}ms linear` }}
        />
      </svg>
      <span className={`text-[11px] ${tone === 'warn' ? 'font-semibold text-amber-200' : 'text-white/75'}`}>{words}</span>
    </span>
  );
}

export default ProgressRing;
