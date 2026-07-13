/**
 * LabControls — the Feature Instrumentation Lab's controls (#119), rendered inside
 * {@link LabPanel}: the meters on/off, which feature GROUPS are measured + shown, the
 * online-normalizer mode + grid columns, a stats reset, the safe DERIVED-feature editor
 * (live-validated against the same jsep whitelist compiler the engine uses), and
 * SAVE/LOAD of named lab views (a zodal collection, the project persistence rule — its
 * own store, out of the control-store version).
 *
 * Every edit writes the per-device `featureLab` config on the hot control store, which
 * `store-controls` composes into the overlay node's params each tick — so meters respond
 * live. It deliberately does NOT write a dial (#136): the Lab measures the instrument
 * rather than being part of it, so a meter toggle must not mark an instrument as having
 * unsaved edits, and loading an instrument must not silently reconfigure the meters.
 * Loading a saved view hydrates that config; nothing here is ever awaited in the tick loop.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FEATURE_GROUPS, ALL_SAFE_NAMES } from '@/features/catalog';
import { compileFormula, DEFAULT_HELPERS } from '@/features/formula';
import { useControls } from './store';
import type { FeatureLabConfig } from '@/features/labConfig';
import { createLabViewStore } from './lab/labViews';
import type { LabViewConfig, LabViewSummary } from './lab/schema';

const selectCls = 'rounded bg-white/10 px-2 py-1 text-xs outline-none focus:bg-white/20';
const btnCls = 'rounded bg-white/10 px-2 py-0.5 text-[10px] text-white/80 hover:bg-white/20';

type FeatureLab = FeatureLabConfig;

/** Validate a formula the same way the engine compiles it; return an error string
 *  or null. Pure (no side effects), so it's safe to run on every keystroke. */
function formulaError(formula: string): string | null {
  if (!formula.trim()) return 'Empty formula';
  try {
    compileFormula(formula, { variables: ALL_SAFE_NAMES });
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export default function LabControls() {
  const fl = useControls((s) => s.featureLab);
  const patch = useControls((s) => s.setFeatureLab);

  const toggleGroup = (id: string, on: boolean) =>
    patch({ groups: on ? [...new Set([...fl.groups, id])] : fl.groups.filter((g) => g !== id) });

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={fl.show} onChange={(e) => patch({ show: e.target.checked })} />
        Show the meters over the video
      </label>

      <div className={fl.show ? 'space-y-3' : 'space-y-3 opacity-40'}>
        {/* Normalizer mode + layout */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs">
            Level
            <select className={selectCls} value={fl.normalizer} onChange={(e) => patch({ normalizer: e.target.value as FeatureLab['normalizer'] })}>
              <option value="minmax">Min/max envelope</option>
              <option value="quantile">Quantile (robust)</option>
              <option value="zscore">Z-score</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs">
            Columns
            <input type="range" min={1} max={8} step={1} value={fl.columns} onChange={(e) => patch({ columns: Number(e.target.value) })} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={fl.showMarkers} onChange={(e) => patch({ showMarkers: e.target.checked })} />
            Percentile ticks
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={fl.showValues} onChange={(e) => patch({ showValues: e.target.checked })} />
            Raw values
          </label>
          <button type="button" className={btnCls} onClick={() => patch({ resetNonce: (fl.resetNonce ?? 0) + 1 })} title="Re-zero the accumulated statistics">
            Reset stats
          </button>
        </div>

        <GroupPicker groups={fl.groups} onToggle={toggleGroup} />
        <DerivedEditor derived={fl.derived} onChange={(derived) => patch({ derived })} />
        <SavedViews config={fl} onLoad={(cfg) => patch(cfg)} />
      </div>
    </div>
  );
}

/** Group visibility checkboxes, split by source (face / hand / derived). */
function GroupPicker({ groups, onToggle }: { groups: string[]; onToggle: (id: string, on: boolean) => void }) {
  const enabled = new Set(groups);
  const faceGroups = FEATURE_GROUPS.filter((g) => g.source === 'face' && g.id !== 'derived');
  const handGroups = FEATURE_GROUPS.filter((g) => g.source === 'hand');
  const derivedGroup = FEATURE_GROUPS.find((g) => g.id === 'derived');
  const Row = ({ id, label }: { id: string; label: string }) => (
    <label className="flex items-center gap-2 text-[11px]">
      <input type="checkbox" checked={enabled.has(id)} onChange={(e) => onToggle(id, e.target.checked)} />
      {label}
    </label>
  );
  return (
    <details open className="border-t border-white/10 pt-2">
      <summary className="cursor-pointer select-none text-[10px] font-bold uppercase tracking-widest text-white/60">Groups</summary>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
        <div className="space-y-1">
          <p className="text-[9px] uppercase tracking-widest text-cyan-300/70">Face</p>
          {faceGroups.map((g) => <Row key={g.id} id={g.id} label={g.label} />)}
        </div>
        <div className="space-y-1">
          <p className="text-[9px] uppercase tracking-widest text-emerald-300/70">Hand</p>
          {handGroups.map((g) => <Row key={g.id} id={g.id} label={g.label} />)}
          {derivedGroup && <Row id={derivedGroup.id} label={derivedGroup.label} />}
        </div>
      </div>
    </details>
  );
}

/** Add / edit / remove derived features, live-validated with the safe compiler. */
function DerivedEditor({ derived, onChange }: { derived: { id: string; formula: string }[]; onChange: (d: { id: string; formula: string }[]) => void }) {
  const [id, setId] = useState('');
  const [formula, setFormula] = useState('');
  const err = formula ? formulaError(formula) : null;
  const idTaken = derived.some((d) => d.id === id.trim());
  const canAdd = id.trim().length > 0 && !idTaken && formula.trim().length > 0 && !err;

  const add = () => {
    if (!canAdd) return;
    onChange([...derived, { id: id.trim(), formula: formula.trim() }]);
    setId('');
    setFormula('');
  };
  const remove = (rid: string) => onChange(derived.filter((d) => d.id !== rid));

  const helperList = useMemo(() => Object.keys(DEFAULT_HELPERS).join(', '), []);

  return (
    <details className="border-t border-white/10 pt-2">
      <summary className="cursor-pointer select-none text-[10px] font-bold uppercase tracking-widest text-white/60">Derived features (formula)</summary>
      <div className="mt-2 space-y-2">
        <p className="text-[10px] leading-relaxed text-white/40">
          Combine features with a safe formula. Reference a feature by its name with dots as underscores
          (e.g. <span className="font-mono text-white/60">face_geom_mouth_openness</span>). Helpers: <span className="font-mono">{helperList}</span>.
        </p>
        {derived.map((d) => (
          <div key={d.id} className="flex items-center gap-2 text-[11px]">
            <span className="w-20 shrink-0 truncate font-mono text-amber-200/90" title={d.id}>{d.id}</span>
            <span className="flex-1 truncate font-mono text-white/50" title={d.formula}>{d.formula}</span>
            <button type="button" className={btnCls} onClick={() => remove(d.id)}>✕</button>
          </div>
        ))}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <input className={`${selectCls} w-24`} placeholder="id" value={id} onChange={(e) => setId(e.target.value)} />
            <input className={`${selectCls} flex-1 font-mono`} placeholder="formula, e.g. clamp(face_geom_mouth_openness * 2, 0, 1)" value={formula} onChange={(e) => setFormula(e.target.value)} />
            <button type="button" className={`${btnCls} ${canAdd ? '' : 'opacity-40'}`} disabled={!canAdd} onClick={add}>Add</button>
          </div>
          {idTaken && <p className="text-[10px] text-amber-300/80">That id already exists.</p>}
          {formula && err && <p className="text-[10px] text-rose-300/90">{err}</p>}
          {formula && !err && <p className="text-[10px] text-emerald-300/80">✓ valid</p>}
        </div>
      </div>
    </details>
  );
}

/** Save / load / delete named lab views (a zodal localStorage collection). */
function SavedViews({ config, onLoad }: { config: FeatureLab; onLoad: (cfg: Partial<FeatureLab>) => void }) {
  const storeRef = useRef(createLabViewStore());
  const [views, setViews] = useState<LabViewSummary[]>([]);
  const [name, setName] = useState('');

  const refresh = () => storeRef.current.list().then(setViews).catch(() => {});
  useEffect(() => { refresh(); }, []);

  const configToView = (fl: FeatureLab): LabViewConfig => ({
    groups: fl.groups,
    normalizer: fl.normalizer,
    columns: fl.columns,
    showMarkers: fl.showMarkers,
    showValues: fl.showValues,
    derived: fl.derived,
  });

  const save = async () => {
    if (!name.trim()) return;
    await storeRef.current.save(name.trim(), configToView(config));
    setName('');
    refresh();
  };
  const load = async (vid: string) => {
    const view = await storeRef.current.load(vid);
    if (view) onLoad(view.config); // applies groups/mode/columns/derived; leaves show as-is
  };
  const remove = async (vid: string) => {
    await storeRef.current.remove(vid);
    refresh();
  };

  return (
    <details className="border-t border-white/10 pt-2">
      <summary className="cursor-pointer select-none text-[10px] font-bold uppercase tracking-widest text-white/60">Saved views</summary>
      <div className="mt-2 space-y-2">
        <div className="flex items-center gap-2">
          <input className={`${selectCls} flex-1`} placeholder="view name" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="button" className={`${btnCls} ${name.trim() ? '' : 'opacity-40'}`} disabled={!name.trim()} onClick={save}>Save</button>
        </div>
        {views.length === 0 && <p className="text-[10px] text-white/30">No saved views yet.</p>}
        {views.map((v) => (
          <div key={v.id} className="flex items-center gap-2 text-[11px]">
            <span className="flex-1 truncate" title={v.name}>{v.name}</span>
            <button type="button" className={btnCls} onClick={() => load(v.id)}>Load</button>
            <button type="button" className={btnCls} onClick={() => remove(v.id)}>✕</button>
          </div>
        ))}
      </div>
    </details>
  );
}
