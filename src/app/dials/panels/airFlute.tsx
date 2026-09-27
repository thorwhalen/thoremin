/**
 * The AIR FLUTE section of the settings panel (#249): two enrolment steps, then the dials.
 *
 * - **Your fingerings.** Name a note ("D5"), press Learn, and hold its finger shape with
 *   both hands. A real key press is under the hand tracker's noise (the research's air
 *   flute finding, `docs/research/air-instruments.md` §7.2), so the shapes should be
 *   LARGE, deliberate lifts: this is an air flute, there is no tube in the way.
 * - **Your breath.** Learn your blowing mouth and your resting mouth. The mouth arms the
 *   note rather than timing it (§7.2.1, #248), so it is a gate: the note sounds while the
 *   mouth reads as blowing. Set Breath to "fingers only" to skip it (then a held
 *   fingering plays).
 *
 * Both are the shared {@link VocabularyEnrolment}, capturing from the `air-flute` node's
 * own `shape` and `mouth` outputs. The dials write leaves of the `airFlute` dial through
 * `dispatchDialSetIn` (the single write path).
 */
import { dispatchDialSetIn } from '../../dispatchDial';
import { useDialsSettings } from '../useDialsSettings';
import { selectCls } from '../primitives';
import { AIR_FLUTE_NODE_ID, describeFluteLive, useAirFluteStatus } from '../../airFluteStatus';
import { readShape } from '../../air/shapeTap';
import { useFluteFingerVocabulary, useFluteMouthVocabulary } from '../../air/vocabularyStore';
import { VocabularyEnrolment, type EnrolmentWords } from '../../air/VocabularyEnrolment';
import { parseNoteName } from '@/music/notes';
import { BREATH_MODES, MOUTH_BLOW, MOUTH_REST, type AirFluteDialParams } from '@/nodes/music/air_flute';

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

export function AirFluteControls() {
  const { state } = useDialsSettings();
  const c = (state.effective.airFlute ?? {}) as Partial<AirFluteDialParams>;
  const enabled = c.enabled === true;
  const breath = c.breath ?? 'mouth';
  const volume = c.volume ?? 0.5;
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
