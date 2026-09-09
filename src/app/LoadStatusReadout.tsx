/**
 * LoadStatusReadout — the one honest readout for any lazily-loaded heavy node (#188).
 *
 * Renders a {@link LoadStatus} the way the MIDI section (#137) renders its own phase:
 * a status dot (coloured and pulsing per phase), the node's message, and — new here —
 * a progress bar while `loading` when the loader reports progress (a model or wasm
 * download). The phase vocabulary is `src/lazy/status.ts`; a node that still speaks its
 * own words (`midi-out`, `webcam-face`) is adapted by its panel, not by this component.
 *
 * `enabled` is the node's enable control: when it is off the readout says so, whatever
 * stale status a torn-down engine last reported.
 */
import type { LoadPhase, LoadStatus } from '@/lazy';

/** Status-dot colour + whether it pulses, per phase. Same palette as the MIDI panel. */
const PHASE_DOT: Record<LoadPhase, string> = {
  off: 'bg-white/30',
  unavailable: 'bg-amber-400',
  loading: 'bg-amber-400 animate-pulse',
  ready: 'bg-emerald-400',
  active: 'bg-emerald-400 animate-pulse',
  error: 'bg-rose-500',
};

export interface LoadStatusReadoutProps {
  status: LoadStatus;
  /** The node's enable control. Off → "…off" regardless of `status`. */
  enabled: boolean;
  /** What to say when disabled (defaults to "Off"). */
  offMessage?: string;
}

export function LoadStatusReadout({ status, enabled, offMessage = 'Off' }: LoadStatusReadoutProps) {
  const phase: LoadPhase = enabled ? status.phase : 'off';
  const message = enabled ? status.message : offMessage;
  const showProgress = enabled && phase === 'loading' && typeof status.progress === 'number';
  return (
    <div className="space-y-1" data-load-phase={phase} data-load-reason={enabled ? status.reason : undefined}>
      <div className="flex items-center gap-2 text-[11px] text-white/70">
        <span className={`inline-block h-2 w-2 rounded-full ${PHASE_DOT[phase]}`} aria-hidden />
        <span>{message}</span>
      </div>
      {showProgress && (
        <div
          className="h-1 w-full overflow-hidden rounded bg-white/10"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((status.progress as number) * 100)}
        >
          <div className="h-full bg-amber-400" style={{ width: `${Math.round((status.progress as number) * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
