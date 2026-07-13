/**
 * SessionRecorder (#88) — the multi-stream recording orchestrator. Given the
 * live host resources (AudioContext + master bus, the composited canvas, the
 * webcam, the running Engine) and a validated {@link RecordingSession}, it spins
 * up one `MediaRecorder` per selected media stream (the API can't multiplex
 * several tracks of one kind), attaches a feature-JSONL tap to the engine, shares
 * one `t0`/clock across all of them, and on stop converts the audio, writes every
 * file + a `manifest.json` through a {@link RecordingSink}, and cleans up.
 *
 * The naming/what-files logic is the pure {@link planRecording}; this module only
 * does the browser capture + wiring, so it is intentionally kept thin and is
 * covered by the app's build (not the Node strict typecheck), like `useEngine`.
 */
import type { Engine } from '@/dag';
import { recordingFormat, convertAudioFormats, type ConvertedFormat } from './formats';
import { recordingStem, prefillName } from './naming';
import { planRecording, audioFormatIds, type RecordingPlan, type PlannedFile } from './plan';
import { buildManifest, serializeManifest, type RecordingStreamEntry } from './manifest';
import { detectCaps, chooseSinkKind, pickAudioMime, pickVideoMime, pickAlphaMime } from './caps';
import { createRecordingSink, type RecordingSink, type SinkResult } from './sink';
import { FeatureJsonlTap } from './featureTap';
import { saveBlob } from './save';
import { hasAnyStream, type RecordingSession } from './schema';
import type { TagStreamSource } from './tagStream';

/** Chunk media into ~2s slices so long takes stay constant-memory (#88 §1). */
const TIMESLICE_MS = 2000;

/** What a finished take produced: the sink's result plus any output format whose
 * encoder failed. A failed format writes NO file (see {@link convertAudioFormats}),
 * so the UI must say so rather than toast an unqualified "Saved" (#130). */
export interface RecordingResult extends SinkResult {
  /** Ids of the selected audio formats that could not be encoded. Empty on a
   * clean take. */
  failedFormats: string[];
}

export interface SessionRecorderDeps {
  audioContext: AudioContext;
  /** Master-bus node to tap for audio (still reaches the speakers). */
  masterGain: AudioNode;
  /** The composited overlay canvas (webcam + overlays). */
  canvas: HTMLCanvasElement;
  /** The webcam/file `<video>` element (origin-blind pure-video capture). */
  video: HTMLVideoElement;
  /** The raw camera MediaStream if available (preferred pure-video source). */
  cameraStream: MediaStream | null;
  /** The running engine (for live feature tapping). */
  engine: Engine;
  /** The engine resources bag (to inject the transparent overlay canvas). */
  resources: Record<string, unknown>;
  /** Active instrument/sound id, for the manifest. */
  instrument?: string;
  /** Live-annotation source (#92): when active, writes a `.annotations.jsonl` stream into the
   *  folder on the shared `t0`. Absent = no tagging. */
  tagSource?: TagStreamSource;
}

interface Rec {
  recorder: MediaRecorder;
  chunks: Blob[];
  mime: string;
}

function startRec(stream: MediaStream, mime: string): Rec {
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start(TIMESLICE_MS);
  return { recorder, chunks, mime };
}

function stopRec(rec: Rec): Promise<Blob> {
  return new Promise((resolve) => {
    if (rec.recorder.state === 'inactive') {
      resolve(new Blob(rec.chunks, { type: rec.mime }));
      return;
    }
    rec.recorder.onstop = () => resolve(new Blob(rec.chunks, { type: rec.mime }));
    rec.recorder.stop();
  });
}

/** The raw (overlay-free) video stream for the pure-webcam file: prefer the raw
 * camera stream; else capture the `<video>` element (origin-blind, also covers the
 * pre-recorded ?source=video case). `owned` is false for the shared camera stream
 * (its tracks are the LIVE feed and must NOT be stopped when the take ends) and
 * true for a capture stream we created (and must stop). Null if neither exists. */
function rawVideoStream(
  video: HTMLVideoElement,
  cameraStream: MediaStream | null,
): { stream: MediaStream; owned: boolean } | null {
  if (cameraStream && cameraStream.getVideoTracks().length) return { stream: cameraStream, owned: false };
  const v = video as HTMLVideoElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };
  const capture = v.captureStream?.bind(v) ?? v.mozCaptureStream?.bind(v);
  return capture ? { stream: capture(), owned: true } : null;
}

/** Human labels for the active streams, for the recording HUD. */
export function activeStreamLabels(session: RecordingSession): string[] {
  const s = session.streams;
  const out: string[] = [];
  if (s.audio) out.push('audio');
  if (s.overlayVideo) out.push('overlay');
  if (s.pureVideo) out.push('camera');
  if (s.overlayAlpha) out.push('alpha');
  if (s.features) out.push('features');
  return out;
}

export class SessionRecorder {
  private readonly deps: SessionRecorderDeps;
  private readonly session: RecordingSession;

  private audioDest: MediaStreamAudioDestinationNode | null = null;
  private audioRec: Rec | null = null;
  private overlayRec: Rec | null = null;
  private pureRec: Rec | null = null;
  private alphaRec: Rec | null = null;
  private alphaCanvas: HTMLCanvasElement | null = null;
  private tap: FeatureJsonlTap | null = null;
  private detachTap: (() => void) | null = null;
  /** Capture streams WE created (canvas/alpha/element capture) — their tracks must
   * be stopped on teardown. Never includes the shared live camera stream. */
  private ownedStreams: MediaStream[] = [];
  /** Set if a bare single-file save was dismissed (so stop() reports cancellation
   * instead of a false "saved"). */
  private lastSaveCancelled = false;

  private plan!: RecordingPlan;
  private sink: RecordingSink | null = null;
  private audioMime = '';
  private videoMime = '';
  private alphaMime: string | null = null;
  private stem = '';
  private startedAt = '';
  private t0 = 0;
  private startPerf = 0;
  private running = false;
  /** Whether this take is writing a `.annotations.jsonl` (#92) — set at start from the annotation
   *  source's `active()`, so plan/stop stay in agreement. */
  private annotationsActive = false;

  constructor(deps: SessionRecorderDeps, session: RecordingSession) {
    this.deps = deps;
    this.session = session;
  }

  get recording(): boolean {
    return this.running;
  }

  get elapsedMs(): number {
    return this.running ? performance.now() - this.startPerf : 0;
  }

  get activeStreams(): string[] {
    return activeStreamLabels(this.session);
  }

  /**
   * Begin capture. Negotiates MIME types, plans the files, acquires the sink
   * (which may prompt for a folder), then starts every selected recorder on a
   * shared clock. Throws if no stream is selected.
   */
  async start(): Promise<void> {
    if (this.running) return;
    // Annotations are a COMPANION stream: annotations.jsonl segments the OTHER streams on the
    // shared t0, so a take needs at least one capturable media/feature stream to tag
    // (an annotations-only take would reference streams that don't exist). Hence the guard is
    // on hasAnyStream, deliberately not counting annotations.
    if (!hasAnyStream(this.session.streams)) throw new Error('No streams selected to record');
    const { audioContext, masterGain, canvas, video, cameraStream, engine, resources } = this.deps;
    const s = this.session.streams;

    this.audioMime = pickAudioMime();
    this.videoMime = pickVideoMime();
    this.alphaMime = pickAlphaMime();

    const name = this.session.name.trim()
      ? recordingStem(this.session.name)
      : prefillName({ instrument: this.deps.instrument ?? 'thoremin', date: new Date() });
    this.stem = name;

    // Live tagging (#92): if the tag source is active, this take writes a
    // `.annotations.jsonl` (which also forces folder mode — an annotation log needs the manifest).
    this.annotationsActive = this.deps.tagSource?.active() === true;

    this.plan = planRecording({
      session: this.session,
      stem: this.stem,
      audioMime: this.audioMime,
      videoMime: this.videoMime,
      alphaMime: this.alphaMime ?? undefined,
      includeAnnotations: this.annotationsActive,
    });

    // A folder take goes through a sink (dir/zip); the single-file escape hatch
    // saves one bare blob directly on stop, so it needs no sink (and no folder
    // prompt). Acquire the sink up-front so a directory prompt appears at start.
    if (this.plan.useFolder) {
      const kind = chooseSinkKind(this.session.location, detectCaps());
      this.sink = await createRecordingSink(kind, this.plan.folderName);
    }

    // Shared audio tap: needed by the audio stream and by overlay-video (which
    // muxes the synth audio) and optionally the pure-video stream.
    const needAudioTap = s.audio || s.overlayVideo || (s.pureVideo && s.pureVideoAudio);
    if (needAudioTap) {
      this.audioDest = audioContext.createMediaStreamDestination();
      masterGain.connect(this.audioDest);
    }
    const audioTracks = this.audioDest ? this.audioDest.stream.getAudioTracks() : [];

    this.startedAt = new Date().toISOString();
    this.startPerf = performance.now();
    // t0 is the alignment origin every stream's JSONL `t` is relative to (the
    // manifest SSOT). The feature tap records ctx.time, which the engine drives
    // from performance.now()/1000 (useEngine's rAF loop) — so t0 MUST be on that
    // same clock, NOT audioContext.currentTime (a different origin), or `t - t0`
    // would be skewed by the whole page-load→audio-start gap.
    this.t0 = this.startPerf / 1000;

    if (s.audio && this.audioDest) {
      this.audioRec = startRec(this.audioDest.stream, this.audioMime);
    }
    if (s.overlayVideo) {
      const canvasStream = canvas.captureStream(this.session.fps);
      this.ownedStreams.push(canvasStream);
      const muxed = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
      this.overlayRec = startRec(muxed, this.videoMime);
    }
    if (s.pureVideo) {
      const raw = rawVideoStream(video, cameraStream);
      if (raw) {
        const tracks = [...raw.stream.getVideoTracks()];
        if (s.pureVideoAudio) tracks.push(...audioTracks);
        if (raw.owned) this.ownedStreams.push(raw.stream);
        this.pureRec = startRec(new MediaStream(tracks), this.videoMime);
      }
    }
    if (s.overlayAlpha && this.alphaMime) {
      // A dedicated transparent canvas the overlay node draws to (backdrop
      // suppressed) — injected via resources so the node redraws onto it each tick.
      const ac = document.createElement('canvas');
      ac.width = canvas.width;
      ac.height = canvas.height;
      this.alphaCanvas = ac;
      resources.overlayAlphaCanvas = ac;
      const alphaStream = ac.captureStream(this.session.fps);
      this.ownedStreams.push(alphaStream);
      this.alphaRec = startRec(alphaStream, this.alphaMime);
    }
    if (s.features) {
      this.tap = new FeatureJsonlTap(this.session.streams.featureEdges);
      this.detachTap = engine.addTap(this.tap);
    }

    // If every selected stream turned out to be uncapturable here (e.g. an
    // alpha-only session reopened on a non-Chromium browser, or pure-video with no
    // reachable camera), fail fast instead of "saving" an empty folder.
    if (!this.audioRec && !this.overlayRec && !this.pureRec && !this.alphaRec && !this.tap) {
      throw new Error('None of the selected streams can be captured in this browser');
    }

    // Begin the tag take on the SAME t0 the media/feature streams share, so the
    // `.annotations.jsonl` events share the absolute engine clock and line up frame-accurately (#92 §5).
    // Done last, once capture is committed, so a fail-fast above never leaves the
    // tagging runtime with a dangling take.
    if (this.annotationsActive) {
      this.deps.tagSource!.beginTake({ t0: this.t0, startedAt: this.startedAt, session: this.stem });
    }

    this.running = true;
  }

  /**
   * Stop every recorder, convert audio to the selected formats, write all files +
   * the manifest through the sink (or save one bare file), and clean up. Returns
   * the sink result (plus any format that failed to encode) for the "saved …" toast.
   */
  async stop(): Promise<RecordingResult> {
    if (!this.running) throw new Error('Not recording');
    this.running = false;

    // The take's end on the ABSOLUTE engine clock (the same frame tag/feature events
    // are stamped in), captured now at stop-request so still-open annotations close at the
    // true take end (#92).
    const endEngineT = performance.now() / 1000;

    // Detach the feature tap AND freeze the tag log at the SAME instant, so neither
    // stream keeps recording input during the (possibly seconds-long) async
    // stop/convert window below. endTake closes still-open annotations at endEngineT and
    // returns the anchored JSONL; the file loop just writes it.
    this.detachTap?.();
    this.detachTap = null;
    const annotationsJsonl = this.annotationsActive ? (this.deps.tagSource?.endTake(endEngineT) ?? '') : '';

    const [audioBlob, overlayBlob, pureBlob, alphaBlob] = await Promise.all([
      this.audioRec ? stopRec(this.audioRec) : Promise.resolve(null),
      this.overlayRec ? stopRec(this.overlayRec) : Promise.resolve(null),
      this.pureRec ? stopRec(this.pureRec) : Promise.resolve(null),
      this.alphaRec ? stopRec(this.alphaRec) : Promise.resolve(null),
    ]);

    // Release the master-bus tap, the transparent overlay canvas, and every
    // capture stream we created (but never the shared live camera stream).
    if (this.audioDest) {
      try {
        this.deps.masterGain.disconnect(this.audioDest);
      } catch {
        /* already disconnected */
      }
    }
    if (this.alphaCanvas) delete this.deps.resources.overlayAlphaCanvas;
    this.stopOwnedStreams();

    // Convert audio to each selected format (decode once if any needs it). A format
    // whose encoder failed comes back with a null blob: no file is written for it and
    // its id is reported, rather than saving the un-encoded audio under that extension.
    const audioOutputs = audioBlob ? await this.convertAudio(audioBlob) : [];
    const failedFormats = audioOutputs.filter((o) => !o.blob).map((o) => o.id);

    // Map plan files → captured bytes and write them.
    const written: RecordingStreamEntry[] = [];
    let audioIdx = 0;
    const putFile = async (file: PlannedFile, data: Blob | string) => {
      await this.writeFile(file.name, data);
      if (file.kind !== 'manifest')
        written.push({ file: file.name, kind: file.kind, mime: file.mime, fps: file.fps });
    };

    for (const file of this.plan.files) {
      switch (file.kind) {
        case 'audio': {
          // Positional, so a failed format leaves ITS slot empty without shifting
          // the others (convertAudioFormats keeps the ids' order).
          const out = audioOutputs[audioIdx++];
          if (out?.blob) await putFile(file, out.blob);
          break;
        }
        case 'overlayVideo':
          if (overlayBlob) await putFile(file, overlayBlob);
          break;
        case 'pureVideo':
          if (pureBlob) await putFile(file, pureBlob);
          break;
        case 'overlayAlpha':
          if (alphaBlob) await putFile(file, alphaBlob);
          break;
        case 'features':
          await putFile(file, this.tap?.drain() ?? '');
          break;
        case 'annotations':
          // The tag log was already closed + drained above (symmetric with the tap).
          await putFile(file, annotationsJsonl);
          break;
        case 'manifest': {
          const manifest = buildManifest({
            startedAt: this.startedAt,
            t0: this.t0,
            stem: this.stem,
            instrument: this.deps.instrument,
            streams: written,
          });
          await this.writeFile(file.name, serializeManifest(manifest));
          break;
        }
      }
    }

    this.tap = null;

    if (this.sink) return { ...(await this.sink.close()), failedFormats };
    // Single-file escape hatch: exactly one bare file was written via saveBlob in
    // writeFile; report it (honoring a dismissed Save-As dialog as a cancellation
    // rather than a false success). If that single file was the one format that
    // failed to encode, nothing was written at all — say so.
    const only = this.plan.files[0];
    const wrote = !this.lastSaveCancelled && failedFormats.length === 0;
    return {
      label: only?.name ?? this.stem,
      count: wrote ? 1 : 0,
      viaPicker: false,
      cancelled: this.lastSaveCancelled,
      failedFormats,
    };
  }

  /** Write one file: through the sink (folder mode) or directly via saveBlob
   * (single-file mode). */
  private async writeFile(name: string, data: Blob | string): Promise<void> {
    if (this.sink) {
      await this.sink.add(name, data);
      return;
    }
    const blob =
      typeof data === 'string' ? new Blob([data], { type: 'application/octet-stream' }) : data;
    // saveBlob returns null when the user dismisses the Save-As dialog — record it
    // so stop() reports a cancellation instead of a phantom "Saved".
    const res = await saveBlob(blob, name);
    if (res === null) this.lastSaveCancelled = true;
  }

  /**
   * Convert the native audio blob to each selected output format, decoding once if
   * any format needs it. Returns one outcome per format in the SAME order as the
   * plan's audio files (= `audioFormatIds` order).
   *
   * A format that fails (its lazy encoder would not load, or would not encode this
   * audio) comes back with a null blob. It is NOT filled in with the native WebM:
   * a `.mp3` holding WebM bytes is a file the player only discovers is broken much
   * later, so the take reports the failure instead (#130).
   */
  private async convertAudio(native: Blob): Promise<ConvertedFormat[]> {
    const effectiveIds = audioFormatIds(this.session);
    let audio: AudioBuffer | null = null;
    if (effectiveIds.some((id) => recordingFormat(id)?.needsDecode)) {
      try {
        audio = await this.deps.audioContext.decodeAudioData(await native.arrayBuffer());
      } catch (e) {
        console.error('[thoremin] could not decode recording for conversion', e);
      }
    }
    const converted = await convertAudioFormats(effectiveIds, { native, audio });
    for (const c of converted) {
      if (!c.blob) console.error(`[thoremin] failed to convert recording to ${c.id}`, c.error);
    }
    return converted;
  }

  /** Stop the tracks of every capture stream we created (canvas/alpha/element
   * capture). The shared live camera stream is deliberately excluded. */
  private stopOwnedStreams(): void {
    for (const stream of this.ownedStreams) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* already stopped */
        }
      }
    }
    this.ownedStreams = [];
  }

  /** Best-effort teardown if a take is abandoned without a clean stop. */
  dispose(): void {
    this.detachTap?.();
    this.detachTap = null;
    // Release the tagging runtime's take context so a dropped/aborted recording
    // doesn't leave it stuck "recording" (endTake is a no-op if already ended).
    // `abandoned`: this take wrote NO media files, so it must not displace the last
    // cleanly-stopped take's export unless it actually captured annotations itself.
    if (this.annotationsActive) {
      try {
        this.deps.tagSource?.endTake(performance.now() / 1000, { abandoned: true });
      } catch {
        /* runtime already reset */
      }
      this.annotationsActive = false;
    }
    for (const rec of [this.audioRec, this.overlayRec, this.pureRec, this.alphaRec]) {
      try {
        if (rec && rec.recorder.state !== 'inactive') rec.recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    if (this.audioDest) {
      try {
        this.deps.masterGain.disconnect(this.audioDest);
      } catch {
        /* already disconnected */
      }
    }
    if (this.alphaCanvas) delete this.deps.resources.overlayAlphaCanvas;
    this.stopOwnedStreams();
    this.running = false;
  }
}
