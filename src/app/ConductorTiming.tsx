/**
 * "Learn my timing" in the Conductor tool (#427): the body conductor's lead offsets per
 * joint, learned against a click (`conductorLead.ts`), kept per device.
 *
 * Shown while the conductor reads the body. Idle, it says which offsets are kept and
 * offers the take; during the take, which click the player is on; after it, each joint's
 * lag and whether it kept the click (a joint that did not gets no offset), then Keep or
 * Discard, which go through the `conductor.timing.*` commands. Reachable in three clicks
 * from a cold load: Tools, Conductor, Conduct with body (the button is then in view).
 */
import { dispatchCommand } from './dispatchDial';
import { useControls } from './store';
import { cancelLeadTake, formatLag, jointLabel, startLeadTake, useLeadCalibration, LEAD_TAKE } from './conductorLead';
import { firstTempo } from '@/nodes/features/conductor';
import type { ConductorSettings } from '@/settings/schema';

export default function ConductorTiming({ dial }: { dial: Partial<ConductorSettings> }) {
  const kept = useControls((s) => s.conductorPrefs.leadOffsets);
  const doc = useControls((s) => s.scoreDoc);
  const { phase, take, clicksPast, result } = useLeadCalibration();
  const bpm = Math.round((doc ? firstTempo(doc) : null) ?? LEAD_TAKE.bpm);
  const keptList = Object.entries(kept);

  return (
    <div className="space-y-1.5 rounded-lg bg-white/5 p-2 text-xs text-white/80" data-conductor-timing>
      <div className="flex items-center gap-2">
        <span className="flex-1 font-semibold">Your timing</span>
        {phase === 'idle' && (
          <button
            data-conductor-timing-learn
            onClick={() => startLeadTake({ bpm, point: dial.bodyPoint ?? 'impact', side: dial.hand ?? 'auto' })}
            className="rounded bg-white/10 px-2 py-0.5 font-semibold hover:bg-white/20"
          >
            Learn my timing...
          </button>
        )}
        {phase === 'listening' && (
          <button onClick={cancelLeadTake} className="rounded bg-white/10 px-2 py-0.5 font-semibold hover:bg-white/20">
            Cancel
          </button>
        )}
      </div>
      {phase === 'idle' && (
        <p className="text-[10px] text-white/50" data-conductor-timing-kept>
          {keptList.length
            ? `Each beat is moved by your joint's lag: ${keptList.map(([j, s]) => `${jointLabel(j)} ${formatLag(s)}`).join(', ')}.`
            : `Not learned: each beat plays where your joint turns. A count-in and ${LEAD_TAKE.beats} clicks at ${bpm} bpm; beat one stroke per click.`}
          {keptList.length > 0 && (
            <button data-conductor-timing-clear onClick={() => void dispatchCommand('conductor.timing.clear', {})} className="ml-1 underline hover:text-white">
              Forget it
            </button>
          )}
        </p>
      )}
      {phase === 'listening' && take && (
        <p className="text-[10px] text-emerald-300/90" data-conductor-timing-progress>
          {clicksPast === 0 ? 'Listen to the count-in, then beat one stroke per click.' : `Click ${clicksPast} of ${take.beats.length}: keep beating.`}
        </p>
      )}
      {phase === 'done' && result && (
        <div className="space-y-1" data-conductor-timing-result>
          <ul className="text-[10px]">
            {Object.entries(result.lags).map(([joint, lag]) => (
              <li key={joint}>
                {jointLabel(joint)}:{' '}
                {result.offsets[joint] !== undefined ? `${formatLag(result.offsets[joint])} (kept the click, ${Math.round(lag.r * 100)} %)` : `did not keep the click (${lag.n} strokes), not corrected`}
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-white/50">A joint's lag can drift within a take: if the beat feels off, learn it again.</p>
          <div className="flex gap-1">
            <button data-conductor-timing-keep onClick={() => void dispatchCommand('conductor.timing.keep', {})} className="rounded bg-emerald-500 px-2 py-0.5 font-semibold text-black hover:bg-emerald-400">
              Keep
            </button>
            <button onClick={cancelLeadTake} className="rounded bg-white/10 px-2 py-0.5 font-semibold hover:bg-white/20">
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
