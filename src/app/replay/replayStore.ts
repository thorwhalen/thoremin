/**
 * The recording being replayed in place of the camera (if any), and how one is loaded: from a file
 * the player picks in the Replay tool, or from a URL (`?replay=<url>`). While one is loaded the app
 * puts the `replay-hands` source in the source slot, and the node reads the frames through the
 * engine resource {@link HAND_REPLAY_RESOURCE_KEY}, by time, so the take plays at its own pace.
 *
 * Not the hot store and not a preference: a replay is a debugging session, gone on reload (a
 * `?replay=` URL brings it back). Gzipped files are inflated as a stream with a running size cap,
 * so a small file cannot inflate past the reader's limit.
 */
import { create } from 'zustand';
import { useTools } from '../tools/toolsStore';
import type { HandReplay } from '@/nodes/sources/replay_hands.schema';
import { isGzip, MAX_RECORDING_CHARS, readHandRecording, type HandRecording } from './handRecording';

export { HAND_REPLAY_RESOURCE_KEY } from '@/nodes/sources/replay_hands.schema';

export interface LoadedReplay extends HandReplay {
  /** The file's name, or the URL. */
  name: string;
  format: HandRecording['format'];
  skipped: number;
  /** The take's length, seconds. */
  durationS: number;
}

export interface ReplayState {
  replay: LoadedReplay | null;
  loading: boolean;
  error: string | null;
  /** Read a file the player picked. */
  loadFile(file: Blob & { name?: string }): Promise<void>;
  /** Fetch and read a recording from a URL. */
  loadUrl(url: string): Promise<void>;
  setLoop(loop: boolean): void;
  /** Stop replaying: the camera comes back. */
  clear(): void;
}

let nextId = 1;

const tooLarge = () => new Error(`the file is larger than ${MAX_RECORDING_CHARS / 1024 / 1024} MB`);

/** A stream's bytes, refused as soon as they pass `cap` (a download that never ends included). */
async function readCapped(stream: ReadableStream<Uint8Array>, cap: number, refuse: () => Error): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > cap) {
      await reader.cancel();
      throw refuse();
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return all;
}

/** A blob's bytes, its size checked first (FileReader where `Blob.arrayBuffer` is missing: Safari
 *  before 14). */
function bytesOf(blob: Blob): Promise<Uint8Array> {
  if (blob.size > MAX_RECORDING_CHARS) return Promise.reject(tooLarge());
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer().then((b) => new Uint8Array(b));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('could not read the file'));
    reader.readAsArrayBuffer(blob);
  });
}

/** The bytes as text, inflating a gzipped file as a stream that stops at the size cap. */
async function textOf(bytes: Uint8Array): Promise<string> {
  if (!isGzip(bytes)) {
    if (bytes.length > MAX_RECORDING_CHARS) throw tooLarge();
    return new TextDecoder().decode(bytes);
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new TextDecoder().decode(await readCapped(stream, MAX_RECORDING_CHARS, () => new Error(`the file inflates past ${MAX_RECORDING_CHARS / 1024 / 1024} MB`)));
}

/** A URL's bytes: refused early when it says it is too large, and cut off when it streams on. */
async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not fetch it (HTTP ${res.status})`);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_RECORDING_CHARS) throw tooLarge();
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  return readCapped(res.body, MAX_RECORDING_CHARS, tooLarge);
}

export const useReplay = create<ReplayState>((set, get) => {
  // Only the latest load may land: one picked while another was still reading wins.
  let latest = 0;
  const load = async (name: string, bytes: () => Promise<Uint8Array>) => {
    const token = ++latest;
    set({ loading: true, error: null });
    try {
      const read = readHandRecording(await textOf(await bytes()));
      if (token !== latest) return;
      if (!read.ok) {
        set({ loading: false, error: `${name}: ${read.reason}` });
        return;
      }
      const { frames, times, format, skipped } = read.recording;
      set({
        loading: false,
        replay: { id: nextId++, name, frames, times, loop: get().replay?.loop ?? true, format, skipped, durationS: times[times.length - 1] ?? 0 },
      });
    } catch (err) {
      if (token !== latest) return;
      set({ loading: false, error: `${name}: ${err instanceof Error ? err.message : String(err)}` });
    }
  };
  return {
    replay: null,
    loading: false,
    error: null,
    loadFile: (file) => load(file.name ?? 'recording', () => bytesOf(file)),
    loadUrl: (url) => load(url, () => download(url)),
    setLoop: (loop) => {
      const r = get().replay;
      if (r) set({ replay: { ...r, loop } });
    },
    clear: () => {
      latest += 1; // a load still reading lands nowhere
      set({ replay: null, error: null, loading: false });
    },
  };
});

/** Load the `?replay=` link's recording; a link that fails opens the Replay tool, where the reason
 *  is shown (the camera carries on meanwhile: the slot follows a LOADED recording only). */
export async function loadReplayLink(url: string): Promise<void> {
  await useReplay.getState().loadUrl(url);
  if (useReplay.getState().error) useTools.setState({ open: 'replay' });
}

/** `?replay=<url>`: the recording to replay from the start, or null. */
export function replayUrlFrom(search: string): string | null {
  const url = new URLSearchParams(search).get('replay')?.trim();
  return url ? url : null;
}
