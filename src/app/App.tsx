/**
 * App — the Thoremin instrument view. The webcam video (with hand-tracking
 * overlays) fills the whole screen as the primary visual cue; everything else
 * is a light, dismissible overlay so the instrument stays the focus:
 *  - a minimal brand/status badge (never blocks pointer events),
 *  - a collapsible controls panel (minimize to a single gear button),
 *  - a prominent "tap to play" call-to-action until audio is running.
 *
 * All signal processing happens in the DAG engine via {@link useThoreminEngine};
 * this component is purely presentational + lifecycle.
 */
import { useEffect } from 'react';
import { Play, BookOpen, VolumeX } from 'lucide-react';
import { useThoreminEngine } from './useEngine';
import { DEFAULT_SOURCE, type SourceSpec } from './sourceSpec';
import { installKeyboardShortcuts } from './keyboardShortcuts';
import { useControls } from './store';
import { useFaceStatus } from './faceStatus';
import InstrumentsPanel from './dials/InstrumentsPanel';
import RecordButton from './RecordButton';
import Toaster from './Toaster';
import CommandPaletteOverlay from './CommandPaletteOverlay';
import AssistantOverlay from '@/plugins/assistant/AssistantOverlay';
import VersionBadge from './VersionBadge';

/** A compact face-status chip, visible even when the controls panel is collapsed
 * (issue #65): only shown once a face mapping is active. */
function FaceChip() {
  const faceMapping = useControls((s) => s.faceMapping);
  const status = useFaceStatus((s) => s.status);
  const label = useFaceStatus((s) => s.label);
  if (faceMapping === 'none') return null;

  let dot = 'bg-white/40';
  let text = 'face starting…';
  if (status.phase === 'loading') {
    dot = 'bg-amber-400 animate-pulse';
    text = 'face loading';
  } else if (status.phase === 'error') {
    dot = 'bg-rose-500';
    text = 'face error';
  } else if (status.phase === 'ready') {
    if (status.faceDetected) {
      dot = 'bg-emerald-400';
      text = label ?? 'face';
    } else {
      dot = 'bg-sky-400';
      text = 'face ready';
    }
  }
  return (
    <div className="pointer-events-none absolute left-3 top-12 flex items-center gap-1.5 rounded-full bg-black/40 px-2 py-0.5 text-[9px] uppercase tracking-widest text-white/70 backdrop-blur">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      {text}
    </div>
  );
}

/** A persistent, unmissable cue shown whenever the instrument is muted (#91).
 * Non-interactive (the `m` key is the toggle SSOT via the graph); it tells the
 * player how to unmute so a muted instrument is never mistaken for a broken one. */
function MutedBadge() {
  const muted = useControls((s) => s.muted);
  if (!muted) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-red-500/90 px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-white shadow-lg backdrop-blur">
      <VolumeX className="h-3.5 w-3.5" />
      Muted — press M to unmute
    </div>
  );
}

export default function App({ source = DEFAULT_SOURCE }: { source?: SourceSpec }) {
  const { videoRef, canvasRef, status, error, audioOn, startAudio, recording } =
    useThoreminEngine(source);

  // #90: install the keyboard shortcuts (octave / magnetism / mute) — an app-level
  // tinykeys keymap dispatching dial commands, replacing the retired in-DAG switch.
  useEffect(() => installKeyboardShortcuts(), []);

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-black font-mono text-white">
      {/* Hidden webcam feed; the DAG draws the mirrored video + overlays to the
          canvas. The buffer is sized to the camera's native resolution in
          useEngine (so the draw is crisp); object-cover then fills the whole
          viewport (the video is the primary cue), scaling uniformly and cropping
          only the overflow edges. Tracking still runs on the full frame. */}
      <video ref={videoRef} autoPlay playsInline muted className="hidden" />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-cover" />

      {/* Top-left: minimal brand + status. pointer-events-none so it never
          intercepts clicks over the video. */}
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500 font-black text-black">θ</div>
        <div className="leading-tight">
          <div className="text-xs font-bold uppercase italic tracking-tighter">Thoremin</div>
          <div className="text-[9px] uppercase tracking-widest text-emerald-500/70">
            {status === 'loading' && 'loading…'}
            {status === 'ready' && (audioOn ? 'live' : 'ready')}
            {status === 'error' && 'error'}
          </div>
        </div>
      </div>
      <FaceChip />

      {/* Top-center: unmissable "muted" cue (audio silenced by the m key). */}
      <MutedBadge />

      {/* Bottom-left: link to the generated capabilities manual. */}
      <a
        href="manual.html"
        className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-black/40 px-3 py-1 text-[10px] uppercase tracking-widest text-white/60 backdrop-blur transition hover:text-white"
      >
        <BookOpen className="h-3 w-3" /> manual
      </a>

      {/* Bottom-right: the multi-stream recorder (#88) — a button that morphs into
          a settings sheet (out-of-instrument config) then a compact HUD. Available
          once audio is running. */}
      {audioOn && <RecordButton recording={recording} />}

      {/* Top-right: the instruments surface (the list + the per-instrument editor). */}
      <InstrumentsPanel />

      {/* Center: prominent call-to-action until audio is running (the browser
          requires a user gesture to start audio). */}
      {status === 'ready' && !audioOn && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <button
            onClick={startAudio}
            className="pointer-events-auto flex items-center gap-3 rounded-full bg-emerald-500 px-8 py-4 text-sm font-bold uppercase tracking-widest text-black shadow-2xl transition hover:brightness-110"
          >
            <Play className="h-5 w-5" /> Tap to play
          </button>
        </div>
      )}

      {/* Full-screen loading + error states. */}
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="text-center">
            <div className="mx-auto mb-3 h-12 w-12 animate-spin rounded-full border-4 border-emerald-500/30 border-t-emerald-500" />
            <p className="text-xs uppercase tracking-widest text-emerald-500">Loading neural engine</p>
            <p className="mt-1 text-[10px] uppercase tracking-widest text-white/40">
              {source.kind === 'video' ? 'loading video…' : 'allow camera access'}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-500/10 p-6 text-center backdrop-blur">
          <div>
            <p className="mb-3 max-w-sm text-red-400">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="rounded-full bg-red-500 px-5 py-2 text-xs font-bold uppercase tracking-widest"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Transient "saved as …" notifications (e.g. after a recording). */}
      <Toaster />

      {/* Cmd/Ctrl-K command palette — set any dial by name (#87). */}
      <CommandPaletteOverlay />

      {/* AI assistant — chat that parametrizes the instrument via the same command
          registry, behind a BYO-key multi-provider client-side backend (#87 Phase 3). */}
      <AssistantOverlay />

      {/* Unobtrusive "what's deployed" badge (commit + date), read from /_meta. */}
      <VersionBadge />
    </div>
  );
}
