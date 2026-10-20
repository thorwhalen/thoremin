/**
 * The patcher's node inspector (#14): one node of the live graph, its wiring, its live outputs and
 * the settings that feed it.
 *
 * The settings controls are generated from the dials form (`useDialsSettings().form`, the zodal
 * projection of the settings schema, which is built from each node's `<node>.schema.ts` contract):
 * a field's widget picks the control, its enum values and bounds fill it. A structured dial (the
 * hand map, an extension's whole-object slice) is walked to its scalar leaves. Every control writes
 * by DISPATCH (`dispatchDialSet`, `dispatchDialSetIn`), the single write path, so undo, the
 * assistant and the refused-write toast see a patcher edit like any other; the inspector never
 * holds the dials store's setter (`test/patcher/inspector_write_path.test.ts`).
 *
 * The node's spec params are shown read-only: they are build-time defaults, and changing them is
 * editing the graph, which is v2.
 */
import { useEffect, useState } from 'react';
import type { GraphSpec } from '@thoremin/dag';
import type { OutputReader } from '@thoremin/sdk-ui/types';
import { dispatchDialSet, dispatchDialSetIn, useDialsSettings } from '@thoremin/sdk-ui/dials';
import { Toggle, selectCls } from '@thoremin/sdk-ui/primitives';
import { settingsFeeding, summarize, wiringOf } from '../lib/inspect';

/** How often the live outputs are re-read while a node is shown. */
const POLL_MS = 250;
/** How deep a structured dial is walked for scalar leaves. */
const MAX_DEPTH = 4;

type FieldConfig = ReturnType<typeof useDialsSettings>['form']['fields'][number];

const inputCls = 'w-20 rounded bg-white/10 px-1 py-0.5 text-xs outline-none focus:bg-white/20';

/** A number typed and committed on Enter or blur (a keystroke is not a write). */
function NumberField({ value, min, max, onCommit }: { value: number; min?: number; max?: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = Number(text);
    if (text.trim() !== '' && Number.isFinite(v) && v !== value) onCommit(v);
    else setText(String(value));
  };
  return (
    <input
      type="number"
      className={inputCls}
      value={text}
      min={min}
      max={max}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

/** A string typed and committed on Enter or blur. */
function TextField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => (text !== value ? onCommit(text) : undefined);
  return <input type="text" className={`${inputCls} w-32`} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}

/** One scalar leaf of a structured dial, written by its dotted path. */
function LeafControl({ path, value }: { path: string; value: unknown }) {
  const label = path.split('.').slice(1).join('.');
  if (typeof value === 'boolean') return <Toggle label={label} checked={value} onChange={(v) => dispatchDialSetIn(path, v)} />;
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-white/70">{label}</span>
      {typeof value === 'number' ? (
        <NumberField value={value} onCommit={(v) => dispatchDialSetIn(path, v)} />
      ) : typeof value === 'string' ? (
        <TextField value={value} onCommit={(v) => dispatchDialSetIn(path, v)} />
      ) : (
        <span className="text-white/40">{summarize(value)}</span>
      )}
    </label>
  );
}

/** Every scalar leaf of a structured value, as dotted paths. */
function leavesOf(root: string, value: unknown, depth = 0): [string, unknown][] {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || depth >= MAX_DEPTH) return [[root, value]];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => leavesOf(`${root}.${k}`, v, depth + 1));
}

/** One dial, its control chosen by the form's widget for it. */
function DialControl({ field, value }: { field: FieldConfig; value: unknown }) {
  if (field.isStructured || (value !== null && typeof value === 'object')) {
    return (
      <details className="rounded bg-white/5 px-2 py-1" data-dial={field.key}>
        <summary className="cursor-pointer text-xs text-white/80">{field.label}</summary>
        <div className="mt-1 space-y-1">
          {leavesOf(field.key, value).map(([path, leaf]) => (
            <LeafControl key={path} path={path} value={leaf} />
          ))}
        </div>
      </details>
    );
  }
  if (field.widget === 'switch' || typeof value === 'boolean') return <Toggle label={field.label} checked={Boolean(value)} onChange={(v) => dispatchDialSet(field.key, v)} />;
  const control =
    (field.widget === 'select' || field.widget === 'radio') && field.enumValues ? (
      <select className={selectCls} value={String(value)} onChange={(e) => dispatchDialSet(field.key, e.target.value)}>
        {field.enumValues.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    ) : typeof value === 'number' ? (
      <NumberField value={value} min={field.bounds?.min} max={field.bounds?.max} onCommit={(v) => dispatchDialSet(field.key, v)} />
    ) : typeof value === 'string' ? (
      <TextField value={value} onCommit={(v) => dispatchDialSet(field.key, v)} />
    ) : (
      <span className="text-white/40">{summarize(value)}</span>
    );
  return (
    <label className="flex items-center justify-between gap-2 text-xs" title={field.description}>
      <span className="text-white/80">{field.label}</span>
      {control}
    </label>
  );
}

/** The node's outputs as they are now, re-read a few times a second. */
function LiveOutputs({ reader, nodeId, ports }: { reader: OutputReader | null; nodeId: string; ports: readonly string[] }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), POLL_MS);
    return () => clearInterval(t);
  }, []);
  if (!ports.length) return <p className="text-xs text-white/40">No output is wired.</p>;
  return (
    <ul className="space-y-0.5 font-mono text-[11px]">
      {ports.map((port) => (
        <li key={port} className="flex justify-between gap-2" data-patcher-output={port}>
          <span className="text-white/60">{port}</span>
          <span className="truncate text-white/90">{reader ? summarize(reader.getOutput(nodeId, port)) : '(no engine)'}</span>
        </li>
      ))}
    </ul>
  );
}

export default function NodeInspector({ spec, nodeId, reader }: { spec: GraphSpec; nodeId: string; reader: OutputReader | null }) {
  const { state, form } = useDialsSettings();
  const node = spec.nodes.find((n) => n.id === nodeId);
  if (!node) return <p className="text-xs text-white/50">That node left the graph.</p>;
  const fieldByKey = new Map(form.fields.map((f) => [f.key, f]));
  const feeds = settingsFeeding(spec, nodeId, [...fieldByKey.keys()]);
  const { inputs, outputs } = wiringOf(spec, nodeId);
  const outPorts = [...new Set(outputs.map((e) => e.from.port))];
  const effective = state.effective as Record<string, unknown>;
  const shownKeys = [...new Set(feeds.flatMap((f) => f.keys))];
  const readOnly = feeds.filter((f) => f.keys.length === 0);
  return (
    <div className="space-y-3 text-xs" data-patcher-inspector={nodeId}>
      <div>
        <div className="text-sm font-semibold text-white">{node.id}</div>
        <div className="text-white/50">{node.type}</div>
      </div>
      <section>
        <h4 className="mb-1 font-semibold text-white/70">Settings</h4>
        {shownKeys.length ? (
          <div className="space-y-1">
            {shownKeys.map((key) => (
              <DialControl key={key} field={fieldByKey.get(key)!} value={effective[key]} />
            ))}
          </div>
        ) : (
          <p className="text-white/40">No setting feeds this node.</p>
        )}
        {readOnly.length > 0 && <p className="mt-1 text-white/40">Also from the shell, not a setting: {readOnly.map((f) => f.port).join(', ')}.</p>}
      </section>
      <section>
        <h4 className="mb-1 font-semibold text-white/70">Outputs, live</h4>
        <LiveOutputs reader={reader} nodeId={nodeId} ports={outPorts} />
      </section>
      <section>
        <h4 className="mb-1 font-semibold text-white/70">Inputs</h4>
        {inputs.length ? (
          <ul className="space-y-0.5 font-mono text-[11px] text-white/70">
            {inputs.map((e) => (
              <li key={`${e.from.node}.${e.from.port}>${e.to.port}`}>
                {e.to.port} ← {e.from.node}.{e.from.port}
                {e.delayed ? ' (previous tick)' : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-white/40">A source: nothing flows in.</p>
        )}
      </section>
      {node.params !== undefined && (
        <details>
          <summary className="cursor-pointer font-semibold text-white/70">Build-time params (read-only)</summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded bg-black/30 p-1 text-[10px] text-white/70">{JSON.stringify(node.params, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
