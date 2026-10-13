/**
 * The low-latency audio box in the Sound section (#240): the per-device pref that asks
 * for `latencyHint: 0` (see `timing/audioPrefs.ts` for why it is a per-device pref and
 * not a dial). It writes the hot store's tooling state, not the dials store, like the
 * face calibration: it is not a param mutation, so it is not a command.
 *
 * Honest about its limits: the hint is fixed when the audio context is created, so the
 * box says a reload applies it; Firefox and Safari ignore the hint, so there it says so;
 * and the status line counts the output's glitches and, with the box on, names it.
 */
import { useControls } from '../../store';
import { honoursNumericLatencyHint } from '../../timing/audioPrefs';

export function LowLatencyAudioControl() {
  const lowLatency = useControls((s) => s.audioPrefs.lowLatency);
  const setAudioPrefs = useControls((s) => s.setAudioPrefs);
  const honoured = typeof navigator === 'undefined' || honoursNumericLatencyHint(navigator.userAgent);
  return (
    <div data-low-latency-audio className="space-y-0.5">
      <label className="flex items-center gap-2 text-xs" title="Ask the browser for its smallest audio buffer (latencyHint 0): a few ms sooner, at the risk of dropouts. The timing line warns if the output glitches.">
        <input type="checkbox" checked={lowLatency} onChange={(e) => setAudioPrefs({ lowLatency: e.target.checked })} />
        Low-latency audio
      </label>
      <p className="pl-5 text-[10px] leading-snug text-white/45">
        {honoured ? 'This device only; applies after a reload.' : 'This browser ignores the request (Chromium only).'}
      </p>
    </div>
  );
}
