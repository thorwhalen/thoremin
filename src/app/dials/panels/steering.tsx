/**
 * The steering editor (#141 / #188 PR 5) — what the gestures MEAN to the generative
 * engine: a list of strains (text prompts, each driven by one hand or face feature)
 * and of engine dials (density, brightness, bpm, …) bound the same way. The
 * `VibeEditor` of the frozen legacy app, rebuilt small on the command write path.
 *
 * Every control dispatches one of the scalar `steer.*` commands (`commands/steer.ts`)
 * through {@link dispatchCommand}; the panel never writes the dial itself. The
 * strain's text is its identity (rename → `steer.strain.rename`), so a text field
 * commits on blur / Enter rather than on every keystroke — a strain renamed per
 * keystroke would ease in from rest nine times while you type "warm pads".
 *
 * Reads the effective `steerConfig` through the same healing the commands use, so the
 * list shown is exactly the list a command will edit.
 */
import { useState } from 'react';
import { dispatchCommand } from '../../dispatchDial';
import { currentSteerConfig } from '../../commands/steer';
import { useDialsSettings } from '../useDialsSettings';
import { selectCls } from '../primitives';
import {
  STEER_HANDS,
  STEER_HAND_FEATURES,
  STEER_FACE_FEATURES,
  STEER_DIAL_NAMES,
  type SteerStrain,
  type SteerDial,
} from '@/settings/schema';

type Binding = Pick<SteerStrain, 'source' | 'hand' | 'feature' | 'inMin' | 'inMax'>;

/** The feature options for a source, so a face strain never offers `openness`. */
const featuresFor = (source: Binding['source']) => (source === 'hand' ? STEER_HAND_FEATURES : STEER_FACE_FEATURES);

/** Source / hand / feature / direction selects, shared by strains and dials. `onBind`
 *  receives only the scalar fields that changed, matching the commands' optional args. */
function BindingControls({
  binding,
  onBind,
}: {
  binding: Binding;
  onBind: (patch: { source?: Binding['source']; hand?: Binding['hand']; feature?: Binding['feature']; invert?: boolean }) => void;
}) {
  const inverted = binding.inMin > binding.inMax;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <select
        className={selectCls}
        value={binding.source}
        aria-label="Source"
        onChange={(e) => {
          const source = e.target.value as Binding['source'];
          // A source change must carry a feature that fits it, or the command refuses.
          onBind({ source, feature: featuresFor(source)[0] });
        }}
      >
        <option value="hand">hand</option>
        <option value="face">face</option>
      </select>
      {binding.source === 'hand' && (
        <select className={selectCls} value={binding.hand} aria-label="Hand" onChange={(e) => onBind({ hand: e.target.value as Binding['hand'] })}>
          {STEER_HANDS.map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>
      )}
      <select className={selectCls} value={binding.feature} aria-label="Feature" onChange={(e) => onBind({ feature: e.target.value as Binding['feature'] })}>
        {featuresFor(binding.source).map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-[10px] text-white/60">
        <input type="checkbox" checked={inverted} onChange={(e) => onBind({ invert: e.target.checked })} />
        invert
      </label>
    </span>
  );
}

/** A text field that commits on blur / Enter (see the module header for why). */
function CommitText({ value, onCommit, ariaLabel }: { value: string; onCommit: (next: string) => void; ariaLabel: string }) {
  const [draft, setDraft] = useState(value);
  const [editingFor, setEditingFor] = useState(value);
  // A rename that landed (or a config swap) resets the draft to the new identity.
  if (editingFor !== value) {
    setEditingFor(value);
    setDraft(value);
  }
  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else setDraft(value);
  };
  return (
    <input
      className="w-40 rounded bg-white/10 px-2 py-1 text-xs outline-none focus:bg-white/20"
      value={draft}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}

function StrainRow({ strain }: { strain: SteerStrain }) {
  const t = strain.text;
  return (
    <li className="flex flex-wrap items-center gap-1 text-xs" data-strain={t}>
      <CommitText value={t} ariaLabel={`Strain text ${t}`} onCommit={(to) => dispatchCommand('steer.strain.rename', { text: t, to })} />
      <BindingControls binding={strain} onBind={(patch) => dispatchCommand('steer.strain.bind', { text: t, ...patch })} />
      <label className="flex items-center gap-1 text-[10px] text-white/60">
        max
        <input
          type="number" min={0} max={4} step={0.1} value={strain.weightMax}
          className="w-14 rounded bg-white/10 px-1 py-0.5 text-xs"
          aria-label={`Weight max ${t}`}
          onChange={(e) => dispatchCommand('steer.strain.range', { text: t, weightMax: Number(e.target.value) })}
        />
      </label>
      <button type="button" className="rounded px-1 text-white/50 hover:text-white" aria-label={`Remove strain ${t}`} onClick={() => dispatchCommand('steer.strain.remove', { text: t })}>
        ×
      </button>
    </li>
  );
}

function DialRow({ dial }: { dial: SteerDial }) {
  const n = dial.name;
  return (
    <li className="flex flex-wrap items-center gap-1 text-xs" data-dial={n}>
      <span className="w-20 text-white/80">{n}</span>
      <BindingControls binding={dial} onBind={(patch) => dispatchCommand('steer.dial.set', { name: n, ...patch })} />
      <label className="flex items-center gap-1 text-[10px] text-white/60">
        {dial.outMin}
        <span>→</span>
        <input
          type="number" step={0.05} value={dial.outMax}
          className="w-16 rounded bg-white/10 px-1 py-0.5 text-xs"
          aria-label={`Out max ${n}`}
          onChange={(e) => dispatchCommand('steer.dial.set', { name: n, outMax: Number(e.target.value) })}
        />
      </label>
      <button type="button" className="rounded px-1 text-white/50 hover:text-white" aria-label={`Remove dial ${n}`} onClick={() => dispatchCommand('steer.dial.remove', { name: n })}>
        ×
      </button>
    </li>
  );
}

export function SteeringEditor() {
  // Subscribe to the dials store so the list re-renders when a command lands.
  useDialsSettings();
  const cfg = currentSteerConfig();
  const [newText, setNewText] = useState('');
  const unboundDials = STEER_DIAL_NAMES.filter((n) => !cfg.dials.some((d) => d.name === n));
  const add = () => {
    const text = newText.trim();
    if (!text) return;
    dispatchCommand('steer.strain.add', { text });
    setNewText('');
  };

  return (
    <div className="space-y-2" data-steering-editor>
      <p className="text-[10px] uppercase tracking-wider text-white/40">Strains — what your gestures blend in</p>
      <ul className="space-y-1">
        {cfg.strains.map((s) => (
          <StrainRow key={s.text} strain={s} />
        ))}
      </ul>
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          className="w-40 rounded bg-white/10 px-2 py-1 text-xs outline-none focus:bg-white/20"
          placeholder="new strain, e.g. rain on glass"
          aria-label="New strain text"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
        />
        <button type="submit" className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20 disabled:opacity-40" disabled={!newText.trim()}>
          Add strain
        </button>
      </form>
      <p className="text-[10px] uppercase tracking-wider text-white/40">Engine dials — what your gestures turn</p>
      <ul className="space-y-1">
        {cfg.dials.map((d) => (
          <DialRow key={d.name} dial={d} />
        ))}
      </ul>
      {unboundDials.length > 0 && (
        <label className="flex items-center gap-2 text-xs">
          Drive
          <select
            className={selectCls}
            value=""
            aria-label="Add engine dial"
            onChange={(e) => {
              if (e.target.value) dispatchCommand('steer.dial.set', { name: e.target.value });
            }}
          >
            <option value="">an engine dial…</option>
            {unboundDials.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
