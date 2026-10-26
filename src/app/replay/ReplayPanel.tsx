/**
 * ReplayPanel — the Replay tool: play a recorded take's hands into the instrument in place of the
 * camera, to hear again what an instrument did on it (a glitch, a wrong chord) and to show it to
 * someone else. Pick a file (the Record tool's `.features.jsonl`, or a `hands.ndjson[.gz]` stream),
 * and the loaded instrument plays it, looped by default; Stop brings the camera back. The same
 * recording can be opened from a link with `?replay=<url>`.
 *
 * The replay runs on with the panel closed (the tool runs detached), so the bar shows it running
 * and carries its stop control.
 */
import { FileUp, X } from 'lucide-react';
import { useTools } from '../tools/toolsStore';
import { toolById } from '../tools/tools';
import { HANDS_EDGE } from './handRecording';
import { useReplay } from './replayStore';

export const REPLAY_TOOL_ID = 'replay';

export default function ReplayPanel() {
  const open = useTools((s) => s.open) === REPLAY_TOOL_ID;
  const close = useTools((s) => s.close);
  const { replay, loading, error, loadFile, setLoop, clear } = useReplay();
  if (!open) return null;
  const tool = toolById(REPLAY_TOOL_ID);
  return (
    <div data-replay-panel className="shell-tool-panel absolute left-3 z-40 flex w-96 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/70 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <FileUp className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden />
        <span className="flex-1 text-[11px] font-bold uppercase tracking-widest text-white/70">Replay</span>
        <button onClick={close} aria-label="Close the Replay panel" className="rounded p-1 text-white/60 transition hover:bg-white/10 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-3 overflow-auto p-4 text-[11px] leading-relaxed text-white/70">
        {tool && <p className="text-[10px] uppercase tracking-widest text-emerald-500/70">{tool.description}</p>}
        <p>
          Record a take with the Record button, <b>Feature stream (JSONL)</b> ticked (it keeps every edge, the hands' <code>{HANDS_EDGE}</code>{' '}
          among them), then open the take's <code>.features.jsonl</code> here. The loaded instrument plays your recorded hands instead of the
          camera; switch instruments to hear another one on the same take.
        </p>
        <label className="block">
          <span className="sr-only">Recording file</span>
          <input
            data-replay-file
            type="file"
            accept=".jsonl,.ndjson,.gz,.json,application/json,application/gzip"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void loadFile(file);
              e.target.value = '';
            }}
            className="block w-full text-[11px] text-white/70 file:mr-2 file:rounded file:border-0 file:bg-emerald-500/20 file:px-2 file:py-1 file:text-emerald-200"
          />
        </label>
        {loading && <p data-replay-status="loading">Reading the recording...</p>}
        {error && (
          <p data-replay-status="error" role="alert" className="text-rose-300">
            {error}
          </p>
        )}
        {replay && (
          <div data-replay-status="playing" className="space-y-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-2">
            <p className="break-all text-white/80">
              Replaying <b>{replay.name}</b>: {replay.frames.length} frames, {replay.durationS.toFixed(1)} s
              {replay.skipped > 0 && <>, {replay.skipped} unreadable lines skipped</>}.
            </p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={replay.loop} onChange={(e) => setLoop(e.target.checked)} />
              Loop
            </label>
            <button
              data-replay-stop
              onClick={clear}
              className="rounded border border-white/15 bg-white/10 px-2 py-1 text-[11px] uppercase tracking-widest text-white/80 hover:bg-white/20"
            >
              Stop and use the camera
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
