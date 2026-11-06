/**
 * The physical theremin's hand positions: the codified techniques (Eyck's eight finger positions,
 * Rockmore's aerial fingering; `../lib/poses.ts`) as a guide, which position the pitch hand is in
 * now, and the pose snap's strength (`../lib/pose_snap.ts`: 0 = the raw field, 1 = the codified
 * interval between two held positions).
 */
import { dispatchDialSetIn } from '@thoremin/sdk-ui/dials';
import { CollapsibleSection, ValueRow, selectCls } from '@thoremin/sdk-ui/primitives';
import { POSE_LIBRARY, POSE_REFS, type Pose } from '../lib/poses';
import { POSE_SYSTEMS, type PoseSystem } from '../lib/pose_systems';
import { POSE_SNAP_TUNING } from '../lib/pose_snap';
import type { PhysicalThereminSettings } from '../schema';
import { usePhysicalThereminStatus } from '../app/status';

const KEY = 'physicalTheremin';

/** The interval a position plays, in words. */
export function intervalText(p: Pose): string {
  if ('semitones' in p.interval) {
    const n = p.interval.semitones;
    return n === 0 ? 'the first note' : `${n} semitone${n === 1 ? '' : 's'} above`;
  }
  const k = p.interval.scaleSteps;
  return k === 0 ? 'the first note' : `${k} scale step${k === 1 ? '' : 's'} above`;
}

/** Where a position's shape comes from and, if measured, how well the tracker names it. */
function measuredText(p: Pose): string {
  const m = p.measured;
  if (!m) return "shape from the sources' words, not measured";
  const base = `shape measured on ${m.frames} frames of ${m.videos.length} of the lesson videos`;
  if (m.precision === null) return base;
  const named = `named rightly ${Math.round(100 * m.precision)}% of the time on a lesson held out`;
  return m.precision >= POSE_SNAP_TUNING.minPrecision ? `${base}; ${named}` : `${base}; ${named}, so the snap leaves it unpulled`;
}

function PositionNow({ system }: { system: PoseSystem }) {
  const live = usePhysicalThereminStatus((s) => s.live);
  const pos = live?.position;
  const pose = pos ? POSE_LIBRARY.systems[system]?.poses.find((p) => p.id === pos.id) : null;
  if (!live?.pitchHand) return <div className="text-xs text-white/50">Raise your right hand near the rod to see its position.</div>;
  if (!pose) return <div className="text-xs text-white/50">Your hand holds none of the positions, or not surely enough yet.</div>;
  return (
    <div className="text-xs text-white/80">
      Now: <span className="font-bold">{pose.label}</span> ({intervalText(pose)})
    </div>
  );
}

export function HandPositionsSection({ c, enabled }: { c: PhysicalThereminSettings; enabled: boolean }) {
  const system = c.positions.system;
  const lib = system === 'off' ? null : POSE_LIBRARY.systems[system];
  return (
    <CollapsibleSection label="Hand positions" defaultOpen={false}>
      <label className="flex items-center justify-between gap-2 text-xs">
        Technique
        <select className={selectCls} value={system} disabled={!enabled} onChange={(e) => dispatchDialSetIn(`${KEY}.positions.system`, e.target.value)}>
          <option value="off">none</option>
          {POSE_SYSTEMS.map((s) => (
            <option key={s} value={s}>
              {POSE_LIBRARY.systems[s]!.name}
            </option>
          ))}
        </select>
      </label>
      {lib && system !== 'off' && (
        <>
          <ValueRow label="Hold the intervals" value={c.positions.snap}>
            <input type="range" min={0} max={1} step={0.05} value={c.positions.snap} disabled={!enabled} className="w-28" onChange={(e) => dispatchDialSetIn(`${KEY}.positions.snap`, Number(e.target.value))} />
          </ValueRow>
          <p className="text-[10px] leading-relaxed text-white/50">
            0 plays the raw field. Higher pulls the step between two positions held in one place toward the technique's own interval; moving the arm chooses another place.
          </p>
          <PositionNow system={system} />
          <p className="text-[10px] leading-relaxed text-white/60">{lib.summary}</p>
          <ol className="space-y-1">
            {lib.poses.map((p) => (
              <li key={p.id} className="text-[10px] leading-relaxed text-white/60">
                <span className="font-bold text-white/80">{p.label}</span>, {intervalText(p)}: {p.shape}{' '}
                <span className="text-white/40">
                  ({p.confidence} confidence; {measuredText(p)})
                </span>
              </li>
            ))}
          </ol>
          <p className="text-[10px] leading-relaxed text-white/40">
            Sources:{' '}
            {lib.refs.map((n, i) => (
              <span key={n}>
                {i > 0 && '; '}[{n}]{' '}
                <a className="underline" href={POSE_REFS[n]?.url} target="_blank" rel="noreferrer">
                  {POSE_REFS[n]?.text}
                </a>
              </span>
            ))}
          </p>
        </>
      )}
    </CollapsibleSection>
  );
}
