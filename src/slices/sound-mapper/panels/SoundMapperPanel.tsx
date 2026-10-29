/**
 * The Sound mapper tool's panel: the player's sounds (a name, the drum it plays, how many taps
 * taught it, Teach), Play, what was just heard and how fast, and the few settings that trade
 * speed for sureness. It only renders and calls the store (`../app/store.ts`).
 */
import { useEffect } from 'react';
import { KIT_LABELS, KIT_SOUNDS, type KitSound } from '@thoremin/sdk/audio/kit';
import type { HubStatus } from '@thoremin/sdk-ui/audio/hub';
import { useSoundMapper, type Hit } from '../app/store';
import { SOUND_MAPPER_LIMITS, type SoundClass } from '../schema';

/** The hub's state in the player's words (null: nothing to say). */
export function describeInput(status: HubStatus | null): string | null {
  switch (status?.state) {
    case 'waiting-audio':
      return 'Tap anywhere on the page to start the sound first.';
    case 'opening':
      return 'Opening the microphone...';
    case 'denied':
      return 'The microphone was refused. Allow it in the browser (the icon in the address bar), then try again.';
    case 'unsupported':
      return 'This browser cannot listen to a microphone here.';
    case 'failed':
      return `The microphone could not start: ${status.error ?? 'unknown error'}`;
    case 'live':
      return status.source === 'microphone' ? `Listening${status.device ? ` (${status.device})` : ''}.` : `Listening to the ${status.source} sound.`;
    default:
      return null;
  }
}

const btn = 'rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40';

function ClassRow({ c, teaching, lit }: { c: SoundClass; teaching: boolean; lit: boolean }) {
  const s = useSoundMapper.getState();
  return (
    <div className={`space-y-1.5 rounded-lg border p-2 transition-colors duration-75 ${lit ? 'border-emerald-400 bg-emerald-400/15' : teaching ? 'border-amber-400/70 bg-amber-400/10' : 'border-white/10 bg-white/5'}`} data-testid="sound-class" data-class={c.id}>
      <div className="flex items-center gap-2">
        <input
          aria-label="Sound name"
          className="min-w-0 flex-1 rounded bg-black/30 px-2 py-1 text-xs text-white"
          defaultValue={c.label}
          onBlur={(e) => s.renameClass(c.id, e.target.value)}
        />
        <select aria-label={`Drum for ${c.label}`} className="rounded bg-black/30 px-1 py-1 text-xs text-white" value={c.sound} onChange={(e) => s.setSound(c.id, e.target.value as KitSound)}>
          {KIT_SOUNDS.map((k) => (
            <option key={k} value={k}>
              {KIT_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-white/60">
        <span data-testid="sound-class-count">
          {c.examples.length} {c.examples.length === 1 ? 'tap' : 'taps'}
        </span>
        <button type="button" className={`${btn} ml-auto ${teaching ? 'bg-amber-400 text-black' : 'bg-white/10 text-white hover:bg-white/20'}`} onClick={() => s.teach(teaching ? null : c.id)}>
          {teaching ? 'Done' : c.examples.length ? 'Teach more' : 'Teach'}
        </button>
        <button type="button" className={`${btn} bg-white/5 text-white/70 hover:bg-white/15`} disabled={c.examples.length === 0} onClick={() => s.clearClass(c.id)}>
          Clear
        </button>
        <button type="button" aria-label={`Remove ${c.label}`} className={`${btn} bg-white/5 text-white/70 hover:bg-white/15`} onClick={() => s.removeClass(c.id)}>
          Remove
        </button>
      </div>
      {teaching && <p className="text-[11px] text-amber-200">Tap it now, the way you will play it: 6 to 10 taps, soft and hard, a moment apart. Press Done when you have.</p>}
    </div>
  );
}

function HitReadout({ hit, label }: { hit: Hit | undefined; label: (id: string | null) => string }) {
  if (!hit) return <div className="rounded-lg border border-white/10 p-2 text-xs text-white/40">Nothing heard yet.</div>;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-2 text-xs" data-testid="sound-hit" data-class={hit.classId ?? ''}>
      <span className="font-semibold text-white/90">{label(hit.classId)}</span>
      {hit.revised && <span className="text-amber-300/80">corrected</span>}
      <span className="font-mono text-white/50">{Math.round(hit.confidence * 100)}%</span>
      <span className="ml-auto font-mono text-emerald-300" title="From the tap to the drum, inside the app (the microphone and speaker add their own)">
        {hit.latencyMs.toFixed(1)} ms
      </span>
    </div>
  );
}

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-white/80">
      <span>
        {label} <span className="font-mono text-white/50">{unit === '%' ? `${Math.round(value * 100)}%` : `${value} ${unit}`}</span>
      </span>
      <input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-32" />
    </label>
  );
}

export default function SoundMapperPanel() {
  const map = useSoundMapper((s) => s.map);
  const playing = useSoundMapper((s) => s.playing);
  const teaching = useSoundMapper((s) => s.teaching);
  const hits = useSoundMapper((s) => s.hits);
  const status = useSoundMapper((s) => s.status);
  const error = useSoundMapper((s) => s.error);
  const s = useSoundMapper.getState();
  useEffect(() => {
    void useSoundMapper.getState().hydrate();
  }, []);
  const taught = map.classes.some((c) => c.examples.length > 0);
  const label = (id: string | null) => (id === null ? 'Not one of yours' : (map.classes.find((c) => c.id === id)?.label ?? 'Removed sound'));
  const last = hits[0];
  const input = describeInput(status);
  return (
    <div className="space-y-3" data-testid="sound-mapper-panel">
      <p className="text-[11px] text-white/60">Add a sound, press Teach and tap it a few times. Give it a drum. Then press Play: every tap plays its drum. Headphones keep the drums out of the microphone.</p>
      <div className="space-y-2">
        {map.classes.map((c) => (
          <ClassRow key={c.id} c={c} teaching={teaching === c.id} lit={playing && last?.classId === c.id} />
        ))}
        <button type="button" className={`${btn} w-full bg-white/10 text-white hover:bg-white/20`} disabled={map.classes.length >= SOUND_MAPPER_LIMITS.classes} onClick={() => s.addClass()}>
          Add a sound
        </button>
      </div>
      <button
        type="button"
        className={`w-full rounded-lg px-3 py-2 text-sm font-semibold transition disabled:opacity-40 ${playing ? 'bg-emerald-500 text-black' : 'bg-white/10 text-white hover:bg-white/20'}`}
        disabled={!taught && !playing}
        onClick={() => s.play(!playing)}
      >
        {playing ? 'Stop' : 'Play'}
      </button>
      {input && (playing || teaching) && <p className="text-[11px] text-white/60" data-testid="sound-input">{input}</p>}
      {error && <p className="text-[11px] text-amber-300/90">{error}</p>}
      {playing && <HitReadout hit={last} label={label} />}
      <details className="rounded-lg border border-white/10 p-2">
        <summary className="cursor-pointer text-xs text-white/70">Speed and feel</summary>
        <div className="mt-2 space-y-2">
          <Slider label="Listen before playing" value={map.windowMs} min={SOUND_MAPPER_LIMITS.windowMs[0]} max={SOUND_MAPPER_LIMITS.windowMs[1]} step={1} unit="ms" onChange={(v) => s.setParams({ windowMs: v })} />
          <Slider label="Then check for" value={map.refineMs} min={SOUND_MAPPER_LIMITS.refineMs[0]} max={SOUND_MAPPER_LIMITS.refineMs[1]} step={1} unit="ms" onChange={(v) => s.setParams({ refineMs: v })} />
          <Slider label="Harder tap, louder drum" value={map.velocity} min={0} max={1} step={0.05} unit="%" onChange={(v) => s.setParams({ velocity: v })} />
          <Slider label="Drum volume" value={map.gain} min={0} max={1.5} step={0.05} unit="%" onChange={(v) => s.setParams({ gain: v })} />
          <p className="text-[11px] text-white/50">The drum starts after the first window; a longer one is surer but later. If the second window hears a different sound, the drum is swapped (set it to 0 to never swap).</p>
        </div>
      </details>
    </div>
  );
}
