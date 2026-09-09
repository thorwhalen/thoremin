/**
 * The steering editor (#141 / #188 PR 5) — what the gestures MEAN to the generative
 * engine: a list of strains (text prompts, each driven by one hand or face feature)
 * and of engine dials (density, brightness, bpm, …) bound the same way. The
 * `VibeEditor` of the frozen legacy app, rebuilt small on the command write path.
 *
 * Every control dispatches one of the scalar `steer.*` commands (`commands/steer.ts`)
 * through {@link dispatchCommand}; the panel never writes the dial itself. Text and
 * number fields commit on blur / Enter rather than on every keystroke: a strain
 * renamed per keystroke would ease in from rest nine times while you type "warm
 * pads", a weight typed as "0." would land as 0 halfway, and each keystroke would be
 * one undo entry. A refused commit (a duplicate name, an out-of-range weight) toasts
 * and the field reverts to the stored value, so the row never shows a value the
 * store does not hold.
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
          // A source change must carry a feature that fits it (one atomic command), or
          // the command refuses the mismatch.
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

/**
 * A field that commits on blur / Enter and reverts on Escape or on a refused commit.
 * `onCommit` resolves to whether the store accepted the value; a refusal (toasted by
 * the dispatcher) resets the draft so the row never displays a value the store does
 * not hold.
 */
function useCommitField<T extends string | number>(value: T, onCommit: (next: T) => Promise<boolean>, parse: (raw: string) => T | null) {
  const [draft, setDraft] = useState(String(value));
  const [editingFor, setEditingFor] = useState(value);
  // A commit that landed (or a config swap) resets the draft to the new stored value.
  if (editingFor !== value) {
    setEditingFor(value);
    setDraft(String(value));
  }
  const revert = () => setDraft(String(value));
  const commit = () => {
    const next = parse(draft);
    if (next === null || next === value) return revert();
    void onCommit(next).then((accepted) => {
      if (!accepted) revert();
    });
  };
  return {
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      if (e.key === 'Escape') revert();
    },
  };
}

const parseText = (raw: string): string | null => {
  const t = raw.trim();
  return t ? t : null;
};
const parseNumber = (raw: string): number | null => {
  const n = Number(raw.trim());
  return raw.trim() === '' || !Number.isFinite(n) ? null : n;
};

/** Dispatch one command and report whether it was accepted. */
const accepted = (id: string, params: Record<string, unknown>): Promise<boolean> => dispatchCommand(id, params).then((r) => r.ok);

function CommitText({ value, onCommit, ariaLabel }: { value: string; onCommit: (next: string) => Promise<boolean>; ariaLabel: string }) {
  const field = useCommitField(value, onCommit, parseText);
  return <input className="w-40 rounded bg-white/10 px-2 py-1 text-xs outline-none focus:bg-white/20" aria-label={ariaLabel} {...field} />;
}

function CommitNumber({ value, onCommit, ariaLabel, min, max, step }: { value: number; onCommit: (next: number) => Promise<boolean>; ariaLabel: string; min?: number; max?: number; step?: number }) {
  const field = useCommitField(value, onCommit, parseNumber);
  return <input type="number" min={min} max={max} step={step} className="w-16 rounded bg-white/10 px-1 py-0.5 text-xs" aria-label={ariaLabel} {...field} />;
}

function StrainRow({ strain }: { strain: SteerStrain }) {
  const t = strain.text;
  return (
    <li className="flex flex-wrap items-center gap-1 text-xs" data-strain={t}>
      <CommitText value={t} ariaLabel={`Strain text ${t}`} onCommit={(to) => accepted('steer.strain.rename', { text: t, to })} />
      <BindingControls binding={strain} onBind={(patch) => void dispatchCommand('steer.strain.bind', { text: t, ...patch })} />
      <label className="flex items-center gap-1 text-[10px] text-white/60">
        max
        <CommitNumber value={strain.weightMax} min={0} max={4} step={0.1} ariaLabel={`Weight max ${t}`} onCommit={(weightMax) => accepted('steer.strain.range', { text: t, weightMax })} />
      </label>
      <button type="button" className="rounded px-1 text-white/50 hover:text-white" aria-label={`Remove strain ${t}`} onClick={() => void dispatchCommand('steer.strain.remove', { text: t })}>
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
      <BindingControls binding={dial} onBind={(patch) => void dispatchCommand('steer.dial.set', { name: n, ...patch })} />
      <label className="flex items-center gap-1 text-[10px] text-white/60">
        <CommitNumber value={dial.outMin} step={0.05} ariaLabel={`Out min ${n}`} onCommit={(outMin) => accepted('steer.dial.set', { name: n, outMin })} />
        <span>→</span>
        <CommitNumber value={dial.outMax} step={0.05} ariaLabel={`Out max ${n}`} onCommit={(outMax) => accepted('steer.dial.set', { name: n, outMax })} />
      </label>
      <button type="button" className="rounded px-1 text-white/50 hover:text-white" aria-label={`Remove dial ${n}`} onClick={() => void dispatchCommand('steer.dial.remove', { name: n })}>
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
    void accepted('steer.strain.add', { text }).then((ok) => {
      if (ok) setNewText('');
    });
  };

  return (
    <div className="space-y-2" data-steering-editor>
      <p className="text-[10px] uppercase tracking-wider text-white/40">Strains — what your gestures blend in</p>
      <ul className="space-y-1">
        {cfg.strains.map((s, i) => (
          // Keyed by text AND position: the commands refuse creating a duplicate text, but
          // a hand-edited blob may hold one, and two rows must never share a React key.
          <StrainRow key={`${s.text}#${i}`} strain={s} />
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
              if (e.target.value) void dispatchCommand('steer.dial.set', { name: e.target.value });
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
