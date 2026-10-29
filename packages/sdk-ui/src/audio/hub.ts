/**
 * The audio-input hub: the page's ONE microphone (or replayed file, or synthetic take), its one
 * AudioWorklet, and the consumers that share them (`docs/design/audio-input.md`).
 *
 * A consumer (the `audio-events` graph node, the sound mapper's teaching panel, a game's
 * calibration) calls {@link AudioInputHub.acquire} with the analysers it wants and gets a lease:
 * its own events (drained per tick, or listened to as they arrive), a way to message its
 * analysers, and `release`. The hub opens the input on the first lease and closes it on the
 * last, so a player who never uses a sound instrument never sees a permission prompt. Analyser
 * ids are namespaced per lease inside the worklet, so two consumers may both run an `onset`
 * analyser and never see each other's events.
 *
 * It runs in the app's one AudioContext (`useEngine` creates it on the first gesture), and its
 * output goes to the master gain, so the instrument's volume and mute apply to a triggered
 * sample. Until the context exists the hub waits (`waiting-audio`) and retries on {@link poke}.
 *
 * The microphone opens with `echoCancellation`, `noiseSuppression` and `autoGainControl` off by
 * default; a flag is on only when EVERY lease asks for it (the strictest-latency request wins),
 * and a change reopens the microphone.
 *
 * Everything browser-specific is a dependency ({@link HubDeps}), so the hub is tested in node; the
 * app makes the browser one (`src/app/audio/index.ts`) and installs it ({@link provideAudioInput}),
 * which is how an extension reaches it ({@link audioInput}).
 */
import type { AnalyserMessage, AudioEvent } from '@thoremin/sdk/audio/types';
import type { AnalyserSpec } from '@thoremin/sdk/audio/analysers';
import type { ProcessorInMessage, ProcessorOutMessage } from '@thoremin/sdk/audio/processor';
import { chooseInputStage, type InputStage } from '@thoremin/sdk/timing/input_stage';

export type AudioSourceKind = 'microphone' | 'replay' | 'synthetic';
export const AUDIO_SOURCES: readonly AudioSourceKind[] = ['microphone', 'replay', 'synthetic'];

export interface MicConstraints {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
}

export type HubState = 'idle' | 'waiting-audio' | 'opening' | 'live' | 'denied' | 'unsupported' | 'failed';

export interface HubStatus {
  state: HubState;
  source: AudioSourceKind | null;
  sampleRate: number | null;
  constraints: Required<MicConstraints> | null;
  inputStage: InputStage;
  /** The input device's label, when the browser reveals it. */
  device: string | null;
  error: string | null;
  /** Events a lease lost because it was not drained (its queue was full). */
  dropped: number;
}

export interface LeaseEvent {
  /** The analyser id as the consumer named it. */
  source: string;
  event: AudioEvent;
}

export interface AudioInputLease {
  readonly id: string;
  /** This lease's events since the last drain, oldest first. */
  drain(): LeaseEvent[];
  /** Called for each of this lease's events as it arrives (a panel); returns the unsubscribe. */
  listen(fn: (e: LeaseEvent) => void): () => void;
  /** A message to one of this lease's analysers. */
  send(analyser: string, message: AnalyserMessage, transfer?: Transferable[]): void;
  release(): void;
}

export interface AcquireRequest {
  analysers: readonly AnalyserSpec[];
  constraints?: MicConstraints;
  source?: AudioSourceKind;
}

export interface PcmChunk {
  frame: number;
  pcm: Float32Array;
  dropped: number;
}

export interface AudioInputHub {
  acquire(req: AcquireRequest): AudioInputLease;
  status(): HubStatus;
  subscribe(fn: (s: HubStatus) => void): () => void;
  /** Retry opening (the audio context may exist now). */
  poke(): void;
  /** The input stage in force (a measured value set through `./inputStage.ts`, or the prior). */
  inputStage(): InputStage;
  /** The context's clock now, s (null before the context exists). */
  contextTime(): number | null;
  /** The decoded file the `replay` source plays (looped), or null. */
  setReplay(pcm: Float32Array | null, sampleRate: number): void;
  /** Raw input in chunks, while subscribed (a recorder). */
  tapPcm(fn: (c: PcmChunk) => void): () => void;
}

/** The slices of the browser the hub uses. */
export interface PortLike {
  postMessage(m: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: { data: unknown }) => void) | null;
}
export interface WorkletNodeLike {
  port: PortLike;
  connect(dest: unknown): void;
  disconnect(): void;
}
export interface SourceLike {
  connect(dest: unknown): void;
  disconnect(): void;
  stop?(): void;
}
export interface ContextLike {
  sampleRate: number;
  currentTime: number;
  state: string;
}
export interface OpenedInput {
  source: SourceLike;
  /** The track's reported latency, s, when it reports one. */
  reportedLatency?: number;
  device?: string;
  close(): void;
}

export interface HubDeps {
  audio(): ContextLike | undefined;
  /** Load the worklet module into `ctx` (once per context) and make the processor node. */
  makeNode(ctx: ContextLike): Promise<WorkletNodeLike>;
  destination(ctx: ContextLike): unknown;
  /** Open a source; rejects with `{ denied: true }` when the player refused the microphone. */
  open(ctx: ContextLike, kind: AudioSourceKind, opts: { constraints: Required<MicConstraints>; replay: { pcm: Float32Array; sampleRate: number } | null }): Promise<OpenedInput>;
  /** The source the URL forces (`?audio.source=`), if any. */
  forcedSource?(): AudioSourceKind | null;
  /** The stored input stage for this device, if one was measured. */
  storedInputStage?(): InputStage | null;
}

/** Most events a lease keeps undrained (a graph that stopped ticking must not grow memory). */
const MAX_QUEUE = 4096;

export function createAudioInputHub(deps: HubDeps): AudioInputHub {
  interface Lease {
    id: string;
    req: AcquireRequest;
    queue: LeaseEvent[];
    listeners: Set<(e: LeaseEvent) => void>;
  }
  const leases = new Map<string, Lease>();
  let nextLease = 0;
  const statusListeners = new Set<(s: HubStatus) => void>();
  const pcmListeners = new Set<(c: PcmChunk) => void>();
  let state: HubState = 'idle';
  let error: string | null = null;
  let dropped = 0;
  let node: WorkletNodeLike | null = null;
  let nodeCtx: ContextLike | null = null;
  let input: OpenedInput | null = null;
  let openedWith: { kind: AudioSourceKind; constraints: string } | null = null;
  let replay: { pcm: Float32Array; sampleRate: number } | null = null;
  let generation = 0;
  let busy = false;

  const constraintsNow = (): Required<MicConstraints> => {
    const all = [...leases.values()].map((l) => l.req.constraints ?? {});
    const on = (k: keyof MicConstraints) => all.length > 0 && all.every((c) => c[k] === true);
    return { echoCancellation: on('echoCancellation'), noiseSuppression: on('noiseSuppression'), autoGainControl: on('autoGainControl') };
  };
  const sourceNow = (): AudioSourceKind => deps.forcedSource?.() ?? [...leases.values()][0]?.req.source ?? 'microphone';
  const stage = () => chooseInputStage([deps.storedInputStage?.() ?? null, input?.reportedLatency !== undefined ? { seconds: input.reportedLatency, source: 'reported' } : null]);

  const status = (): HubStatus => ({
    state,
    source: openedWith?.kind ?? null,
    sampleRate: nodeCtx?.sampleRate ?? null,
    constraints: openedWith ? (JSON.parse(openedWith.constraints) as Required<MicConstraints>) : null,
    inputStage: stage(),
    device: input?.device ?? null,
    error,
    dropped,
  });
  const set = (s: HubState, err: string | null = null) => {
    state = s;
    error = err;
    const st = status();
    for (const fn of statusListeners) fn(st);
  };

  const post = (m: ProcessorInMessage, transfer?: Transferable[]) => node?.port.postMessage(m, transfer);
  const addAll = () => {
    for (const l of leases.values()) for (const a of l.req.analysers) post({ type: 'add', id: `${l.id}/${a.id ?? a.name}`, spec: a });
  };

  const onMessage = (data: unknown) => {
    const m = data as ProcessorOutMessage;
    if (m.type === 'events') {
      for (const { source, event } of m.events) {
        const cut = source.indexOf('/');
        const l = leases.get(source.slice(0, cut));
        if (!l) continue;
        const e = { source: source.slice(cut + 1), event };
        if (l.queue.length >= MAX_QUEUE) {
          l.queue.shift();
          dropped++;
        }
        l.queue.push(e);
        for (const fn of l.listeners) fn(e);
      }
    } else if (m.type === 'pcm') {
      post({ type: 'ack', upTo: m.seq });
      for (const fn of pcmListeners) fn({ frame: m.frame, pcm: m.pcm, dropped: m.dropped });
    } else if (m.type === 'error') {
      error = `${m.id}: ${m.message}`;
      set(state, error);
    }
  };

  const teardown = () => {
    input?.close();
    input = null;
    node?.disconnect();
    if (node) node.port.onmessage = null;
    node = null;
    nodeCtx = null;
    openedWith = null;
  };

  const ensure = async () => {
    if (busy) return;
    if (leases.size === 0) {
      teardown();
      if (state !== 'idle') set('idle');
      return;
    }
    const ctx = deps.audio();
    if (!ctx) {
      if (state !== 'waiting-audio') set('waiting-audio');
      return;
    }
    const kind = sourceNow();
    const constraints = constraintsNow();
    const key = JSON.stringify(constraints);
    if (node && nodeCtx === ctx && openedWith && openedWith.kind === kind && openedWith.constraints === key) return;
    const mine = ++generation;
    busy = true;
    try {
      if (state !== 'opening') set('opening');
      if (!node || nodeCtx !== ctx) {
        teardown();
        node = await deps.makeNode(ctx);
        if (mine !== generation) return;
        nodeCtx = ctx;
        node.port.onmessage = (e) => onMessage(e.data);
        node.connect(deps.destination(ctx));
        addAll();
        if (pcmListeners.size > 0) post({ type: 'pcm', on: true });
      }
      input?.close();
      input = null;
      const opened = await deps.open(ctx, kind, { constraints, replay });
      if (mine !== generation || leases.size === 0) {
        opened.close();
        return;
      }
      input = opened;
      input.source.connect(node);
      openedWith = { kind, constraints: key };
      set('live');
    } catch (e) {
      const err = e as { denied?: boolean; unsupported?: boolean; message?: string };
      openedWith = null;
      set(err?.denied ? 'denied' : err?.unsupported ? 'unsupported' : 'failed', String(err?.message ?? e));
    } finally {
      busy = false;
    }
    // Something changed while opening (a lease came or went, the constraints moved): settle it.
    if (leases.size === 0 || (state === 'live' && (sourceNow() !== openedWith?.kind || JSON.stringify(constraintsNow()) !== openedWith?.constraints))) void ensure();
  };

  return {
    acquire(req) {
      const id = `l${nextLease++}`;
      const lease: Lease = { id, req, queue: [], listeners: new Set() };
      leases.set(id, lease);
      for (const a of req.analysers) post({ type: 'add', id: `${id}/${a.id ?? a.name}`, spec: a });
      void ensure();
      return {
        id,
        drain() {
          if (state === 'waiting-audio') void ensure();
          const out = lease.queue;
          lease.queue = [];
          return out;
        },
        listen(fn) {
          lease.listeners.add(fn);
          return () => lease.listeners.delete(fn);
        },
        send(analyser, message, transfer) {
          post({ type: 'to', id: `${id}/${analyser}`, message }, transfer);
        },
        release() {
          if (!leases.delete(id)) return;
          for (const a of req.analysers) post({ type: 'remove', id: `${id}/${a.id ?? a.name}` });
          lease.listeners.clear();
          void ensure();
        },
      };
    },
    status,
    subscribe(fn) {
      statusListeners.add(fn);
      return () => statusListeners.delete(fn);
    },
    poke() {
      void ensure();
    },
    inputStage: stage,
    contextTime: () => nodeCtx?.currentTime ?? deps.audio()?.currentTime ?? null,
    setReplay(pcm, sampleRate) {
      replay = pcm ? { pcm, sampleRate } : null;
      if (openedWith?.kind === 'replay') {
        openedWith = null;
        void ensure();
      }
    },
    tapPcm(fn) {
      pcmListeners.add(fn);
      if (pcmListeners.size === 1) post({ type: 'pcm', on: true });
      return () => {
        pcmListeners.delete(fn);
        if (pcmListeners.size === 0) post({ type: 'pcm', on: false });
      };
    },
  };
}

/** The page's hub, installed by the app (`src/app/audio/index.ts`); an extension reaches it here. */
let installed: AudioInputHub | null = null;

export function provideAudioInput(hub: AudioInputHub | null): void {
  installed = hub;
}

/** The page's audio-input hub, or null where the host installed none (a headless test). */
export function audioInput(): AudioInputHub | null {
  return installed;
}
