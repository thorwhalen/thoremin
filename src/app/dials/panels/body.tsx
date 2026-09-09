/**
 * The BODY section of the settings panel (#186): the body-tracking on/off dial, the
 * PoseLandmarker model choice, and — PR E — the body→sound routing: four route
 * slots, each "this body feature drives that sound aspect". Body tracking is the
 * most expensive model the graph can host, so it is a dial the player turns on —
 * never a default — and the copy says what it costs.
 *
 * `bodyMap` is a whole-object dial like `handMap`: its discrete controls address one
 * scalar LEAF by path (`bodyMap.routes.a.target`) and dispatch `dial.setIn`; picking a
 * feature also seeds the route's input range from the catalog's declared range, as ONE
 * atomic `dial.patch` (three leaves), so a half-applied route never sounds. The
 * from/to numbers commit on blur or Enter (a value per keystroke would toast on every
 * half-typed number) and only when finite.
 */
import { useState } from 'react';
import { dispatchDialSet, dispatchDialSetIn, dispatchDialPatch } from '../../dispatchDial';
import { useDialsSettings } from '../useDialsSettings';
import { selectCls, Toggle } from '../primitives';
import { BODY_MODELS } from '@/settings/schema';
import { BODY_ROUTE_SLOTS, BODY_ROUTE_TARGETS, type BodyMap, type BodyRouteSlot } from '@/nodes/mapping/body_map';
import { ALL_FEATURES, FEATURE_BY_ID, FEATURE_GROUPS } from '@/features/catalog';
import { EFFECT_LABELS } from '../labels';

const MODEL_LABEL: Record<(typeof BODY_MODELS)[number], string> = {
  lite: 'lite (fast, 5.8 MB download)',
  full: 'full (steadier on fast motion, 9.4 MB download)',
};

const TARGET_LABEL: Record<(typeof BODY_ROUTE_TARGETS)[number] | 'none', string> = { ...EFFECT_LABELS, gain: 'Volume' };

/** The routable features: the body catalog, grouped in display order. */
const BODY_FEATURE_GROUPS = FEATURE_GROUPS.filter((g) => g.source === 'body').map((g) => ({
  group: g,
  features: ALL_FEATURES.filter((f) => f.group === g.id),
}));

/** A number field that dispatches on commit (blur / Enter), never mid-edit, and only a finite value. */
function CommitNumber({ label, value, onCommit, disabled }: { label: string; value: number; onCommit: (v: number) => void; disabled: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const v = Number(text);
    if (Number.isFinite(v) && v !== value) onCommit(v);
    setText(null);
  };
  return (
    <label className="flex items-center gap-1">
      {label}
      <input
        type="number"
        className={`${selectCls} w-16`}
        value={text ?? String(value)}
        step="any"
        disabled={disabled}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

function RouteRow({ slot, map, enabled }: { slot: BodyRouteSlot; map: BodyMap; enabled: boolean }) {
  const r = map.routes[slot];
  const base = `bodyMap.routes.${slot}`;
  const multiplicative = r.target === 'gate' || r.target === 'gain';
  const declaredRange = r.feature ? FEATURE_BY_ID[r.feature]?.range : undefined;
  /** Picking a feature seeds inMin/inMax from its declared range (or 0..1), atomically. */
  const pickFeature = (id: string) => {
    const range = FEATURE_BY_ID[id]?.range ?? [0, 1];
    dispatchDialPatch([
      [`${base}.feature`, id],
      [`${base}.inMin`, range[0]],
      [`${base}.inMax`, range[1]],
    ]);
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <span className="w-4 shrink-0 uppercase text-white/50">{slot}</span>
        <select
          className={`${selectCls} flex-1`}
          value={r.feature}
          disabled={!enabled}
          onChange={(e) => pickFeature(e.target.value)}
          aria-label={`Route ${slot} feature`}
        >
          <option value="">(no feature)</option>
          {BODY_FEATURE_GROUPS.map(({ group, features }) => (
            <optgroup key={group.id} label={group.label}>
              {features.map((f) => (
                <option key={f.id} value={f.id}>{f.id.replace(/^body\./, '')}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="text-white/40">→</span>
        <select
          className={selectCls}
          value={r.target}
          disabled={!enabled}
          onChange={(e) => dispatchDialSetIn(`${base}.target`, e.target.value)}
          aria-label={`Route ${slot} target`}
        >
          {(['none', ...BODY_ROUTE_TARGETS] as const).map((t) => (
            <option key={t} value={t}>{TARGET_LABEL[t]}</option>
          ))}
        </select>
      </div>
      {r.target !== 'none' && r.feature && (
        <div className="flex flex-wrap items-center gap-2 pl-6 text-[10px] text-white/60">
          <CommitNumber label="from" value={r.inMin} disabled={!enabled} onCommit={(v) => dispatchDialSetIn(`${base}.inMin`, v)} />
          <CommitNumber label="to" value={r.inMax} disabled={!enabled} onCommit={(v) => dispatchDialSetIn(`${base}.inMax`, v)} />
          <Toggle label="invert" checked={r.invert} disabled={!enabled} onChange={(v) => dispatchDialSetIn(`${base}.invert`, v)} />
          <label className="flex items-center gap-1">
            smooth
            <select className={selectCls} value={String(r.smoothing)} disabled={!enabled} onChange={(e) => dispatchDialSetIn(`${base}.smoothing`, Number(e.target.value))}>
              {['0', '0.5', '0.8', '0.95'].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          {multiplicative && (
            <label className="flex items-center gap-1" title="How far below full the route can pull: 1 = silence at rest, 0.5 = half volume at rest">
              depth
              <select className={selectCls} value={String(r.depth)} disabled={!enabled} onChange={(e) => dispatchDialSetIn(`${base}.depth`, Number(e.target.value))}>
                {['1', '0.75', '0.5', '0.25'].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          )}
          {!declaredRange && (
            <span className="text-white/40" title="This feature has no fixed range; set 'to' to the value you reach when you move most">
              (set "to" by watching the Lab)
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function BodyControls() {
  const { state } = useDialsSettings();
  const v = state.effective;
  const enabled = v['body.enabled'] as boolean;
  const model = (v['body.model'] as (typeof BODY_MODELS)[number]) ?? 'lite';
  const map = v['bodyMap'] as BodyMap;

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => dispatchDialSet('body.enabled', e.target.checked)}
        />
        Track the body
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Model
        <select
          className={selectCls}
          value={model}
          disabled={!enabled}
          onChange={(e) => dispatchDialSet('body.model', e.target.value)}
        >
          {BODY_MODELS.map((m) => (
            <option key={m} value={m}>
              {MODEL_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      <p className="text-[10px] leading-relaxed text-white/40">
        Detects 33 full-body landmarks from the webcam and draws the skeleton on the
        video. It is the source for body features (the Lab, the trainer) and the dance
        pulse; the model downloads on first use.
      </p>
      <div className="space-y-1 border-t border-white/10 pt-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Body → sound</p>
        <p className="text-[10px] leading-relaxed text-white/40">
          Route a body feature to a sound aspect: the feature's value between <em>from</em> and
          <em> to</em> drives it 0..1 (invert to flip). A volume or gate route pulls down from
          full by its depth. Turn body tracking on to hear it.
        </p>
        {map && BODY_ROUTE_SLOTS.map((slot) => <RouteRow key={slot} slot={slot} map={map} enabled={enabled} />)}
      </div>
    </div>
  );
}
