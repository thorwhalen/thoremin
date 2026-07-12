/**
 * TaggingSheet (#92) — the annotation-mode setup surface. Pick + order the annotation set
 * (pre-seeded with the last-used set), choose exclusivity, and per annotation set its kind
 * (interval/point), lead-in (pre-roll seconds), colour and label. It also hosts the
 * EXPORT panel for the last finished take. It is a SETTINGS
 * surface, not a form to submit: every edit flows straight into the tagging store
 * (which debounce-persists via the taglog provider), so closing never loses anything.
 *
 * Purely presentational — a subscriber to the tagging store. Part of the build-checked
 * React layer (no @types/react). Styling mirrors the recording SettingsSheet.
 */
import { useState } from 'react';
import { ChevronDown, ChevronUp, Download, Plus, Trash2, X } from 'lucide-react';
import type { ExclusivityMode, TagDef, TagKind } from '@/taglog/affordances';
import { CODECS } from '@/taglog/affordances';
import { useTagging } from './store';
import { EXPORT_FORMATS, downloadTake, summarizeTake } from './export';

const selectCls = 'rounded bg-white/10 px-2 py-1 text-xs outline-none focus:bg-white/20';

const EXCLUSIVITY_OPTIONS: { value: ExclusivityMode; label: string }[] = [
  { value: 'off', label: 'Multiple at once' },
  { value: 'single', label: 'One at a time' },
  { value: 'group', label: 'By group' },
];

/** One editable tag row: number badge, colour, label, kind, lead-in, reorder, delete. */
function TagRow({ def, index, count }: { def: TagDef; index: number; count: number }) {
  const updateTag = useTagging((s) => s.updateTag);
  const removeTag = useTagging((s) => s.removeTag);
  const moveTag = useTagging((s) => s.moveTag);
  const exclusivity = useTagging((s) => s.config.exclusivity);

  return (
    <div className="rounded-lg bg-white/5 p-2">
      <div className="flex items-center gap-1.5">
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-black"
          style={{ backgroundColor: def.color }}
        >
          {def.number ?? '·'}
        </span>
        <input
          type="color"
          value={def.color}
          onChange={(e) => updateTag(def.id, { color: e.target.value })}
          className="h-5 w-5 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
          title="Annotation colour"
        />
        <input
          type="text"
          value={def.label}
          spellCheck={false}
          onChange={(e) => updateTag(def.id, { label: e.target.value })}
          className="min-w-0 flex-1 rounded bg-white/10 px-2 py-1 text-xs outline-none focus:bg-white/20"
        />
        <div className="flex shrink-0 flex-col">
          <button
            onClick={() => moveTag(def.id, -1)}
            disabled={index === 0}
            aria-label="Move up"
            className="text-white/50 transition hover:text-white disabled:opacity-20"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <button
            onClick={() => moveTag(def.id, 1)}
            disabled={index === count - 1}
            aria-label="Move down"
            className="text-white/50 transition hover:text-white disabled:opacity-20"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
        <button
          onClick={() => removeTag(def.id)}
          aria-label="Delete annotation"
          className="shrink-0 rounded p-1 text-white/40 transition hover:bg-white/10 hover:text-rose-400"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-2 pl-6 text-[11px] text-white/70">
        <label className="flex items-center gap-1" title="Interval (open→close) or an instantaneous point">
          Kind
          <select
            className={selectCls}
            value={def.kind}
            onChange={(e) => updateTag(def.id, { kind: e.target.value as TagKind })}
          >
            <option value="interval">interval ▬</option>
            <option value="point">point ●</option>
          </select>
        </label>
        {def.kind === 'interval' && (
          <label className="flex items-center gap-1" title="Lead-in seconds: open shifts later, close earlier — trims the reach-in/out.">
            Lead-in
            <input
              type="number"
              min={0}
              max={9}
              value={def.leadIn}
              onChange={(e) => updateTag(def.id, { leadIn: Math.max(0, Math.min(9, Number(e.target.value) || 0)) })}
              className="w-12 rounded bg-white/10 px-1.5 py-1 text-xs outline-none focus:bg-white/20"
            />
            s
          </label>
        )}
        {exclusivity === 'group' && def.kind === 'interval' && (
          <label className="flex items-center gap-1" title="Annotations sharing a group auto-close each other.">
            Group
            <input
              type="text"
              value={def.group ?? ''}
              spellCheck={false}
              onChange={(e) => updateTag(def.id, { group: e.target.value.trim() || null })}
              className="w-16 rounded bg-white/10 px-1.5 py-1 text-xs outline-none focus:bg-white/20"
            />
          </label>
        )}
      </div>
    </div>
  );
}

export default function TaggingSheet({ onClose }: { onClose: () => void }) {
  const mode = useTagging((s) => s.mode);
  const setMode = useTagging((s) => s.setMode);
  const defs = useTagging((s) => s.defs);
  const config = useTagging((s) => s.config);
  const setConfig = useTagging((s) => s.setConfig);
  const addTag = useTagging((s) => s.addTag);
  const recording = useTagging((s) => s.take !== null);

  return (
    <div className="max-h-[80vh] w-80 overflow-y-auto rounded-2xl bg-black/70 p-3 text-white/90 shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-white/60">Annotation mode</span>
        <button
          onClick={onClose}
          aria-label="Close annotation settings"
          className="rounded p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Master on/off — arms the button stack + the 1..9 keys. Disabled mid-take so
          an active recording keeps its annotation log. */}
      <label
        className={`mb-3 flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 ${recording ? 'opacity-60' : ''}`}
        title={recording ? 'Stop the recording to change this' : undefined}
      >
        <span className="text-xs font-bold uppercase tracking-wide">{mode ? 'On' : 'Off'}</span>
        <input type="checkbox" checked={mode} disabled={recording} onChange={(e) => setMode(e.target.checked)} />
      </label>

      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-white/50">Exclusivity</span>
        <select
          className={selectCls}
          value={config.exclusivity}
          onChange={(e) => setConfig({ exclusivity: e.target.value as ExclusivityMode })}
        >
          {EXCLUSIVITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-white/50">Annotations</span>
        <button
          onClick={() => addTag()}
          className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest transition hover:bg-white/20"
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>
      <div className="space-y-1.5">
        {defs.length === 0 && (
          <p className="rounded-lg bg-white/5 p-3 text-center text-[11px] text-white/50">
            No annotations yet — add one to start.
          </p>
        )}
        {defs.map((def, i) => (
          <TagRow key={def.id} def={def} index={i} count={defs.length} />
        ))}
      </div>

      {/* Advanced: the wire representation (extraction-ready config). statusEnum is
          the smallest, self-describing default; pointPair/kindField are for interop. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-[10px] uppercase tracking-widest text-white/40">Advanced</summary>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-white/50" title="How each event is written to annotations.jsonl">
            Event format
          </span>
          <select
            className={selectCls}
            value={config.codec}
            onChange={(e) => setConfig({ codec: e.target.value })}
          >
            {Object.keys(CODECS).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </details>

      <ExportPanel />

      <p className="mt-3 text-[10px] leading-relaxed text-white/40">
        Annotations are recorded <strong className="text-white/60">only while the Record button is
        running</strong> — tapping them otherwise is rehearsal and is not saved. During a take they
        are written to <code>&lt;take&gt;.annotations.jsonl</code> in the take folder, on the same
        clock as the audio and video. Keys 1–9 toggle; 0 clears all.
      </p>
    </div>
  );
}

/**
 * Export the last finished take.
 *
 * This panel exists because the feature was previously write-only from the user's point of
 * view: you could tap annotations all day and there was nowhere in the app to see or fetch
 * them. The take folder did receive a `.annotations.jsonl`, but nothing said so, and JSONL of
 * absolute-clock edges is not what anyone wants to open anyway. So: state plainly what
 * happened (or why nothing did), and hand over a file in a format a real tool can read.
 */
function ExportPanel() {
  const lastTake = useTagging((s) => s.lastTake);
  const recording = useTagging((s) => s.take !== null);
  const [format, setFormat] = useState<string>(EXPORT_FORMATS[0].id);

  const summary = lastTake ? summarizeTake(lastTake) : null;
  const total = summary ? summary.intervals + summary.points : 0;
  const chosen = EXPORT_FORMATS.find((f) => f.id === format) ?? EXPORT_FORMATS[0];

  return (
    <div className="mt-3 border-t border-white/10 pt-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-white/50">Export</span>
        {recording && (
          <span className="text-[9px] uppercase tracking-widest text-emerald-400">recording…</span>
        )}
      </div>

      {!lastTake ? (
        <p className="rounded-lg bg-white/5 p-3 text-[11px] leading-relaxed text-white/50">
          {recording
            ? 'Recording — your annotations will be exportable here as soon as you stop.'
            : 'Nothing to export yet. Start a recording, tap some annotations, then stop: the take shows up here.'}
        </p>
      ) : (
        <>
          <p className="mb-2 text-[11px] text-white/60">
            Last take:{' '}
            <span className="tabular-nums text-white/90">
              {summary!.intervals} interval{summary!.intervals === 1 ? '' : 's'}
            </span>
            {', '}
            <span className="tabular-nums text-white/90">
              {summary!.points} point{summary!.points === 1 ? '' : 's'}
            </span>{' '}
            over <span className="tabular-nums text-white/90">{summary!.seconds.toFixed(1)}s</span>.
          </p>
          <div className="flex items-center gap-2">
            <select
              className={`${selectCls} flex-1`}
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              aria-label="Annotation export format"
            >
              {EXPORT_FORMATS.map((f) => (
                <option key={f.id} value={f.id} title={f.note}>
                  {f.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => downloadTake(lastTake, format)}
              disabled={total === 0}
              className="flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
            >
              <Download className="h-3 w-3" />
              Download
            </button>
          </div>
          <p className="mt-1.5 text-[10px] leading-snug text-white/35">
            {total === 0
              ? 'That take recorded no annotations — nothing to export.'
              : chosen.note}
          </p>
        </>
      )}
    </div>
  );
}
