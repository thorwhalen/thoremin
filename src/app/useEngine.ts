/**
 * useThoreminEngine — the React ↔ DAG bridge. Owns the webcam, the AudioContext
 * (created lazily on a user gesture, as browsers require), builds the graph
 * against the browser registry, runs `engine.init()` (loads the ML model) and
 * drives `engine.tick()` from a {@link Clock}. The engine and its nodes do the
 * real work; this hook just supplies host resources and timing.
 *
 * Two seams the hook deliberately does NOT own:
 *  - **Pacing, outputs and teardown** are an `Applier` (`packages/dag/src/applier.ts`): a
 *    `RealtimeClock`, the React bridges as sinks, `disposed` as the stop condition.
 *    The hook used to hand-roll its own rAF recursion, which left the shipped
 *    `RealtimeClock` exercised only by unit tests while players ran other code.
 *  - **Which graph** comes from a {@link SlotSelection}. A change to it re-wires
 *    the LIVE engine via `Engine.applyGraph` — it does not rebuild the engine,
 *    so the camera is not re-acquired and the ML models are not reloaded.
 *
 * And three pieces it binds but no longer holds (#392), each testable without mounting it: what
 * the live graph is and how a running engine is re-wired onto it (`./liveApply`), the per-frame
 * status reporters (`makeFaceReporter` and its siblings, beside their stores), and the take's
 * lifecycle (`./recording/useRecordingController`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Applier, Engine, RealtimeClock } from '@thoremin/dag';
import { createAppRegistry } from '@/nodes/browser';
import { HAND_COUNT_RESOURCE_KEY, HAND_RUNNER_RESOURCE_KEY } from '@/nodes/sources/webcam_hands';
import { slotSelectionKey, sourceNeedsVideo, NO_SLOTS, type SlotSelection } from './graph';
import { branchSetKey } from '@/instruments/derive';
import { useDemandedGroups } from './useDemandedGroups';
import type { NodeRegistry } from '@thoremin/dag';
import { DEFAULT_SOURCE, type SourceSpec } from './sourceSpec';
import { useControls } from './store';
import { LiveVectorTap, resetLiveVector } from './enroll/liveVector';
import { provideCamera } from '@thoremin/sdk-ui/host';
import { featureDemandResource } from '@thoremin/sdk-ui/featureDemand';
import { trainerHudResource } from './enroll/hud';
import { useRecordingController } from './recording/useRecordingController';
import { tagOverlayResource } from './tagging/runtime';
import { useFaceStatus, makeFaceReporter } from './faceStatus';
import { useMidiStatus, makeMidiReporter } from './midiStatus';
import { useGenerativeStatus, makeGenerativeReporter, ABSENT_GENERATIVE_STATUS, GENERATIVE_NODE_ID } from './generativeStatus';
import { installDebugHandle } from './debugHandle';
import { latencyProbeRequested } from '@/latency/param';
import { createTimingResource } from './timing/resource';
import { TIMING_RESOURCE_KEY } from '@thoremin/sdk/timing/tracker';
import { useTimingStatus, makeTimingReporter } from './timingStatus';
import { useConductorStatus, makeConductorReporter, ABSENT_CONDUCTOR_LIVE, CONDUCTOR_NODE_ID } from './conductorStatus';
import { makeLeadCalibrationSink } from './conductorLead';
import type { BodySide } from '@/nodes/features/conductor_body';
import { useOrchestraStatus, makeOrchestraReporter, ABSENT_ORCHESTRA_STATUS, ORCHESTRA_NODE_ID } from './orchestraStatus';
import { useSongStatus, makeSongReporter } from './songStatus';
import { extensionStatusHooks, makeExtensionSinks } from './extensions';
import { ensureLazyTypes } from './extensionLoad';
import { composeLoaded } from './lazyApply';
import { applyLive, currentBranchKey, lazyDeps, liveBranchIds, liveGraph, liveHandCount } from './liveApply';
import { useGestureStatus, makeGestureReporter } from './gestureStatus';
import { createGestureDispatcher } from './gestureDispatch';
import { createCategoryDispatcher, resetCategoryLive } from './enroll/categoryDispatch';
import { installCategoryDemand, useCategoryBinding } from './enroll/categoryBinding';
import { cameraConstraints } from './camera';
import { latencyHintFor, noteLatencyHintInEffect } from './timing/audioPrefs';

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Max wait (ms) for a file source to deliver metadata before we give up. A URL
 * that returns 200 but never delivers a playable stream (hung CDN, truncated
 * moov atom) fires neither `loadedmetadata` nor `error`, so without this the
 * view would wedge on "loading" forever. Applied to the file path only — the
 * camera keeps its original settle behavior.
 */
const VIDEO_LOAD_TIMEOUT_MS = 15000;

/** The recording phase, re-exported from its owner for existing importers. */
export type { RecordingPhase } from './recording/useRecordingController';

/** The status stores that mirror a branch node, by node id; reset when the node leaves. */
function resetStatusesOf(removed: readonly string[]): void {
  for (const id of removed) {
    for (const hook of extensionStatusHooks()) if (hook.nodeId === id) hook.onRemoved();
    if (id === GENERATIVE_NODE_ID) useGenerativeStatus.getState().report(ABSENT_GENERATIVE_STATUS);
    else if (id === CONDUCTOR_NODE_ID) useConductorStatus.getState().report(ABSENT_CONDUCTOR_LIVE);
    else if (id === ORCHESTRA_NODE_ID) useOrchestraStatus.getState().report(ABSENT_ORCHESTRA_STATUS);
  }
}

export function useThoreminEngine(source: SourceSpec = DEFAULT_SOURCE, slots: SlotSelection = NO_SLOTS) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const resourcesRef = useRef<Record<string, unknown>>({});
  /** The live Applier, so cleanup can release it (and its taps) on unmount. */
  const applierRef = useRef<Applier | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  // The raw camera MediaStream (camera source only), kept reachable for the
  // pure-webcam recording stream (#88); null for a file source.
  const cameraStreamRef = useRef<MediaStream | null>(null);
  // The extension SDK's camera seam (#330): a tool (the face categorizer session) records the
  // same raw stream, read at use time, and never owns or stops it.
  useEffect(() => {
    provideCamera({ stream: () => cameraStreamRef.current });
    return () => provideCamera(null);
  }, []);
  // The registry the live engine was built against — `applyGraph` must resolve
  // node types against the SAME one, or a swap would compare against a different
  // set of definitions than the running graph was validated with.
  const registryRef = useRef<ReturnType<typeof createAppRegistry> | null>(null);

  const [status, setStatus] = useState<EngineStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [audioOn, setAudioOn] = useState(false);
  // The take's lifecycle (#88, #163): the Record button's and the trainer's one start/stop,
  // reading the host resources below through their refs when a take starts.
  const { recording, releaseTake } = useRecordingController({
    resources: resourcesRef,
    masterGain: masterGainRef,
    canvas: canvasRef,
    video: videoRef,
    engine: engineRef,
    cameraStream: cameraStreamRef,
  });

  const masterVolume = useControls((s) => s.masterVolume);
  const muted = useControls((s) => s.muted);

  // The slot selection is read through a ref inside the (source-keyed) build
  // effect, so a selection that changes while the engine is still booting is
  // still the one it gets built with; `slotsKey` drives the live re-wire below.
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const slotsKey = slotSelectionKey(slots);
  // The branch SET the current dials and demand imply, as a key: it changes on an
  // instrument switch, on a dial that adds or drops a capability, and on a tool's claim.
  // Unrelated dial edits leave it alone, so the re-apply effect below never fires for them.
  const demanded = useDemandedGroups();
  const branchKey = useControls((s) => branchSetKey(liveBranchIds(s, demanded)));
  // How many hands the hand model looks for (#325), read by `webcam-hands` through the
  // `handCount` resource on each frame; a change reconfigures the live model, never the graph.
  const handCount = useControls((s) => liveHandCount(s, demanded));
  const handCountRef = useRef(handCount);
  handCountRef.current = handCount;

  /** Re-wire the LIVE engine onto the current slots and branch set (`./liveApply`). The refs
   *  are read when the graph is composed and committed, so every caller passes the same ones. */
  const rewire = (engine: Engine, registry: NodeRegistry) =>
    applyLive(engine, { selection: () => slotsRef.current, registry, live: () => engineRef.current, onRemoved: resetStatusesOf });

  useEffect(() => {
    let disposed = false;
    let uninstallDebug: () => void = () => {};
    let uninstallLatency: () => void = () => {};
    let uninstallCategoryDemand: () => void = () => {};
    let timing: ReturnType<typeof createTimingResource> | null = null;
    // The acquired stream is held here (not read back off video.srcObject) so
    // cleanup can always stop the exact stream this run acquired. Under React
    // StrictMode the effect runs mount→cleanup→mount; an aborted run must stop
    // its own stream and bail *before* building an engine (no leaked camera, no
    // double model load, no clobbered engineRef).
    let stream: MediaStream | null = null;
    (async () => {
      try {
        setStatus('loading');
        const video = videoRef.current!;
        // The registry is built first because the SOURCE SLOT decides whether the
        // host has anything to acquire at all. A finished-frame source (replay /
        // synthetic) produces its own frames and reads no video, so asking for a
        // camera would be asking for hardware the run does not use — and on a
        // machine without one it would fail the whole boot before the engine was
        // ever constructed.
        const registry = createAppRegistry();
        registryRef.current = registry;
        // A restored instrument that plays a lazy extension: start fetching its code now, beside
        // the camera and the hand model; the build below awaits the same (shared) load.
        const prefetch = registry.pending(liveGraph(slotsRef.current, registry).spec.nodes.map((n) => n.type));
        if (prefetch.length) void ensureLazyTypes(registry, prefetch).catch(() => undefined);
        const needsVideo = sourceNeedsVideo(slotsRef.current, registry);
        if (!needsVideo && source.kind === 'camera') {
          // Camera-free: leave the <video> element empty. Every reader of
          // `resources.video` guards on `readyState` (the overlay backdrop skips
          // the draw; the face branch never downloads its model without frames),
          // so nothing needs to know the difference.
        } else if (source.kind === 'video') {
          // Camera-free (Stream Applier M-A): play a pre-recorded clip into the
          // same <video> the webcam would fill, so the overlays + palette run
          // with no camera. The webcam-hands/face nodes read ctx.resources.video
          // origin-blind and time their inference off performance.now(), so the
          // file path needs no node changes.
          //   loop  — REQUIRED: those nodes only run inference while
          //           video.currentTime advances, so a stopped clip freezes the
          //           overlay; looping keeps it live (the wrap costs one cosmetic
          //           position jump, not a MediaPipe error).
          //   muted — keeps autoplay allowed and frees the audio path for the
          //           synth (we never want the clip's own audio).
          //   crossOrigin — lets a CORS-enabled remote clip be read into the
          //           canvas/MediaPipe; a same-origin clip (public/) needs nothing.
          video.srcObject = null;
          video.crossOrigin = 'anonymous';
          video.loop = true;
          video.muted = true;
          video.src = source.url;
        } else {
          // 1280x720 16:9 at up to 60 fps, the front camera: why each, in
          // `camera.ts` (#240). All `ideal` soft constraints: the camera returns the
          // closest mode it supports and never fails.
          stream = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(), audio: false });
          if (disposed) {
            // Cleanup already ran (it saw stream === null), so stop it here.
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          video.srcObject = stream;
          // Expose the raw camera stream for the pure-webcam recording stream (#88).
          cameraStreamRef.current = stream;
        }
        // Nothing to wait for when there is no media: skip straight to building.
        if (needsVideo || source.kind === 'video') await new Promise<void>((resolve, reject) => {
          // File path only: a stalling clip fires neither event, so bound the
          // wait and surface a timeout. The camera path (timer === null) keeps
          // its original "settle only on metadata" behavior.
          const timer =
            source.kind === 'video'
              ? setTimeout(
                  () => reject(new Error(`Timed out loading video source: ${source.url}`)),
                  VIDEO_LOAD_TIMEOUT_MS,
                )
              : null;
          video.onloadedmetadata = () => {
            if (timer) clearTimeout(timer);
            void video.play();
            resolve();
          };
          // A bad clip URL (decode/CORS failure) surfaces as an error instead of
          // hanging; onerror covers *errors*, the timer above covers *stalls*.
          // The camera path effectively never fires either.
          video.onerror = () => {
            if (timer) clearTimeout(timer);
            reject(
              new Error(
                source.kind === 'video'
                  ? `Could not load video source: ${source.url}`
                  : 'Camera video element error',
              ),
            );
          };
        });
        if (disposed) return; // cleanup stops the stream / releases the clip

        // Size the canvas drawing buffer to the camera's native resolution so
        // the overlay renders at full sharpness (CSS object-cover then scales it
        // to fill the viewport). Landmarks normalize by the same video dims, so
        // the overlay stays aligned at any resolution.
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = video.videoWidth || 1280;
          canvas.height = video.videoHeight || 720;
        }

        const resources = resourcesRef.current;
        resources.video = video;
        resources.canvas = canvasRef.current;
        resources.window = window;
        resources.controls = () => useControls.getState();
        // Live tagging (#92): the burned-in corner HUD reads this each tick (null
        // unless a take is recording). Same synchronous-read pattern as `controls`.
        resources.tagOverlay = tagOverlayResource;
        // Trainer guidance on the video (#163): the overlay reads what the runner is
        // saying each tick; null unless a routine runs.
        resources.trainerHud = trainerHudResource;
        // Feature demand (#163): the vector nodes compute whatever a host consumer
        // (the trainer, while a cue runs) has claimed, even with the Lab closed.
        resources.featureDemand = featureDemandResource;
        // The timing resource (step 0 of the timing plan): the always-on lead budget the
        // instruments read each tick (the frame's age, the audio output stage with its
        // source, the audio epoch, the stamp mix). One owner: this host; nodes only read.
        timing = createTimingResource({ audio: () => resources.audioContext as AudioContext | undefined });
        timing.noteCamera(stream);
        resources[TIMING_RESOURCE_KEY] = () => timing!.reading();
        resources[HAND_COUNT_RESOURCE_KEY] = () => handCountRef.current;
        // Where the hand model runs (#326): `?hands.runner=main|worker|auto` overrides the
        // node's `runner` param, so both paths can be measured and compared on one machine.
        resources[HAND_RUNNER_RESOURCE_KEY] = new URLSearchParams(window.location.search).get('hands.runner') ?? undefined;

        // `defaultGraph` validates the selection against the registry and falls
        // back (with a warning) on anything that would not satisfy the slot
        // contract, so a stale URL can never produce an unbuildable graph.
        let builtKey = slotSelectionKey(slotsRef.current);
        let builtBranchKey = currentBranchKey();
        // A lazy extension the restored instrument plays is loaded (prefetched above) before the
        // engine is built; its failure only leaves it out: never a dead start.
        const live = await composeLoaded(lazyDeps(() => slotsRef.current, registry, () => !disposed));
        if (disposed || live === null) return;
        // The first graph has no predecessor, so its element set is written at once.
        useControls.getState().setGraphElements(live.elements);
        const engine = new Engine(live.spec, registry, { resources });

        // Trainer mode (#160) needs to see the same feature vector the Lab meters read.
        // Attached once, for the engine's whole life: it is one object spread per tick
        // into a module holder, and it is the only path by which the host can observe
        // the feature vector at all. `test/app_graph.test.ts` asserts the edges it names
        // still exist, so renaming a vector node fails the build rather than silently
        // starving the trainer.
        engine.addTap(new LiveVectorTap());
        engine.addTap(timing.tap);

        await engine.init(); // loads the MediaPipe model
        if (disposed) {
          engine.dispose();
          return;
        }
        engineRef.current = engine;
        // The read-only `window.thoremin` probe the browser smoke harness (and a person
        // at the devtools console) reads the live loop through (#209). Removed on teardown.
        uninstallDebug = installDebugHandle(engine, resources);
        // `?probe=latency` (#227): per-stage timings of this live loop, plus the
        // microphone strike test. Absent the parameter nothing is loaded or attached;
        // present, its `tickEnd` becomes the Applier's FIRST sink (below), so it closes
        // each tick's compute time before any bridge runs.
        let latencyTickEnd: (() => void) | null = null;
        if (latencyProbeRequested()) {
          const { installLatencyProbe } = await import('./latencyProbe');
          if (disposed) return;
          const probe = installLatencyProbe(engine, resources, { timing: () => timing?.reading() });
          uninstallLatency = probe.uninstall;
          latencyTickEnd = probe.tickEnd;
        }
        setStatus('ready');

        // The selection may have changed during the model load, while the
        // re-wire effect below had no engine to talk to yet. Reconcile once.
        // The selection or the branch set may have changed during the model load (an
        // instrument pick, the restored session, a Trainer claim), while the re-wire effects
        // below had no engine to talk to yet. Reconcile once.
        if (slotSelectionKey(slotsRef.current) !== builtKey || currentBranchKey() !== builtBranchKey) {
          builtKey = slotSelectionKey(slotsRef.current);
          builtBranchKey = currentBranchKey();
          rewire(engine, registry);
        }

        // Bridge the face model's status + classified expression from the DAG
        // back to React for the indicator/readout (#65), throttled; a transition into
        // 'error' surfaces a toast once.
        const reportFace = makeFaceReporter(engine);
        // Bridge the midi-out node's status to React the same way (#137): the
        // settings panel renders the live device list + connection phase from it.
        const reportMidi = makeMidiReporter(engine);
        // Gesture dispatch (#129): the classifier's per-hand poses feed the dispatcher
        // (fresh timing state per engine run) every frame, which turns held-pose
        // TRANSITIONS into command dispatches; the status store is written only when a
        // pose CHANGES, so the Gestures panel never re-renders at frame rate.
        const gestureDispatcher = createGestureDispatcher();
        const reportGesture = makeGestureReporter(engine, gestureDispatcher);

        // Category dispatch (#160): the player's saved categories, classified over the
        // live feature vector (kept current by the LiveVectorTap above), fire their bound
        // commands on ENTRY. The demand claim keeps the model's feature groups computed
        // while binding is on; it is released on teardown.
        const categoryDispatcher = createCategoryDispatcher();
        uninstallCategoryDemand = installCategoryDemand();
        void useCategoryBinding.getState().load();
        const reportCategory = (now: number) => categoryDispatcher.tick(now);

        // Bridge the `lyria` node's status to React (#188), so the Generative settings
        // section can render an honest readout (loading / ready / playing / needs a
        // key). Change-gated inside the reporter, like the others.
        const reportGenerative = makeGenerativeReporter(engine);
        // Bridge the `conductor` node's musical time to React (#187), for the Conductor
        // tool panel's live readout. Change-gated inside the reporter, like the others.
        const reportConductor = makeConductorReporter(engine);
        // A 'Learn my timing' take (#427): the body frames against the click, while one runs.
        const reportLeadTake = makeLeadCalibrationSink(engine, () => (useControls.getState().conductor?.hand ?? 'auto') as BodySide);
        // The orchestra's load status (#187 PR 5), for the orchestra controls' readout.
        const reportOrchestra = makeOrchestraReporter(engine);
        // The song player's status and beat (#186 PR G), for the Song tool's readout; a song
        // that plays to its end turns the transport off, so the next Play starts it again.
        const reportSong = makeSongReporter(engine, useSongStatus.getState(), () => {
          if (useControls.getState().songPlaying) useControls.getState().setSongPlaying(false);
        });
        // The extensions' status hooks (the air instruments' readouts and live shapes):
        // built once per engine, run as sinks below, reset on removal and teardown.
        const extensionSinks = makeExtensionSinks(engine);

        // #101 M-D, live half: this effect is now an {@link Applier} config. Batch
        // (`runHeadless`) and paced (here) differ on **{clock, sinks, taps} jointly**,
        // which is exactly what the Applier's options express — a `RealtimeClock`, the
        // three React bridges as sinks, no taps (the recorder attaches its own when a
        // take starts), and `disposed` as the stop condition.
        //
        // The sinks were previously `runEngineLoop`'s "reporters". They are the same
        // functions, called at the same point (after a successful tick) — but now inside
        // the Applier's guard, so a bridge that throws is reported and the instrument
        // keeps playing instead of the rAF chain dying silently. `onError` is what makes
        // that the policy: with it supplied, `run()` does not reject and one bad frame
        // costs a frame, not the session.
        //
        // No `sources` are passed: the graph's frame emitters are ordinary zero-input
        // NODES (design invariant 4 — `webcam-hands` / `synthetic-hands` / `replay-hands`
        // fill the `source` slot), and the browser resources they read are host-owned and
        // already in `resourcesRef`. A host-side `Source` is for an origin the Applier
        // pumps itself, which nothing here is yet.
        //
        // (#90) Mute is a store flag toggled by the app-level keyboard handler
        // (the `m` key → toggleMuted) and flows INTO the graph via store-controls,
        // so there is no graph→store mute mirror in the loop.
        // UNITS. The bridges take MILLISECONDS (`reportGesture` feeds
        // `gestureDispatcher.tick`, whose dwell/hold/cooldown are in ms); a `Clock`
        // reports engine time in SECONDS. Converting here, once, at the boundary is the
        // same fix #164 made for the trainer's sampler, where passing seconds through
        // unconverted turned a 220 ms dwell into 220 s and nothing ever read as "held".
        // The `?? performance.now()/1000` mirrors what `runEngineLoop` did: a clock that
        // synthesises time passes none, and a bridge still needs a real stamp.
        const toMs = (report: (nowMs: number) => void) => (t: number | undefined) =>
          report((t ?? performance.now() / 1000) * 1000);

        // The timing resource's readout for the camera status line, paced and change-gated.
        const reportTiming = makeTimingReporter(() => timing!.reading());
        // The latency probe's tick-end stamp (if any) goes FIRST, before the bridges.
        const latencySinks = latencyTickEnd ? [latencyTickEnd] : [];
        const applier = new Applier({
          engine,
          clock: new RealtimeClock(),
          // No `resources` here: #192 made the Applier take them from the engine, so the
          // two can never be different objects. Passing one was harmless at runtime (it
          // was the same reference) but it was a type error nothing could see — see below.
          sinks: [...latencySinks, toMs(reportFace), toMs(reportMidi), toMs(reportGesture), toMs(reportCategory), toMs(reportGenerative), toMs(reportConductor), toMs(reportLeadTake), toMs(reportOrchestra), toMs(reportSong), toMs(reportTiming), toMs(extensionSinks)],
          shouldStop: () => disposed,
          onError: (err) => {
            // Same disposition `runEngineLoop` had: log and keep going. A degenerate
            // landmark or a transient audio state must not end the session.
            if (!disposed) console.error('[thoremin] engine frame failed', err);
          },
        });
        applierRef.current = applier;
        void applier.run();
      } catch (e) {
        if (disposed) return;
        console.error('[thoremin] engine setup failed', e);
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();

    return () => {
      // Setting `disposed` is what stops the loop: the clock polls it before
      // every frame, so an already-scheduled frame resolves without ticking.
      disposed = true;
      // Dispose the Applier before the engine: it detaches any tap it attached and
      // releases its sources, and it must not observe a disposed engine mid-teardown.
      applierRef.current?.dispose();
      applierRef.current = null;
      engineRef.current?.dispose();
      engineRef.current = null;
      registryRef.current = null;
      useFaceStatus.getState().reset();
      resetLiveVector();
      useMidiStatus.getState().reset();
      useGestureStatus.getState().reset();
      useGenerativeStatus.getState().reset();
      useConductorStatus.getState().reset();
      useOrchestraStatus.getState().reset();
      useSongStatus.getState().reset();
      useTimingStatus.getState().reset();
      for (const hook of extensionStatusHooks()) hook.reset();
      uninstallDebug();
      uninstallLatency();
      uninstallCategoryDemand();
      resetCategoryLive();
      timing?.dispose();
      timing = null;
      // A rebuilt engine must not auto-start a paid stream from a stale transport flag.
      useControls.getState().setSteerPlaying(false);
      // Nor start the song by itself on the next tap (#186 PR G): the new player has no
      // memory of the press that started the old one.
      useControls.getState().setSongPlaying(false);
      releaseTake();
      cameraStreamRef.current = null;
      stream?.getTracks().forEach((t) => t.stop());
      // Symmetric to stopping camera tracks: pause a file clip so an aborted
      // (StrictMode) or unmounted run stops decoding instead of playing on, and
      // drop its handlers so a stale rejecter can't fire if the source is ever
      // re-acquired (the effect deps allow it).
      const fileVideo = source.kind === 'video' ? videoRef.current : null;
      if (fileVideo) {
        fileVideo.pause();
        fileVideo.onloadedmetadata = null;
        fileVideo.onerror = null;
      }
      // Close the AudioContext so its nodes (master, recorder tap, voices) are
      // released instead of leaking one un-closed context per unmount.
      const ac = resourcesRef.current.audioContext as AudioContext | undefined;
      if (ac && ac.state !== 'closed') void ac.close().catch(() => {});
      resourcesRef.current.audioContext = undefined;
      masterGainRef.current = null;
    };
    // Primitive deps (not the SourceSpec object) so a stable selection doesn't
    // re-run the effect; a genuine source change tears down and re-acquires.
  }, [source.kind, source.kind === 'video' ? source.url : null]);

  // Re-wire the LIVE engine when the slot selection changes. Deliberately NOT a
  // dependency of the build effect above: rebuilding the engine would re-acquire
  // the camera and reload both MediaPipe models to change one node. `applyGraph`
  // keeps every unchanged node (#51), so a mapping swap is one node rebuilt and
  // the instrument keeps playing through it.
  //
  // On mount this finds no engine yet and no-ops — correct, because the build
  // effect reads the current selection through `slotsRef` when it constructs.
  useEffect(() => {
    const engine = engineRef.current;
    const registry = registryRef.current;
    if (!engine || !registry) return;
    rewire(engine, registry);
  }, [slotsKey]);

  // Re-wire the LIVE engine when the branch set changes (an instrument switch, a dial that
  // turns a capability on or off, a tool's feature demand). Same mechanism as the slot
  // swap: `applyGraph` keeps every node whose id, type and params are unchanged, so the
  // trunk (camera, hand model, synth, overlay) plays on and only the branch nodes come and
  // go. On mount this finds no engine yet and no-ops; the build effect composes the same
  // set itself. `applyGraph` serialises overlapping calls, so a burst of changes is safe.
  useEffect(() => {
    const engine = engineRef.current;
    const registry = registryRef.current;
    if (!engine || !registry) return;
    rewire(engine, registry);
  }, [branchKey]);

  // Keep master gain synced to the UI volume, and drop it to zero while muted.
  // This is the host-level catch-all mute (belt-and-suspenders with the in-graph
  // `synth-merge` mute), so ANY audio reaching the master bus — including a
  // non-graph producer like the Lyria plugin — goes silent too. The 50ms target
  // ramp makes both muting and unmuting click-free.
  useEffect(() => {
    const ac = resourcesRef.current.audioContext as AudioContext | undefined;
    if (masterGainRef.current && ac) {
      masterGainRef.current.gain.setTargetAtTime(muted ? 0 : masterVolume, ac.currentTime, 0.05);
    }
  }, [masterVolume, muted]);

  const startAudio = useCallback(async () => {
    const resources = resourcesRef.current;
    let ac = resources.audioContext as AudioContext | undefined;
    if (!ac) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      // The per-device low-latency pref (#240) asks for the smallest buffer; read once,
      // here, because a context's hint is fixed at creation.
      const latencyHint = latencyHintFor(useControls.getState().audioPrefs);
      ac = new Ctor({ latencyHint });
      noteLatencyHintInEffect(latencyHint);
      const master = ac.createGain();
      const { masterVolume: v0, muted: muted0 } = useControls.getState();
      master.gain.setValueAtTime(muted0 ? 0 : v0, ac.currentTime);
      master.connect(ac.destination);
      resources.audioContext = ac;
      resources.masterGain = master;
      masterGainRef.current = master;
    }
    if (ac.state === 'suspended') await ac.resume();
    // The SessionRecorder (#88) creates its own master-bus tap when a take starts,
    // so no persistent recorder is set up here — audio just needs to be running.
    setAudioOn(true);
  }, []);

  return {
    videoRef,
    canvasRef,
    status,
    error,
    audioOn,
    startAudio,
    recording,
  };
}
