/**
 * RecordButton (#88) — the bottom-right recording control, a button that morphs
 * through the take's phases so recording settings live OUTSIDE the instrument:
 *
 *   idle       →  [ ● Record ]
 *   settings   →  a transient "recording session" sheet in the same slot, with a
 *                 [ ● Rec now ] primary button exactly where Record was and a
 *                 [ ✕ ] Close that auto-saves the config (it's a settings surface,
 *                 not a form to submit).
 *   recording  →  a compact HUD:  [ ■ Stop ]  ● 00:12  audio · overlay · features
 *   saving     →  the HUD, disabled, while the take converts + writes.
 *
 * All state lives in the engine hook (`useThoreminEngine().recording`); this is
 * purely presentational. Part of the build-checked React layer (no @types/react).
 */
import { Circle, Square, X } from 'lucide-react';
import { RECORDING_FORMATS } from './recording/formats';
import { supportsOverlayAlpha } from './recording/caps';
import type { RecordingSession } from './recording/schema';

export interface RecordingControls {
  phase: 'idle' | 'settings' | 'recording' | 'saving';
  session: RecordingSession;
  setSession: (next: RecordingSession | ((prev: RecordingSession) => RecordingSession)) => void;
  open: (instrument?: string) => void;
  close: () => void;
  recNow: () => void | Promise<void>;
  stop: () => void | Promise<void>;
  elapsedMs: number;
  activeStreams: string[];
}

const selectCls = 'rounded bg-white/10 px-2 py-1 text-xs outline-none focus:bg-white/20';

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function Check({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-xs ${disabled ? 'opacity-40' : ''}`}
      title={hint}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/** The recording-session settings sheet (opens in place of the Record button). */
function SettingsSheet({ recording }: { recording: RecordingControls }) {
  const { session, setSession } = recording;
  const s = session.streams;
  const alphaOk = supportsOverlayAlpha();

  const setStream = (key: keyof RecordingSession['streams'], v: boolean) =>
    setSession((prev) => ({ ...prev, streams: { ...prev.streams, [key]: v } }));

  const toggleFormat = (id: string, on: boolean) =>
    setSession((prev) => {
      const has = prev.formats.includes(id);
      if (on && !has) return { ...prev, formats: [...prev.formats, id] };
      if (!on && has) {
        const next = prev.formats.filter((f) => f !== id);
        return next.length ? { ...prev, formats: next } : prev; // keep ≥1
      }
      return prev;
    });

  return (
    <div className="w-72 rounded-2xl bg-black/70 p-3 text-white/90 shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-white/60">
          Recording
        </span>
        <button
          onClick={recording.close}
          aria-label="Close recording settings"
          className="rounded p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <label className="mb-2 block">
        <span className="text-[10px] uppercase tracking-widest text-white/50">Name</span>
        <input
          type="text"
          value={session.name}
          spellCheck={false}
          onChange={(e) => setSession((prev) => ({ ...prev, name: e.target.value }))}
          className="mt-1 w-full rounded bg-white/10 px-2 py-1 text-xs outline-none focus:bg-white/20"
        />
      </label>

      <div className="mb-2">
        <span className="text-[10px] uppercase tracking-widest text-white/50">Location</span>
        <div className="mt-1 flex flex-col gap-1">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="radio"
              name="rec-location"
              checked={session.location === 'directory'}
              onChange={() => setSession((prev) => ({ ...prev, location: 'directory' }))}
            />
            Choose folder…
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="radio"
              name="rec-location"
              checked={session.location === 'downloads'}
              onChange={() => setSession((prev) => ({ ...prev, location: 'downloads' }))}
            />
            Downloads (zip)
          </label>
        </div>
      </div>

      <div className="mb-2 space-y-1">
        <span className="text-[10px] uppercase tracking-widest text-white/50">Record</span>
        <Check label="Audio" checked={s.audio} onChange={(v) => setStream('audio', v)} />
        <Check
          label="Video + overlays (what you see)"
          checked={s.overlayVideo}
          onChange={(v) => setStream('overlayVideo', v)}
        />
        <Check
          label="Pure webcam (no overlays)"
          checked={s.pureVideo}
          onChange={(v) => setStream('pureVideo', v)}
          hint="The raw camera picture only — no tracking graphics. Useful as clean training/input footage."
        />
        {s.pureVideo && (
          <div className="pl-5">
            <Check
              label="include audio"
              checked={s.pureVideoAudio}
              onChange={(v) => setStream('pureVideoAudio', v)}
              hint="Mux the synth audio into the pure-webcam file (off = clean input footage)."
            />
          </div>
        )}
        <Check
          label="Overlay only (transparent)"
          checked={s.overlayAlpha && alphaOk}
          disabled={!alphaOk}
          onChange={(v) => setStream('overlayAlpha', v)}
          hint={
            alphaOk
              ? 'Landmarks/cues on transparency (alpha WebM), for compositing later.'
              : 'Transparent overlay export needs a Chromium browser (experimental).'
          }
        />
        <Check
          label="Feature stream (JSONL)"
          checked={s.features}
          onChange={(v) => setStream('features', v)}
          hint="Every DAG edge value per tick → a .features.jsonl, aligned to the take's clock."
        />
      </div>

      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-white/50">Formats</span>
        <div className="flex gap-3">
          {RECORDING_FORMATS.map((f) => (
            <Check
              key={f.id}
              label={f.id.toUpperCase()}
              checked={session.formats.includes(f.id)}
              onChange={(v) => toggleFormat(f.id, v)}
              disabled={!s.audio}
              hint={f.label}
            />
          ))}
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-white/50">Frame rate</span>
        <select
          className={selectCls}
          value={session.fps}
          onChange={(e) => setSession((prev) => ({ ...prev, fps: Number(e.target.value) }))}
        >
          {[24, 30, 60].map((f) => (
            <option key={f} value={f}>
              {f} fps
            </option>
          ))}
        </select>
      </div>

      <Check
        label="Save a bare file when only one stream"
        checked={session.singleFileWhenAlone}
        onChange={(v) => setSession((prev) => ({ ...prev, singleFileWhenAlone: v }))}
      />

      {/* Rec now — exactly where the Record button was (same slot, stable target). */}
      <div className="mt-3 flex justify-end">
        <button
          onClick={() => void recording.recNow()}
          className="flex items-center gap-2 rounded-full bg-red-500 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white transition hover:brightness-110"
        >
          <Circle className="h-3 w-3 fill-current" /> Rec now
        </button>
      </div>
    </div>
  );
}

/** The compact in-take HUD (Stop, elapsed, active-stream chips). */
function Hud({ recording }: { recording: RecordingControls }) {
  const saving = recording.phase === 'saving';
  return (
    <button
      onClick={() => void recording.stop()}
      disabled={saving}
      aria-label={saving ? 'Saving recording' : 'Stop recording'}
      className={`flex items-center gap-2 rounded-full px-4 py-2 text-[10px] font-bold uppercase tracking-widest backdrop-blur transition ${
        saving ? 'bg-black/50 text-white/50' : 'animate-pulse bg-red-500 text-white'
      }`}
    >
      <Square className="h-3 w-3 fill-current" />
      {saving ? 'Saving…' : 'Stop'}
      {!saving && (
        <>
          <span className="tabular-nums">{fmtElapsed(recording.elapsedMs)}</span>
          <span className="font-normal normal-case tracking-normal text-white/70">
            {recording.activeStreams.join(' · ')}
          </span>
        </>
      )}
    </button>
  );
}

export default function RecordButton({ recording }: { recording: RecordingControls }) {
  return (
    <div className="absolute bottom-3 right-3 flex flex-col items-end">
      {recording.phase === 'idle' && (
        <button
          onClick={() => recording.open()}
          aria-label="Record"
          className="flex items-center gap-2 rounded-full bg-black/50 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white/80 backdrop-blur transition hover:text-white"
        >
          <Circle className="h-3 w-3 fill-red-500 text-red-500" /> Record
        </button>
      )}
      {recording.phase === 'settings' && <SettingsSheet recording={recording} />}
      {(recording.phase === 'recording' || recording.phase === 'saving') && (
        <Hud recording={recording} />
      )}
    </div>
  );
}
