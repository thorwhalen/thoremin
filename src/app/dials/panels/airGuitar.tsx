/**
 * The AIR GUITAR section of the settings panel (#249): the enrolment step, then the
 * instrument's dials.
 *
 * The enrolment is the part a player cannot skip. A chord is not a hand shape (players
 * finger it differently, `docs/research/air-instruments.md` §6.4), so the guitar knows
 * only the chords THIS player has shown it: type a chord's name, press Learn, make the
 * shape with the chord hand when the countdown ends and hold it for two seconds (the
 * shared {@link VocabularyEnrolment}). The samples come from the `air-guitar` node's own
 * live shape output (`air/shapeTap.ts`), so what is learned is exactly what is played
 * against. Each chord is saved to the vocabulary collection
 * (`src/app/air/vocabularyStore.ts`) and the classifier is re-trained at once.
 *
 * The dials write leaves of the structured `airGuitar` dial through `dispatchDialSetIn`
 * (the single write path). The vocabulary is not a dial: it is the player's hands, kept
 * per browser.
 */
import { dispatchDialSetIn } from '../../dispatchDial';
import { useDialsSettings } from '../useDialsSettings';
import { selectCls } from '../primitives';
import { AIR_GUITAR_NODE_ID, describeGuitarLive, useAirGuitarStatus } from '../../airGuitarStatus';
import { readShape } from '../../air/shapeTap';
import { VocabularyEnrolment, type EnrolmentWords } from '../../air/VocabularyEnrolment';
import { useGuitarVocabulary } from '../../air/vocabularyStore';
import { parseChordName } from '@/music/guitar';
import { PLAYER_HANDS } from '@/nodes/music/air_bass';
import { STRUM_POINTS, type AirGuitarDialParams } from '@/nodes/music/air_guitar';

const HAND_LABEL: Record<AirGuitarDialParams['strumHand'], string> = {
  right: 'right hand strums',
  left: 'left hand strums',
};
const POINT_LABEL: Record<AirGuitarDialParams['strumPoint'], string> = {
  wrist: 'wrist (whole hand)',
  indexTip: 'index fingertip (a pick)',
};

/** What the air guitar is doing right now, from the engine loop's reporter. */
export function AirGuitarReadout() {
  const live = useAirGuitarStatus((s) => s.live);
  const share = live.strums > 0 ? Math.round((100 * live.predicted) / live.strums) : 0;
  return (
    <div
      className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-2 text-xs"
      data-testid="air-guitar-live"
      data-state={!live.enabled ? 'off' : live.known === 0 ? 'untaught' : live.strums > 0 ? 'playing' : 'ready'}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-white/80">{describeGuitarLive(live)}</span>
        {live.enabled && live.strums > 0 && (
          <span className="shrink-0 font-mono text-emerald-300" title="strums, and the share predicted ahead of the strum">
            {live.strums} · {share}%
          </span>
        )}
      </div>
    </div>
  );
}

const CHORD_WORDS: EnrolmentWords = {
  title: 'Your chords',
  noun: 'shape',
  intro:
    "None yet. The guitar plays the chords you teach it: type a chord's name, press Learn, and hold its shape with your chord hand for two seconds when the countdown ends.",
  placeholder: 'Chord name, e.g. G, Em, C7',
  inputLabel: 'Chord to learn',
  invalidHint: 'Not a chord name it can play: try G, Em, C7, Dsus4, F#m.',
  offHint: 'Turn the air guitar on to learn chords (it watches your chord hand).',
  noShapeError: 'No chord hand was seen. Keep it in front of the camera, and check the air guitar is on.',
};

/** Name a chord, hold its shape, and the guitar learns it. */
export function ChordEnrolment({ enabled }: { enabled: boolean }) {
  return (
    <VocabularyEnrolment
      enabled={enabled}
      useVocabulary={useGuitarVocabulary}
      readShape={() => readShape(AIR_GUITAR_NODE_ID)}
      canonical={(typed) => parseChordName(typed)?.name ?? null}
      words={CHORD_WORDS}
    />
  );
}

export function AirGuitarControls() {
  const { state } = useDialsSettings();
  const c = (state.effective.airGuitar ?? {}) as Partial<AirGuitarDialParams>;
  const enabled = c.enabled === true;
  const strumHand = c.strumHand ?? 'right';
  const strumPoint = c.strumPoint ?? 'wrist';
  const volume = c.volume ?? 0.7;
  return (
    <div className="space-y-2">
      <AirGuitarReadout />
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={enabled} onChange={(e) => dispatchDialSetIn('airGuitar.enabled', e.target.checked)} />
        Play the air guitar
      </label>
      <ChordEnrolment enabled={enabled} />
      <p className="text-[10px] leading-relaxed text-white/50">
        Hold one of your chord shapes with one hand and strum down with the other: the strum is
        heard at the moment it lands, predicted before the camera sees it.
      </p>
      <label className="flex items-center justify-between gap-2 text-xs">
        Strumming hand
        <select className={selectCls} value={strumHand} disabled={!enabled} onChange={(e) => dispatchDialSetIn('airGuitar.strumHand', e.target.value)}>
          {PLAYER_HANDS.map((h) => (
            <option key={h} value={h}>
              {HAND_LABEL[h]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Strum point
        <select className={selectCls} value={strumPoint} disabled={!enabled} onChange={(e) => dispatchDialSetIn('airGuitar.strumPoint', e.target.value)}>
          {STRUM_POINTS.map((pt) => (
            <option key={pt} value={pt}>
              {POINT_LABEL[pt]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        <span>Guitar volume ({Math.round(volume * 100)}%)</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          disabled={!enabled}
          className="w-[45%]"
          onChange={(e) => dispatchDialSetIn('airGuitar.volume', Number(e.target.value))}
        />
      </label>
    </div>
  );
}
