/**
 * The Generative section of the settings panel (#141 / #188): the switch for the
 * gesture-steered generative layer (`steer.enabled`, a dial), the transport (play /
 * pause — a transient store flag on the `muted` precedent, deliberately not a dial),
 * the generative bus level (`steer.volume`, a dial), and the honest status readout
 * the `lyria` node reports: off, loading its SDK, connecting, playing, or
 * `unavailable` with the reason — `no-key` says where the key goes instead of
 * showing a dead button. The MIDI section (#137) is the template.
 *
 * The transport writes the hot store directly, like the `m` key does for mute: a
 * command may only write a dial, and a persisted transport would start a paid cloud
 * stream when a saved instrument loads. The write-path guard permits non-dial store
 * state by design.
 */
import { LoadStatusReadout } from '../../LoadStatusReadout';
import { dispatchDialSet } from '../../dispatchDial';
import { useGenerativeStatus } from '../../generativeStatus';
import { useControls } from '../../store';
import { useDialsSettings } from '../useDialsSettings';
import { CollapsibleSection } from '../primitives';
import { SteeringEditor } from './steering';

/** Where the key lives: the assistant's Google provider — one key serves both. */
const NO_KEY_HINT =
  'Add your Gemini API key under the AI assistant (the bot icon, provider Google). The same key drives the assistant and the generative layer, and it stays in this browser.';

export function GenerativeControls() {
  const { state, set } = useDialsSettings();
  const v = state.effective;
  const enabled = v['steer.enabled'] as boolean;
  const volume = (v['steer.volume'] as number) ?? 0.7;
  const playing = useControls((s) => s.steerPlaying);
  const toggleSteerPlaying = useControls((s) => s.toggleSteerPlaying);
  const status = useGenerativeStatus((s) => s.status);
  const needsKey = enabled && status.phase === 'unavailable' && status.reason === 'no-key';

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={enabled} onChange={(e) => dispatchDialSet('steer.enabled', e.target.checked)} />
        Generative layer
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded bg-white/10 px-3 py-1 text-xs hover:bg-white/20 disabled:opacity-40"
          disabled={!enabled}
          aria-pressed={playing}
          onClick={toggleSteerPlaying}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <label className="flex flex-1 items-center justify-between gap-2 text-xs">
          Volume
          <input
            type="range" min={0} max={1} step={0.01} value={volume}
            disabled={!enabled}
            onChange={(e) => set('steer.volume', Number(e.target.value))}
          />
        </label>
      </div>
      <LoadStatusReadout status={status} enabled={enabled} offMessage="Generative layer off" />
      <CollapsibleSection label="Steering — what your gestures mean">
        <SteeringEditor />
      </CollapsibleSection>
      {needsKey && <p className="text-[10px] leading-relaxed text-amber-300/80">{NO_KEY_HINT}</p>}
      <p className="text-[10px] leading-relaxed text-white/40">
        Your hands conduct a cloud generative engine (Lyria RealTime). By default the right hand's openness fades a pad in,
        raising the left hand brings in an arpeggio, and raising the right hand brightens the mix. It follows you
        over a phrase, not a note — expect about two seconds of lead. Bring your own key; nothing else leaves the browser.
      </p>
    </div>
  );
}
