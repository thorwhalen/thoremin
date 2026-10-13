/**
 * The CONDUCTOR section of the settings panel (#187): conduct a score with a hand, or
 * with the body (#375: `conductor.source`, the arm and point choosers following it).
 * Where the loudness comes from (#378: `conductor.expression`, the split role) and, while the
 * body shapes it, the staccato (`conductor.articulationFrom`).
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
 *
 * The orchestra (PR 5): `OrchestraControls` sits under the piece, so both surfaces that
 * mount this section offer the sampled orchestra and its levels.
 */
import { useEffect, useState } from 'react';
import { dispatchDialSetIn } from '../../dispatchDial';
import { useDialsSettings } from '../useDialsSettings';
import { selectCls } from '@thoremin/sdk-ui/primitives';
import { LoadStatusReadout } from '../../LoadStatusReadout';
import { OrchestraControls } from './orchestra';
import { useScoreStatus, setScoreStatus } from '../../scoreStatus';
import { ARTICULATION_SOURCES, CONDUCTOR_BODY_POINTS, CONDUCTOR_EXPRESSION_SOURCES, CONDUCTOR_HANDS, CONDUCTOR_MARK_LEVELS, CONDUCTOR_POINTS, CONDUCTOR_SOURCES, type ConductorDialParams } from '@/nodes/features/conductor';
import { DEFAULT_RHYTHM_PRIOR, RHYTHM_PRIOR_KINDS, type RhythmPriorKind } from '@thoremin/ictus';
import { BUILTIN_PIECE, type ConductorSettings } from '@/settings/schema';
import { createScoreStore, DEMO_SCORES, loadScoreWithStatus, type NamedSummary, type ScoreStore } from '@/score';

const HAND_LABEL: Record<ConductorDialParams['hand'], string> = {
  auto: 'either (prefer right)',
  right: 'right hand',
  left: 'left hand',
};
/** Reading the body (#375) the same dial names the beating ARM. */
const ARM_LABEL: Record<ConductorDialParams['hand'], string> = {
  auto: 'either (whichever beats)',
  right: 'right arm',
  left: 'left arm',
};
const POINT_LABEL: Record<ConductorDialParams['point'], string> = {
  wrist: 'wrist (steady)',
  indexTip: 'index fingertip (like a baton)',
};
const BODY_POINT_LABEL: Record<ConductorDialParams['bodyPoint'], string> = {
  impact: 'arm and trunk (default)',
  wrist: 'the beating wrist',
  com: 'trunk bounce',
  hips: 'hips bounce',
  head: 'head nod',
};
/** Which level a stroke marks (#376), in the player's terms. */
const MARK_LEVEL_LABEL: Record<ConductorDialParams['markLevel'], string> = {
  beat: 'a beat (default)',
  half: 'every other beat',
  bar: 'a bar',
  auto: 'whatever fits the score',
};
/** Where the dynamics come from (#378), in the player's terms. */
const EXPRESSION_LABEL: Record<ConductorDialParams['expression'], string> = {
  same: 'the beat (default)',
  hands: 'a hand',
  body: 'the body (strokes, motion, reach)',
};
const ARTICULATION_LABEL: Record<ConductorDialParams['articulationFrom'], string> = {
  sharpness: 'how sharply each stroke stops (default)',
  flow: 'how smoothly the arm moves',
};
const SOURCE_LABEL: Record<ConductorDialParams['source'], string> = {
  hands: 'a beating hand',
  body: 'the body (an arm, or a bounce)',
};
/** The rhythm prior (#232), in the player's terms: what kind of tempo it follows best. */
const PRIOR_LABEL: Record<RhythmPriorKind, string> = {
  blend: 'steady and changing (default)',
  oscillator: 'a steady beat (ignores strays)',
  trend: 'a changing tempo (follows strays)',
};

let sharedStore: ScoreStore | null = null;
const scoreStore = (): ScoreStore => (sharedStore ??= createScoreStore());

/** `sourceChooser`: the Conductor tool shows its own "Conduct with" choice above this
 *  section, so it leaves this one out; the settings editor keeps it. */
export function ConductorControls({ sourceChooser = true }: { sourceChooser?: boolean } = {}) {
  const { state } = useDialsSettings();
  const c = (state.effective.conductor ?? {}) as Partial<ConductorSettings>;
  const enabled = c.enabled === true;
  const body = c.source === 'body';
  const hand = c.hand ?? 'auto';
  const point = c.point ?? 'wrist';
  const bodyPoint = c.bodyPoint ?? 'impact';
  const markLevel = c.markLevel ?? 'beat';
  const expression = c.expression ?? 'same';
  const articulationFrom = c.articulationFrom ?? 'sharpness';
  // Articulation has a choice only while the body shapes the expression (#378).
  const bodyShapes = expression === 'body' || (expression === 'same' && body);
  const transportRules = c.transport?.rules ?? true;
  const servo = c.servoBeats ?? 1;
  const prior = (c.prior ?? DEFAULT_RHYTHM_PRIOR) as RhythmPriorKind;
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
      <OrchestraControls />
      {sourceChooser && (
        <label className="flex items-center justify-between gap-2 text-xs">
          Conduct with
          <select
            className={selectCls}
            value={body ? 'body' : 'hands'}
            onChange={(e) => dispatchDialSetIn('conductor.source', e.target.value)}
          >
            {CONDUCTOR_SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex items-center justify-between gap-2 text-xs">
        {body ? 'Beating arm' : 'Beating hand'}
        <select
          className={selectCls}
          value={hand}
          disabled={!enabled}
          onChange={(e) => dispatchDialSetIn('conductor.hand', e.target.value)}
        >
          {CONDUCTOR_HANDS.map((h) => (
            <option key={h} value={h}>
              {(body ? ARM_LABEL : HAND_LABEL)[h]}
            </option>
          ))}
        </select>
      </label>
      {body ? (
        <label className="flex items-center justify-between gap-2 text-xs">
          Follow
          <select
            className={selectCls}
            value={bodyPoint}
            disabled={!enabled}
            data-testid="conductor-body-point"
            onChange={(e) => dispatchDialSetIn('conductor.bodyPoint', e.target.value)}
          >
            {CONDUCTOR_BODY_POINTS.map((p) => (
              <option key={p} value={p}>
                {BODY_POINT_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {body && (bodyPoint === 'impact' || bodyPoint === 'wrist') ? (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={transportRules}
            disabled={!enabled}
            data-testid="conductor-transport-rules"
            aria-label="Start, hold and stop from the pose"
            onChange={(e) => dispatchDialSetIn('conductor.transport.rules', e.target.checked)}
          />
          <span>
            Start, hold and stop from the pose{' '}
            <span className="text-white/40">(raise the arm and hold still, then give an upbeat; hold still to sustain; drop the arm to stop)</span>
          </span>
        </label>
      ) : (
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
      )}
      <label className="flex items-center justify-between gap-2 text-xs">
        Each stroke marks
        <select
          className={selectCls}
          value={markLevel}
          disabled={!enabled}
          data-testid="conductor-mark-level"
          onChange={(e) => dispatchDialSetIn('conductor.markLevel', e.target.value)}
        >
          {CONDUCTOR_MARK_LEVELS.map((m) => (
            <option key={m} value={m}>
              {MARK_LEVEL_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Loudness from
        <select
          className={selectCls}
          value={expression}
          disabled={!enabled}
          data-testid="conductor-expression"
          onChange={(e) => dispatchDialSetIn('conductor.expression', e.target.value)}
        >
          {CONDUCTOR_EXPRESSION_SOURCES.map((m) => (
            <option key={m} value={m}>
              {EXPRESSION_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      {bodyShapes && (
        <label className="flex items-center justify-between gap-2 text-xs">
          Staccato from
          <select
            className={selectCls}
            value={articulationFrom}
            disabled={!enabled}
            data-testid="conductor-articulation-from"
            onChange={(e) => dispatchDialSetIn('conductor.articulationFrom', e.target.value)}
          >
            {ARTICULATION_SOURCES.map((m) => (
              <option key={m} value={m}>
                {ARTICULATION_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
      )}
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
      <label className="flex items-center justify-between gap-2 text-xs">
        Tempo sense
        <select
          className={selectCls}
          value={prior}
          disabled={!enabled}
          onChange={(e) => dispatchDialSetIn('conductor.prior', e.target.value)}
        >
          {RHYTHM_PRIOR_KINDS.map((k) => (
            <option key={k} value={k}>
              {PRIOR_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <p className="text-[10px] leading-relaxed text-white/40">
        Beat time with your hand (or, conducting with the body, your arm or a bounce of
        the trunk, with the camera seeing you from head to hips): the bottom of each
        stroke is a beat, stroke size is loudness, and the score follows your tempo. Stop beating and it holds. A short
        catch-up follows a conductor closely; a long one forgives a shaky beat. The
        tempo sense takes effect the next time conducting is switched on (with the body, also when the arm or the point changes). The demo
        pieces are public domain or CC0 (see scores/LICENSES.md); a file you load stays
        in this browser.
      </p>
    </div>
  );
}
