/**
 * The two controls every row of the sorting grid carries, a held category's (`./Sorting.tsx`) and
 * a moving gesture's (`./GesturesSection.tsx`) alike (#954): its name, renamed in place, and a
 * select that merges it into another row (with any further actions the row offers, such as a
 * category's split).
 *
 * One component each, so the two rows rename and merge the same way: Enter or leaving the field
 * commits, Escape reverts, a refused rename (the store says no) puts the name back; the select
 * always shows its placeholder and runs the picked action.
 *
 * Rendering only: what a rename or a merge does is the caller's (the session store's).
 */
import { useState } from 'react';

const nameClass = 'min-w-0 flex-1 rounded bg-white/10 px-2 py-0.5 text-xs font-semibold text-white outline-none focus:bg-white/20';

/** A name renamed in place. `onRename` gets the edited text when it differs from `value`;
 *  returning `false` refuses it and restores `value`. */
export function NameInput({ value, label, onRename }: { value: string; label: string; onRename: (text: string) => boolean | void }) {
  const [text, setText] = useState(value);
  const [last, setLast] = useState(value);
  // A rename from elsewhere (undo, a merge) replaces the text being shown.
  if (last !== value) {
    setLast(value);
    setText(value);
  }
  const commit = () => {
    if (text.trim() && text.trim() !== value) {
      if (onRename(text) === false) setText(value);
    } else setText(value);
  };
  return (
    <input
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setText(value);
      }}
      className={nameClass}
    />
  );
}

/** A row's action in the select: a merge target, or another verb (a category's split). */
export interface RowAction {
  /** Unique among the select's actions. */
  id: string;
  text: string;
  disabled?: boolean;
  run: () => void;
}

/** The merge actions into each of `targets` (`text` words each option). */
export function mergeActions(
  targets: readonly { id: string; label: string }[],
  merge: (into: string) => void,
  text: (target: { id: string; label: string }) => string = (t) => t.label,
): RowAction[] {
  return targets.map((t) => ({ id: `merge:${t.id}`, text: text(t), run: () => merge(t.id) }));
}

/** A select that shows `placeholder` and runs the action picked. */
export function MergeSelect({ label, placeholder, actions, className }: { label: string; placeholder: string; actions: readonly RowAction[]; className: string }) {
  return (
    <select
      aria-label={label}
      value=""
      onChange={(e) => actions.find((a) => a.id === e.target.value)?.run()}
      className={className}
    >
      <option value="">{placeholder}</option>
      {actions.map((a) => (
        <option key={a.id} value={a.id} disabled={a.disabled}>
          {a.text}
        </option>
      ))}
    </select>
  );
}
