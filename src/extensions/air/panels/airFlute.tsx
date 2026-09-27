/**
 * The AIR FLUTE section of the settings panel (#249, #263): the enrolment steps, then
 * the dials.
 *
 * - **Your fingerings.** Name a note ("D5"), press Learn, and hold its finger shape with
 *   both hands. A real key press is under the hand tracker's noise (the research's air
 *   flute finding, `docs/research/air-instruments.md` §7.2), so the shapes should be
 *   LARGE, deliberate lifts: this is an air flute, there is no tube in the way.
 * - **Learn a sequence** (#263). Pick a scale or type a list of notes, press Start, and
 *   the trainer walks through it: the next note showing, a countdown, a hold, and the
 *   fingering guide drawing the shape the prior expects. Every held note is enrolled.
 * - **The fingering chart** (#263). With the prior on, the flute already knows roughly
 *   what every note of the chart looks like; enrolment tunes it to the player's hands,
 *   and a sequence's wrong note is caught. The dial names the chart, its weight against
 *   the player's own samples, and the note range.
 * - **Your breath.** Learn your blowing mouth and your resting mouth. The mouth arms the
 *   note rather than timing it (§7.2.1, #248), so it is a gate: the note sounds while the
 *   mouth reads as blowing. Set Breath to "fingers only" to skip it (then a held
 *   fingering plays).
 *
 * The enrolments are the shared {@link VocabularyEnrolment} and {@link SequenceTrainer},
 * capturing from the `air-flute` node's own `shape` and `mouth` outputs. The dials write
 * leaves of the `airFlute` dial through `dispatchDialSetIn` (the single write path).
 */
import { useState } from 'react';
import { dispatchDialSetIn } from '@/app/dispatchDial';
import { useDialsSettings } from '@/app/dials/useDialsSettings';
import { selectCls } from '@/app/dials/primitives';
import { AIR_FLUTE_NODE_ID, describeFluteLive, useAirFluteStatus } from '@/extensions/air/app/airFluteStatus';
import { readShape } from '@/extensions/air/app/shapeTap';
import { useFluteFingerVocabulary, useFluteMouthVocabulary } from '@/extensions/air/app/vocabularyStore';
import { VocabularyEnrolment, type EnrolmentWords } from '@/extensions/air/app/VocabularyEnrolment';
import { SequenceTrainer, type SequenceTrainerWords } from '@/extensions/air/app/SequenceTrainer';
import { FingeringGuide } from '@/extensions/air/app/FingeringGuide';
import { FLUTE_STARTER_SEQUENCES } from '@/app/enroll/sequenceStore';
import { TRAINING_ANCHORS } from '@/app/training/routes';
import { useControls } from '@/app/store';
import { checkTake, expectedFingering, priorOptionsFrom, type FingeringPriorSettings } from '@/extensions/air/lib/fingering_prior';
import { FINGERING_CHARTS } from '@/music/fingerings';
import { parseNoteName } from '@/music/notes';
import { BREATH_MODES, MOUTH_BLOW, MOUTH_REST, type AirFluteDialParams } from '@/extensions/air/nodes/air_flute';

const BREATH_LABEL: Record<AirFluteDialParams['breath'], string> = {
  mouth: 'your blowing mouth',
  always: 'fingers only',
};

const FINGER_WORDS: EnrolmentWords = {
  title: 'Your fingerings',
  noun: 'fingering',
  intro:
    "None yet. Type a note's name, press Learn, and hold its finger shape with both hands for two seconds when the countdown ends. Make each shape big and different: lift whole fingers.",
  placeholder: 'Note name, e.g. D5, G4, F#5',
  inputLabel: 'Note to learn',
  invalidHint: 'Not a note name: a letter, optional # or b, and an octave (D5, F#4, Bb4).',
  offHint: 'Turn the air flute on to learn fingerings (it watches both hands).',
  noShapeError: 'No hands were seen. Hold both hands in front of the camera, and check the air flute is on.',
};

const SEQUENCE_WORDS: SequenceTrainerWords = {
  title: 'Learn a sequence of notes',
  noun: 'note',
  placeholder: 'Or type notes: G4 A4 B4 C5 D5 (x2 repeats one)',
  offHint: 'Turn the air flute on to run a sequence (it watches both hands).',
};

const MOUTH_WORDS: EnrolmentWords = {
  title: 'Your breath',
  noun: 'mouth',
  intro: 'Learn how your mouth looks blowing into the flute, and at rest. The note sounds while you blow.',
  placeholder: '',
  inputLabel: 'Mouth state',
  invalidHint: '',
  offHint: 'Turn the air flute on to learn your breath (it watches your mouth).',
  noShapeError: 'No face was seen. Face the camera, and check the air flute is on.',
};

/** What the air flute is doing right now, from the engine loop's reporter. */
export function AirFluteReadout() {
  const live = useAirFluteStatus((s) => s.live);
  return (
    <div
      className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-2 text-xs"
      data-testid="air-flute-live"
      data-state={!live.enabled ? 'off' : live.knownFingers === 0 ? 'untaught' : live.sounding ? 'playing' : 'ready'}
    >
      <span className="text-white/80">{describeFluteLive(live)}</span>
    </div>
  );
}

/** The fingering guide for a note under the current prior dial, or null when the chart
 *  has no shape for it (a note outside the range, a label that is not a note). */
export function fluteGuide(prior: Partial<FingeringPriorSettings> | undefined, label: string, dim: boolean) {
  const options = priorOptionsFrom(prior);
  if (!options) return null;
  const shape = expectedFingering(options.chart, label, { range: options.range });
  if (!shape) return null;
  const canonical = parseNoteName(label)?.name ?? label;
  return <FingeringGuide label={label} down={shape.down} keys={shape.keys} alsoPlays={shape.notes.filter((n) => n !== canonical)} dim={dim} />;
}

/** A note-name field that dispatches on commit (blur / Enter), never mid-edit, and only a
 *  valid note: a half-typed "C" must not reach the dial (the model would be re-derived
 *  without the chart, and each keystroke would be an undo entry). The panels' precedent
 *  for text fields (`body.tsx`, `steering.tsx`). */
function CommitNote({ label, value, onCommit, disabled }: { label: string; value: string; onCommit: (v: string) => void; disabled: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const spec = parseNoteName(text);
    if (spec && spec.name !== value) onCommit(spec.name);
    setText(null);
  };
  const invalid = text !== null && text.trim() !== '' && parseNoteName(text) === null;
  return (
    <input
      className={`w-14 rounded bg-white/10 px-1 py-0.5 text-center font-mono text-xs outline-none ${invalid ? 'ring-1 ring-amber-300' : ''}`}
      aria-label={label}
      value={text ?? value}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** The fingering chart's dials: on/off, which chart, its weight, the note range. */
export function FluteChartControls({ prior, enabled }: { prior: Partial<FingeringPriorSettings> | undefined; enabled: boolean }) {
  const on = prior?.enabled ?? true;
  const chart = prior?.chart ?? 'flute';
  const strength = prior?.strength ?? 10;
  const low = prior?.low ?? 'C4';
  const high = prior?.high ?? 'C#6';
  const rangeOk = priorOptionsFrom({ ...prior, enabled: true }) !== null;
  return (
    <div className="space-y-1.5 rounded-lg border border-white/10 p-2" data-testid="flute-chart">
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={on} onChange={(e) => dispatchDialSetIn('airFlute.prior.enabled', e.target.checked)} />
        Use a fingering chart (the flute knows the notes before you teach it)
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Chart
        <select className={selectCls} value={chart} disabled={!on} onChange={(e) => dispatchDialSetIn('airFlute.prior.chart', e.target.value)}>
          {Object.values(FINGERING_CHARTS).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        <span title="How many of your own samples the chart is worth. A learned note keeps 40, so 10 is one part chart to four parts you.">
          Chart weight ({strength})
        </span>
        <input
          type="range"
          min={0}
          max={40}
          step={1}
          value={strength}
          disabled={!on}
          className="w-[45%]"
          aria-label="Chart weight"
          onChange={(e) => dispatchDialSetIn('airFlute.prior.strength', Number(e.target.value))}
        />
      </label>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span>Notes</span>
        <span className="flex items-center gap-1">
          <CommitNote label="Lowest note" value={low} disabled={!on} onCommit={(v) => dispatchDialSetIn('airFlute.prior.low', v)} />
          to
          <CommitNote label="Highest note" value={high} disabled={!on} onCommit={(v) => dispatchDialSetIn('airFlute.prior.high', v)} />
        </span>
      </div>
      {on && !rangeOk && <p className="text-[10px] text-amber-300">That range has no notes on this chart; the chart is not used until it does.</p>}
      {!enabled && on && <p className="text-[10px] text-white/50">The chart is fused into the fingerings the flute plays against once it is on.</p>}
    </div>
  );
}

export function AirFluteControls() {
  const { state } = useDialsSettings();
  const c = (state.effective.airFlute ?? {}) as Partial<AirFluteDialParams> & { prior?: Partial<FingeringPriorSettings> };
  const enabled = c.enabled === true;
  const breath = c.breath ?? 'mouth';
  const volume = c.volume ?? 0.5;
  const prior = c.prior;
  return (
    <div className="space-y-2">
      <AirFluteReadout />
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={enabled} onChange={(e) => dispatchDialSetIn('airFlute.enabled', e.target.checked)} />
        Play the air flute
      </label>
      <VocabularyEnrolment
        enabled={enabled}
        useVocabulary={useFluteFingerVocabulary}
        readShape={() => readShape(AIR_FLUTE_NODE_ID, 'shape')}
        canonical={(typed) => parseNoteName(typed)?.name ?? null}
        words={FINGER_WORDS}
      />
      <SequenceTrainer
        enabled={enabled}
        useVocabulary={useFluteFingerVocabulary}
        readShape={() => readShape(AIR_FLUTE_NODE_ID, 'shape')}
        canonical={(typed) => parseNoteName(typed)?.name ?? null}
        makeCheck={() => {
          const model = useControls.getState().airFluteFingerModel;
          return model ? (label, samples) => checkTake(model, label, samples) : undefined;
        }}
        guide={(label, dim) => fluteGuide(prior, label, dim)}
        starters={FLUTE_STARTER_SEQUENCES}
        words={SEQUENCE_WORDS}
        id={TRAINING_ANCHORS.fluteSequence}
      />
      <FluteChartControls prior={prior} enabled={enabled} />
      <label className="flex items-center justify-between gap-2 text-xs">
        Breath
        <select className={selectCls} value={breath} disabled={!enabled} onChange={(e) => dispatchDialSetIn('airFlute.breath', e.target.value)}>
          {BREATH_MODES.map((m) => (
            <option key={m} value={m}>
              {BREATH_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      {breath === 'mouth' && (
        <VocabularyEnrolment
          enabled={enabled}
          useVocabulary={useFluteMouthVocabulary}
          readShape={() => readShape(AIR_FLUTE_NODE_ID, 'mouth')}
          canonical={(typed) => ([MOUTH_BLOW, MOUTH_REST].includes(typed) ? typed : null)}
          words={MOUTH_WORDS}
          fixedLabels={[MOUTH_BLOW, MOUTH_REST]}
        />
      )}
      <label className="flex items-center justify-between gap-2 text-xs">
        <span>Flute volume ({Math.round(volume * 100)}%)</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          disabled={!enabled}
          className="w-[45%]"
          onChange={(e) => dispatchDialSetIn('airFlute.volume', Number(e.target.value))}
        />
      </label>
    </div>
  );
}
