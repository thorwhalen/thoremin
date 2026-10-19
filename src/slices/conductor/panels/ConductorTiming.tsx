/**
 * "Learn my timing" in the Conductor tool (#427): the body conductor's lead offsets per
 * joint, learned against a click (`conductorLead.ts`), kept per device.
 *
 * Shown while the conductor reads the body. Idle, it says which offsets are kept and
 * offers the take (with conducting stopped: the score would otherwise start over the
 * click); during the take, which click the player is on; after it, each joint's lag, or
 * why it was not measured well enough to correct, then Keep (merged per joint, only when a
 * joint was measured) or Discard, through the `conductor.timing.*` commands. From a cold
 * load: the bar's Conductor, Conduct with body, Learn my timing (three clicks).
 */
import { useEffect } from 'react';
import { dispatchCommand } from './dispatchDial';
import { useControls } from './store';
import { cancelLeadTake, formatLag, jointLabel, leadTakeBpm, startLeadTake, useLeadCalibration, LEAD_TAKE, REFUSAL_WORDS } from './conductorLead';
import { firstTempo } from '@thoremin/sdk/score/schema';
import type { ConductorSettings } from '@/settings/schema';

export default function ConductorTiming({ dial }: { dial: Partial<ConductorSettings> }) {
  const kept = useControls((s) => s.conductorPrefs.leadOffsets);
  const doc = useControls((s) => s.scoreDoc);
  const { phase, take, clicksPast, result, failure } = useLeadCalibration();
  const bpm = leadTakeBpm(doc ? firstTempo(doc) : null);
  const keptList = Object.entries(kept);
  const conducting = dial.enabled === true;
  const measured = result ? Object.keys(result.offsets).length > 0 : false;
  // Conducting started mid-take (the Start button, the palette): the score would sound over
  // the click, so the take is cancelled rather than scored.
  useEffect(() => {
    if (conducting && phase === 'listening') cancelLeadTake();
  }, [conducting, phase]);

  return (
    <div className="space-y-1.5 rounded-lg bg-white/5 p-2 text-xs text-white/80" data-conductor-timing>
      <div className="flex items-center gap-2">
        <span className="flex-1 font-semibold">Your timing</span>
        {phase === 'idle' && (
          <button
            data-conductor-timing-learn
            disabled={conducting}
            onClick={() => startLeadTake({ bpm, point: dial.bodyPoint ?? 'impact', side: dial.hand ?? 'auto' })}
            className="rounded bg-white/10 px-2 py-0.5 font-semibold hover:bg-white/20 disabled:opacity-40"
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
          {conducting && ' Stop conducting to learn it.'}
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
      {phase === 'done' && (
        <div className="space-y-1" data-conductor-timing-result>
          {failure === 'clicks' && <p className="text-[10px] text-amber-300/90">Some clicks did not play, so the take cannot be scored. Try again.</p>}
          {result && (
            <ul className="text-[10px]">
              {Object.entries(result.lags).map(([joint, lag]) => {
                const why = result.refused[joint];
                return (
                  <li key={joint}>
                    {jointLabel(joint)}: {why ? `${REFUSAL_WORDS[why]}, not corrected` : `${formatLag(lag.lagS)} (±${Math.round(lag.seS * 1000)} ms)`}
                  </li>
                );
              })}
            </ul>
          )}
          {result && !measured && <p className="text-[10px] text-white/50">No joint was measured well enough to correct: nothing changes.</p>}
          <div className="flex gap-1">
            {measured && (
              <button data-conductor-timing-keep onClick={() => void dispatchCommand('conductor.timing.keep', {})} className="rounded bg-emerald-500 px-2 py-0.5 font-semibold text-black hover:bg-emerald-400">
                Keep
              </button>
            )}
            <button onClick={cancelLeadTake} className="rounded bg-white/10 px-2 py-0.5 font-semibold hover:bg-white/20">
              {measured ? 'Discard' : 'Close'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
