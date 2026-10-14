/**
 * Which parts of the loaded piece play (#471), inside the conductor section (so the
 * settings editor and the Conductor tool show the same list): one checkbox per part of the
 * piece, shown only when the piece has more than one. The selection is the single dial leaf
 * `conductor.parts` (comma-separated ids, empty = every part), written through
 * `dispatchDialSetIn`; the `score` node and the `orchestra` both read it from the conductor
 * dial, so the oscillators and the sampled orchestra always play the same parts.
 *
 * The last part left on cannot be switched off (a selection that leaves nothing would play
 * silence), and a selection naming no part of the loaded piece plays all of them
 * (`preparePiece`), so a piece switched under a kept selection never goes quiet.
 */
import { dispatchDialSetIn } from '../../dispatchDial';
import { useDialsSettings } from '../useDialsSettings';
import { useControls } from '../../store';
import { formatPartsSelection, parsePartsSelection } from '@thoremin/sdk/score/prepare';
import type { ConductorSettings } from '@/settings/schema';

export function PartsControls() {
  const { state } = useDialsSettings();
  const doc = useControls((s) => s.scoreDoc);
  const c = (state.effective.conductor ?? {}) as Partial<ConductorSettings>;
  const parts = doc?.parts ?? [];
  if (parts.length < 2) return null;

  const ids = parts.map((p) => p.id);
  const chosen = parsePartsSelection(c.parts).filter((id) => ids.includes(id));
  const on = new Set(chosen.length ? chosen : ids);

  const toggle = (id: string, checked: boolean) => {
    const next = new Set(on);
    if (checked) next.add(id);
    else next.delete(id);
    if (next.size === 0) return;
    // Everything on is the default, stored as the empty selection.
    const keep = ids.filter((x) => next.has(x));
    dispatchDialSetIn('conductor.parts', keep.length === ids.length ? '' : formatPartsSelection(keep));
  };

  return (
    <fieldset className="space-y-1 rounded-lg border border-white/10 p-2" data-testid="conductor-parts">
      <legend className="px-1 text-xs">Parts that play</legend>
      {parts.map((p) => (
        <label key={p.id} className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={on.has(p.id)}
            disabled={on.size === 1 && on.has(p.id)}
            data-testid={`conductor-part-${p.id}`}
            onChange={(e) => toggle(p.id, e.target.checked)}
          />
          <span>{p.name || p.id}</span>
          {p.percussion && <span className="text-white/40">(drums: the orchestra has no drum kit yet; with only drums selected the oscillator score plays them)</span>}
        </label>
      ))}
    </fieldset>
  );
}
