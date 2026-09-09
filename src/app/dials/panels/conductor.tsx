/**
 * The CONDUCTOR section of the settings panel (#187): conduct a score with a hand.
 * Off by default; the toggle, the piece chooser, the hand and point choosers and the
 * follow-tightness slider all write leaves of the structured `conductor` dial through
 * `dispatchDialSetIn` (the single write path). The catch-up slider dispatches on every
 * notch (it steps in quarter beats, so a drag is at most fifteen writes), which also
 * means ⌘Z steps back a notch at a time; that is the accepted trade for keeping it on
 * the write path.
 *
 * The piece (PR 3): a chooser over the built-in scale, the shipped demos and the
 * player's saved scores, plus a file picker. A picked MIDI / MusicXML file is parsed
 * (lazily) and saved into the `scores` collection, and the chooser is switched to it,
 * so it is there next time. Loading itself is the `ScoreLoader`'s job (mounted at the
 * app root, so a piece loads with this panel closed); this section only shows its
 * status through the shared readout. What the follower is doing right now (ready /
 * running / hold, tempo, confidence) is the graph's business and is read off the
 * overlay and the Conductor tool panel (PR 4), not here.
 */
import { useEffect, useState } from 'react';
import { dispatchDialSetIn } from '../../dispatchDial';
import { useDialsSettings } from '../useDialsSettings';
import { selectCls } from '../primitives';
import { LoadStatusReadout } from '../../LoadStatusReadout';
import { useScoreStatus, setScoreStatus } from '../../scoreStatus';
import { CONDUCTOR_HANDS, CONDUCTOR_POINTS, type ConductorDialParams } from '@/nodes/features/conductor';
import { BUILTIN_PIECE, type ConductorSettings } from '@/settings/schema';
import { createScoreStore, DEMO_SCORES, loadScoreWithStatus, type NamedSummary, type ScoreStore } from '@/score';

const HAND_LABEL: Record<ConductorDialParams['hand'], string> = {
  auto: 'either (prefer right)',
  right: 'right hand',
  left: 'left hand',
};
const POINT_LABEL: Record<ConductorDialParams['point'], string> = {
  wrist: 'wrist (steady)',
  indexTip: 'index fingertip (like a baton)',
};

let sharedStore: ScoreStore | null = null;
const scoreStore = (): ScoreStore => (sharedStore ??= createScoreStore());

export function ConductorControls() {
  const { state } = useDialsSettings();
  const c = (state.effective.conductor ?? {}) as Partial<ConductorSettings>;
  const enabled = c.enabled === true;
  const hand = c.hand ?? 'auto';
  const point = c.point ?? 'wrist';
  const servo = c.servoBeats ?? 1;
  const piece = c.piece ?? BUILTIN_PIECE;
  const status = useScoreStatus();
  const [saved, setSaved] = useState<NamedSummary[]>([]);
  const [savedTick, setSavedTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    scoreStore()
      .list()
      .then((list) => {
        if (!cancelled) setSaved(list);
      })
      .catch(() => {
        /* a storage failure leaves the list empty; the demos still work */
      });
    return () => {
      cancelled = true;
    };
  }, [savedTick]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await loadScoreWithStatus(bytes, file.name, setScoreStatus);
    if (!doc) return;
    const rec = await scoreStore().save(doc.title, doc);
    setSavedTick((t) => t + 1);
    await dispatchDialSetIn('conductor.piece', rec.id);
  };

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => dispatchDialSetIn('conductor.enabled', e.target.checked)}
        />
        Conduct the score
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Piece
        <select
          className={selectCls}
          value={piece}
          onChange={(e) => dispatchDialSetIn('conductor.piece', e.target.value)}
        >
          <option value={BUILTIN_PIECE}>Built-in scale (C major, 8 beats)</option>
          {DEMO_SCORES.map((d) => (
            <option key={d.id} value={d.id} title={`${d.blurb} ${d.licence}.`}>
              {d.title}
            </option>
          ))}
          {saved.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} (saved)
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        <span>Load a MIDI or MusicXML file</span>
        <input
          type="file"
          accept=".mid,.midi,.mxl,.musicxml,.xml,audio/midi,application/vnd.recordare.musicxml,application/vnd.recordare.musicxml+xml"
          className="max-w-[55%] text-[10px]"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </label>
      <LoadStatusReadout status={status} enabled={enabled} offMessage="Turn conducting on to load the piece" />
      <label className="flex items-center justify-between gap-2 text-xs">
        Beating hand
        <select
          className={selectCls}
          value={hand}
          disabled={!enabled}
          onChange={(e) => dispatchDialSetIn('conductor.hand', e.target.value)}
        >
          {CONDUCTOR_HANDS.map((h) => (
            <option key={h} value={h}>
              {HAND_LABEL[h]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Follow
        <select
          className={selectCls}
          value={point}
          disabled={!enabled}
          onChange={(e) => dispatchDialSetIn('conductor.point', e.target.value)}
        >
          {CONDUCTOR_POINTS.map((p) => (
            <option key={p} value={p}>
              {POINT_LABEL[p]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        <span>
          Catch-up <span className="text-white/40">({servo.toFixed(2)} beats)</span>
        </span>
        <input
          type="range"
          min={0.25}
          max={4}
          step={0.25}
          value={servo}
          disabled={!enabled}
          onChange={(e) => dispatchDialSetIn('conductor.servoBeats', Number(e.target.value))}
        />
      </label>
      <p className="text-[10px] leading-relaxed text-white/40">
        Beat time with your hand: the bottom of each stroke is a beat, stroke size is
        loudness, and the score follows your tempo. Stop beating and it holds. A short
        catch-up follows a conductor closely; a long one forgives a shaky beat. The
        demo pieces are public domain or CC0 (see scores/LICENSES.md); a file you load
        stays in this browser.
      </p>
    </div>
  );
}
