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
// The app's storage target, installed before any store is used (#600 S12).
import './host/storage';
// The AI-provider key store, for an extension's engine (#600 S14).
import './host/keys';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Play, VolumeX } from 'lucide-react';
import { useThoreminEngine } from './engine/useEngine';
import { DEFAULT_SOURCE, type SourceSpec } from './engine/sourceSpec';
import { NO_SLOTS, type SlotSelection } from './graph';
import { installKeyboardShortcuts } from './shell/keyboardShortcuts';
import { installTaggingKeymap } from './tagging/keymap';
import { installRecording } from './recording/configStore';
import { UI_CONTRIBUTIONS } from './host/contributions';
import { CONTRIBUTIONS } from '@/host/contributions';
import { stillSoundingNote } from './shell/stillSounding';
import { useControls } from './store';
import { useFaceStatus } from './face/faceStatus';
import { demandWantsFace } from '@thoremin/sdk/features/sources';
import { useDemandedGroups } from './engine/useDemandedGroups';
import InstrumentsPanel from './dials/InstrumentsPanel';
import RecordButton from './recording/RecordButton';
import TaggingControls, { AnnotationsButton } from './tagging/TaggingControls';
import Toaster from './shell/Toaster';
import CommandPaletteOverlay from './shell/CommandPaletteOverlay';
import AssistantOverlay from '@/app/assistant/AssistantOverlay';
import ToolsBar from './tools/ToolsBar';
import ToolsLauncher from './tools/ToolsLauncher';
import { publishHeight, TAKE_CLUSTER_HEIGHT_VAR } from './shell/shellLayout';
import GesturesPanel from './gestures/GesturesPanel';
import { SHELL_TOOLS } from './tools/shellTools';
import { hushReason } from './shell/hushReason';
import ExtensionToolPanels from './tools/ExtensionToolPanels';
import VersionBadge from './shell/VersionBadge';
import TimingChip from './timing/TimingChip';

/** A compact face-status chip, visible even when the controls panel is collapsed
 * (issue #65): shown whenever the face model is running — whether because a face
 * MAPPING is driving the sound or because the Feature Lab is measuring face groups
 * (#136). The chip is the player's only cue that the camera's face model is live, so it
 * must track the model, not just the mapping. */
function FaceChip() {
  const faceMapping = useControls((s) => s.faceMapping);
  // The open Lab measuring a face group claims it as a demand (#600 S16a), like the Trainer.
  const demanded = useDemandedGroups();
  const status = useFaceStatus((s) => s.status);
  const label = useFaceStatus((s) => s.label);
  if (faceMapping === 'none' && !demandWantsFace(demanded)) return null;

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
  // What M leaves sounding (#168 Q3, contributed since #600 S13: MIDI with its mute dial off keeps
  // the notes flowing to the DAW), named on the badge so it never says otherwise.
  const still = useControls((s) => stillSoundingNote(s as unknown as Readonly<Record<string, unknown>>));
  if (!muted) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-red-500/90 px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-white shadow-lg backdrop-blur">
      <VolumeX className="h-3.5 w-3.5" />
      Muted — press M to unmute{still}
    </div>
  );
}

/** Why the instrument is quiet without the player having muted it: an open tool holds the
 * room (the Trainer; a tool's `hushes` names the reason, #600 S16c), or an extension's music
 * plays (the conductor's score: its `hushes`; see `hushOf` in store-controls). Shown only when not
 * muted, so the two cues never stack; quieter than MutedBadge because nothing is wrong and nothing
 * needs doing — it lifts by itself. */
/** The tools whose open panel hushes the instrument (`Tool.hushes`). */
const HUSHING_TOOLS = SHELL_TOOLS.filter((t) => t.hushes);

function HushBadge() {
  const muted = useControls((s) => s.muted);
  const why = useControls((s) => hushReason(s as unknown as Readonly<Record<string, unknown>> & { hushedBy: readonly string[] }, { tools: HUSHING_TOOLS, hushes: CONTRIBUTIONS.hushes }));
  if (muted || !why) return null;
  return (
    <div data-hush-badge className="pointer-events-none absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-white/70 backdrop-blur">
      <VolumeX className="h-3 w-3" />
      Instrument quiet {why}
    </div>
  );
}

export default function App({
  source = DEFAULT_SOURCE,
  slots = NO_SLOTS,
}: {
  source?: SourceSpec;
  /** Developer-facing node-swap selection (`?slot.<name>=<type>`); see `graph.ts`. */
  slots?: SlotSelection;
}) {
  const { videoRef, canvasRef, status, error, audioOn, startAudio, recording } =
    useThoreminEngine(source, slots);
  // The take cluster publishes its height, so the Instruments panel ends above it however
  // many rows it wraps to (it wraps to two on a small phone).
  const takeClusterRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => publishHeight(takeClusterRef.current, TAKE_CLUSTER_HEIGHT_VAR), []);

  // #90: install the keyboard shortcuts (octave / magnetism / mute) — an app-level
  // tinykeys keymap dispatching dial commands, replacing the retired in-DAG switch.
  useEffect(() => installKeyboardShortcuts(), []);
  // #92: install the MODAL tag-toggle keymap (1..9 / 0) — inert unless tagging mode
  // is on, so it never shadows other digit bindings.
  useEffect(() => installTaggingKeymap(), []);
  // #257: the recording host the `recording.*` commands act on (the config store and the
  // folder), installed here rather than as a side effect of importing the store.
  useEffect(() => installRecording(), []);
  // #186: the body routes claim the feature groups they read, so a configured route
  // is fed even with the Lab closed (the groups are computed only on demand).
  // The extensions' mount effects (the air instruments': the flute's breath demand, the
  // vocabulary loads, the fingering-prior sync, the drum-pattern sync), each with its cleanup.
  useEffect(() => {
    const cleanups = UI_CONTRIBUTIONS.mountEffects.map((effect) => effect());
    return () => {
      for (const c of cleanups) if (typeof c === 'function') c();
    };
  }, []);

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
      {/* The camera status line (the timing resource's readout, step 0 of the timing
          plan): delivered fps, capture stamps, the frame's age, the audio output stage,
          and the warnings that need the player ("audio interrupted: tap to resume"). */}
      <TimingChip />

      {/* Top-center: unmissable "muted" cue (audio silenced by the m key). */}
      <MutedBadge />
      <HushBadge />

      {/* Bottom-left: the tools bar — the Tools launcher (every registered shell tool,
          labelled and described) and a button per pinned tool (Round 4, #271). This is
          the app's answer to "what else is here": a tool with no entry point here is a
          tool nobody will ever find (#136). */}
      <ToolsBar />
      <ToolsLauncher />

      {/* The gesture-binding editor (#129) — renders when its tool is the open one. */}
      <GesturesPanel />

      {/* An extension's tools (#330): the shell's frame, the extension's content, loaded on open. */}
      <ExtensionToolPanels />

      {/* Live annotations (#92): the in-take button stack (left edge) and the centered
          lead-in countdown. Their launcher pill is in the take cluster below. */}
      {status === 'ready' && <TaggingControls />}

      {/* Top-right: the instruments surface (the list + the per-instrument editor). */}
      <InstrumentsPanel />

      {/* Bottom-right: the TAKE CLUSTER (Round 4, #271) — the two controls a player uses
          during a take, together. Annotations (#92; available once the engine is ready;
          an annotation tapped during a recording is written into the take) and the
          multi-stream recorder (#88; a button that morphs into a settings sheet then a
          compact HUD, once audio is running). z-50: a sheet either opens grows up over
          the Instruments panel, the surface the player just asked for on top. Its width
          stops short of the Tools button (9rem from the left), wrapping to a second row
          on a narrow phone rather than covering the only bar entry there. */}
      <div
        ref={takeClusterRef}
        data-take-cluster
        className="absolute bottom-3 right-3 z-50 flex max-w-[calc(100vw-9rem)] flex-wrap items-end justify-end gap-2"
      >
        {status === 'ready' && <AnnotationsButton />}
        {audioOn && <RecordButton recording={recording} />}
      </div>

      {/* Center: prominent call-to-action until audio is running (the browser
          requires a user gesture to start audio). Centred in the space the Instruments
          panel leaves (its live width, `--instruments-w`): centred on the screen, it sat on
          the gallery's cards at 1280px. At least 16rem is kept for it on a narrow screen. */}
      {status === 'ready' && !audioOn && (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 flex items-center justify-center"
          style={{ right: 'min(calc(var(--instruments-w, 0px) + 1.5rem), calc(100vw - 16rem))' }}
        >
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
          registry, behind a BYO-key multi-provider client-side backend (#87 Phase 3).
          A registered tool: it renders when opened from the Tools launcher or its pin. */}
      <AssistantOverlay />
    </div>
  );
}
