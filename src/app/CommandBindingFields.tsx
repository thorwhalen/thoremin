/**
 * CommandBindingFields — the command picker + fixed-args JSON field a hands-free trigger
 * is bound with. One component for every such trigger (the gestures, #129, and the
 * player's learned categories, #160), so the two pickers cannot drift: the same bindable
 * command list ({@link isGestureBindable}: never a confirmation-gated command), the same
 * "a half-typed JSON is a draft, not a write" rule, the same visible stale-binding warning.
 *
 * It owns no state beyond the args draft: the caller passes the binding and receives the
 * next one (or undefined for "unbound").
 */
import { useMemo, useState } from 'react';
import { registry } from './commands/registry';
// The extensions' commands join the registry (#600 S11).
import '@/app/host/contributions';
import { isGestureBindable } from './gestureDispatch';

/** A command id + fixed args: the gesture and the category bindings share this shape. */
export interface CommandBinding {
  command: string;
  args?: Record<string, unknown>;
}

/** The sentinel <option> value for "no binding" (never a real command id). */
const UNBOUND = '';

/** The pickable commands: everything registered except the confirmation-gated
 *  (destructive) ones, which a hands-free trigger could never approve. */
function bindableCommands() {
  return registry
    .list()
    .filter((c) => isGestureBindable(c.id))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export default function CommandBindingFields({
  label,
  binding,
  onChange,
}: {
  /** What is being bound, for the accessible names ("Command for Fist"). */
  label: string;
  binding: CommandBinding | undefined;
  onChange(next: CommandBinding | undefined): void;
}) {
  const commands = useMemo(bindableCommands, []);
  const known = !binding || registry.has(binding.command);
  // The args draft is local until it parses — a half-typed JSON must not clobber
  // the stored binding (or crash), and an invalid draft is shown, not saved.
  const [argsDraft, setArgsDraft] = useState<string | null>(null);
  const argsValue = argsDraft ?? (binding?.args ? JSON.stringify(binding.args) : '');
  const argsInvalid = argsDraft !== null;

  const onPick = (id: string) => {
    setArgsDraft(null);
    // Switching commands drops the old args (they belonged to the old command);
    // re-picking the same command keeps them.
    if (id === UNBOUND) onChange(undefined);
    else onChange({ command: id, args: binding?.command === id ? binding.args : undefined });
  };

  const onArgs = (text: string) => {
    if (!binding) return;
    const trimmed = text.trim();
    if (trimmed === '') {
      setArgsDraft(null);
      onChange({ command: binding.command, args: undefined });
      return;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setArgsDraft(null);
        onChange({ command: binding.command, args: parsed as Record<string, unknown> });
        return;
      }
    } catch {
      /* not (yet) valid JSON — keep it as a draft */
    }
    setArgsDraft(text);
  };

  return (
    <>
      <select
        aria-label={`Command for ${label}`}
        value={binding?.command ?? UNBOUND}
        onChange={(e) => onPick(e.target.value)}
        className="w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white/80"
      >
        <option value={UNBOUND}>(unbound)</option>
        {/* A stale binding whose command vanished from the registry stays VISIBLE
            (selected) so the player can see and fix it, rather than the select
            silently snapping to unbound while the store still holds the binding. */}
        {!known && binding && <option value={binding.command}>{binding.command} (unknown)</option>}
        {commands.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title} — {c.id}
          </option>
        ))}
      </select>
      {binding && (
        <input
          type="text"
          aria-label={`Arguments for ${label}`}
          value={argsValue}
          onChange={(e) => onArgs(e.target.value)}
          placeholder='Fixed args as JSON, e.g. {"value": 0}'
          spellCheck={false}
          className={`w-full rounded border bg-black/40 px-2 py-1 font-mono text-[10px] text-white/70 ${
            argsInvalid ? 'border-rose-400/60' : 'border-white/10'
          }`}
        />
      )}
      {argsInvalid && <p className="text-[10px] text-rose-300/80">Not valid JSON — the last valid args are kept.</p>}
      {!known && binding && (
        <p className="text-[10px] text-rose-300/80">
          Unknown command &ldquo;{binding.command}&rdquo; — it no longer exists; pick another.
        </p>
      )}
    </>
  );
}
