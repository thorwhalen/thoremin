/**
 * The AIR GUITAR section of the settings panel (#249): the enrolment step, then the
 * instrument's dials.
 *
 * The enrolment is the part a player cannot skip. A chord is not a hand shape (players
 * finger it differently, `docs/research/air-instruments.md` §6.4), so the guitar knows
 * only the chords THIS player has shown it: type a chord's name, press Learn, make the
 * shape with the chord hand when the countdown ends and hold it for two seconds. The
 * samples come from the `air-guitar` node's own live shape output (`readAirShape`), so
 * what is learned is exactly what is played against. Each chord is saved to the
 * vocabulary collection (`src/app/air/vocabularyStore.ts`) and the classifier is
 * re-trained at once.
 *
 * The dials write leaves of the structured `airGuitar` dial through `dispatchDialSetIn`
 * (the single write path). The vocabulary is not a dial: it is the player's hands, kept
 * per browser.
 */
import { useEffect, useRef, useState } from 'react';
import { dispatchDialSetIn } from '../../dispatchDial';
import { useDialsSettings } from '../useDialsSettings';
import { selectCls } from '../primitives';
import { describeGuitarLive, readAirShape, useAirGuitarStatus } from '../../airGuitarStatus';
import { useGuitarVocabulary } from '../../air/vocabularyStore';
import { MIN_SAMPLES_PER_ENTRY } from '@/air/vocabulary';
import { parseChordName } from '@/music/guitar';
import { PLAYER_HANDS } from '@/nodes/music/air_bass';
import { STRUM_POINTS, type AirGuitarDialParams } from '@/nodes/music/air_guitar';
import type { FeatureVector } from '@/enroll';

/** Seconds of countdown before a chord is captured: time to make the shape. */
export const ENROL_COUNTDOWN_S = 3;
/** Seconds a chord shape is held and captured (the research's two seconds per chord). */
export const ENROL_CAPTURE_S = 2;
/** How often the capture polls the live shape, ms (faster than the camera: each new
 *  frame is taken once). */
const POLL_MS = 30;

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

type Phase = { kind: 'idle' } | { kind: 'countdown'; label: string; left: number } | { kind: 'capture'; label: string; got: number };

/** Name a chord, hold its shape, and the guitar learns it. */
export function ChordEnrolment({ enabled }: { enabled: boolean }) {
  const { vocab, enrol, remove } = useGuitarVocabulary();
  const [name, setName] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);
  const clear = () => {
    for (const t of timers.current) clearInterval(t);
    timers.current = [];
  };
  useEffect(() => clear, []);

  const parsed = name.trim() ? parseChordName(name) : null;
  const busy = phase.kind !== 'idle';

  const learn = (label: string) => {
    setError(null);
    clear();
    let left = ENROL_COUNTDOWN_S;
    setPhase({ kind: 'countdown', label, left });
    const countdown = setInterval(() => {
      left -= 1;
      if (left > 0) return setPhase({ kind: 'countdown', label, left });
      clearInterval(countdown);
      const samples: FeatureVector[] = [];
      let last: FeatureVector | null = null;
      const started = Date.now();
      setPhase({ kind: 'capture', label, got: 0 });
      const poll = setInterval(() => {
        const v = readAirShape();
        if (v && v !== last) {
          samples.push(v);
          last = v;
          setPhase({ kind: 'capture', label, got: samples.length });
        }
        if (Date.now() - started < ENROL_CAPTURE_S * 1000) return;
        clear();
        setPhase({ kind: 'idle' });
        if (samples.length < MIN_SAMPLES_PER_ENTRY) {
          setError('No chord hand was seen. Keep it in front of the camera, and check the air guitar is on.');
          return;
        }
        void enrol(label, samples);
        setName('');
      }, POLL_MS);
      timers.current.push(poll);
    }, 1000);
    timers.current.push(countdown);
  };

  return (
    <div className="space-y-2 rounded-lg border border-white/10 p-2" data-testid="chord-enrolment">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Your chords</div>
      {vocab.entries.length === 0 ? (
        <p className="text-[10px] leading-relaxed text-white/50">
          None yet. The guitar plays the chords you teach it: type a chord's name, press Learn, and
          hold its shape with your chord hand for two seconds when the countdown ends.
        </p>
      ) : (
        <ul className="space-y-1">
          {vocab.entries.map((e) => (
            <li key={e.label} className="flex items-center justify-between gap-2 text-xs">
              <span>
                <span className="font-mono text-emerald-300">{e.label}</span>
                <span className="ml-2 text-[10px] text-white/40">{e.samples.length} samples</span>
                {!parseChordName(e.label) && <span className="ml-2 text-[10px] text-amber-300">not a chord name</span>}
              </span>
              <span className="flex gap-1">
                <button
                  className="rounded bg-white/10 px-2 py-0.5 text-[10px] hover:bg-white/20 disabled:opacity-40"
                  disabled={busy || !enabled}
                  onClick={() => learn(e.label)}
                  aria-label={`Re-learn ${e.label}`}
                >
                  Re-learn
                </button>
                <button
                  className="rounded bg-white/10 px-2 py-0.5 text-[10px] hover:bg-white/20 disabled:opacity-40"
                  disabled={busy}
                  onClick={() => void remove(e.label)}
                  aria-label={`Forget ${e.label}`}
                >
                  Forget
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-1">
        <input
          className="min-w-0 flex-1 rounded bg-white/10 px-2 py-1 text-xs outline-none placeholder:text-white/30 focus:bg-white/20"
          placeholder="Chord name, e.g. G, Em, C7"
          aria-label="Chord to learn"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && parsed && enabled && !busy) learn(parsed.name);
          }}
        />
        <button
          className="rounded bg-emerald-500 px-2 py-1 text-xs font-semibold text-black transition hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/40"
          disabled={!parsed || !enabled || busy}
          onClick={() => parsed && learn(parsed.name)}
        >
          Learn
        </button>
      </div>
      {name.trim() && !parsed && <p className="text-[10px] text-amber-300">Not a chord name it can play: try G, Em, C7, Dsus4, F#m.</p>}
      {!enabled && <p className="text-[10px] text-white/50">Turn the air guitar on to learn chords (it watches your chord hand).</p>}
      {phase.kind === 'countdown' && (
        <p className="text-sm font-semibold text-amber-200" role="status">
          Make your {phase.label} shape… {phase.left}
        </p>
      )}
      {phase.kind === 'capture' && (
        <p className="text-sm font-semibold text-emerald-300" role="status">
          Hold {phase.label}… ({phase.got} samples)
        </p>
      )}
      {error && <p className="text-[10px] text-rose-300">{error}</p>}
    </div>
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
