/**
 * The instrument editor's "Pose categorizer" section (#384): which of the player's saved pose
 * categorizers the instrument reads (its category drawn on the video), and whether its `ready`,
 * `fermata` and `cut-off` poses start, hold and cut off the body conductor in place of the rules
 * (#387 B5). Every write goes through the dial commands (`dial.setIn`, the single write path); the
 * section reads the resolved categorizer from {@link usePosePlay}, which the extension's mount
 * effect keeps.
 */
import { useEffect, useState } from 'react';
import { selectCls } from '@thoremin/sdk-ui/primitives';
import { dispatchDialSetIn, useDialsSettings } from '@thoremin/sdk-ui/dials';
import type { NamedSummary } from '@thoremin/sdk-ui/namedCollection';
import { bodyModality } from '@thoremin/sdk/features/modalities/body';
import { usePosePlay } from '../app/posePlay';
import { createCategorizerStore } from '../app/categorizers';
import { onFaceModelsChanged } from '../app/models';
import { DEFAULT_POSE_CATEGORIZER, type PoseCategorizerDial } from '../schema';

/** The player's saved pose categorizers, kept fresh across saves and deletes. */
export function useSavedPoseCategorizers(): NamedSummary[] {
  const [saved, setSaved] = useState<NamedSummary[]>([]);
  useEffect(() => {
    const store = createCategorizerStore(bodyModality);
    let live = true;
    const refresh = () => void store.list().then((s) => live && setSaved(s), () => undefined);
    refresh();
    const off = onFaceModelsChanged(refresh);
    return () => {
      live = false;
      off();
    };
  }, []);
  return saved;
}

const ROLE_WORDS = { ready: 'start (ready)', hold: 'hold (fermata)', cutoff: 'stop (cut-off)' } as const;

/** What the transport takes from the poses, in words: each role's category, or the rule. */
export function transportSummary(play: ReturnType<typeof usePosePlay.getState>): string {
  const byId = new Map(play.categories.map((c) => [c.id, c.name]));
  return (Object.keys(ROLE_WORDS) as (keyof typeof ROLE_WORDS)[])
    .map((r) => `${ROLE_WORDS[r]}: ${play.roles[r] ? `your "${byId.get(play.roles[r]!)}"` : 'the rule'}`)
    .join('; ');
}

export default function PoseCategorizerSection() {
  const { state } = useDialsSettings();
  const dial = ((state.effective as Record<string, unknown>).poseCategorizer as PoseCategorizerDial | undefined) ?? DEFAULT_POSE_CATEGORIZER;
  const saved = useSavedPoseCategorizers();
  const play = usePosePlay();
  const known = dial.id === '' || saved.some((s) => s.id === dial.id);
  return (
    <div className="space-y-2 text-[11px] text-white/80" data-pose-categorizer-section>
      <label className="flex items-center gap-2">
        <span>Reads your poses with</span>
        <select className={selectCls} value={dial.id} onChange={(e) => void dispatchDialSetIn('poseCategorizer.id', e.target.value)}>
          <option value="">nothing (no pose categorizer)</option>
          {saved.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          {!known && <option value={dial.id}>{dial.id} (not on this device)</option>}
        </select>
      </label>
      {saved.length === 0 && <p className="text-white/50">No saved poses yet: record some in Tools, Your poses.</p>}
      <label className="flex items-center gap-2" data-pose-transport-choice>
        <input type="checkbox" checked={dial.transport} disabled={dial.id === ''} onChange={(e) => void dispatchDialSetIn('poseCategorizer.transport', e.target.checked)} />
        <span>Start, hold and cut off the body conductor with my poses</span>
      </label>
      {dial.transport && play.phase === 'ready' && (
        <p className="text-white/50" data-pose-transport-summary>
          {transportSummary(play)}
        </p>
      )}
    </div>
  );
}

/** One line: what the instrument reads poses with right now. */
export function PoseCategorizerReadout() {
  const play = usePosePlay();
  const text = play.phase === 'ready' ? `Reading your poses with ${play.name}` : play.phase === 'loading' ? 'Loading…' : play.phase === 'missing' ? 'Not on this device: no poses are read' : 'No pose categorizer';
  return (
    <span className="text-[10px] text-white/50" data-poses-readout>
      {text}
    </span>
  );
}
