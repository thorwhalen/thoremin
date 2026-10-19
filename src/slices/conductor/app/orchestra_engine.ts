/// <reference types="vite/client" />
/**
 * Browser-only `spessasynth_lib` adapter for the `orchestra` node (#187 PR 5): the real
 * {@link OrchestraSynth} the node drives, kept out of the node module so the node's
 * scheduling and controller logic stays Node-safe and headlessly testable (the
 * `lyria_engine.ts` / MIDI slice `app/midi_engine.ts` shape, `docs/design/lazy-loading.md`).
 *
 * This module statically imports `spessasynth_lib` and the URL of its AudioWorklet
 * processor, so it must only ever be reached through the node's dynamic
 * `import('./orchestra_engine')`, which fires the first time the player switches the
 * orchestra on. Nothing re-exports it (the build gate `vite.lazy-guard.ts`, its test
 * `test/lazy_bundle_guard.test.ts`, and `smoke/tests/orchestra.smoke.ts` pin that the synth is not in the main chunk and is not fetched before
 * then).
 *
 * The load, in order, each step abortable: the worklet module, then the soundfont (the
 * self-hosted cut SF3, 6.0 MB (22 programs, #334), D10 on #168: under the 15 MB threshold, so served from
 * the app's own static files with its licence beside it, and cached by the browser's
 * HTTP cache like any static file), with download progress for the readout, then the
 * synth and the bank. Every event method passes `{ time }` in `AudioContext` seconds, so
 * the scheduler's commands land on the synth's render quantum (128 samples).
 */
import { WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import type { LoadResult } from '@thoremin/lazy';
import type { OrchestraEngineOpts, OrchestraSynth } from '../nodes/orchestra.schema';

/** Where the cut soundfont is served from, under the app's base path. */
export const SOUNDFONT_PATH = 'soundfonts/orchestra.sf3';

/** Read a response body, reporting progress against its Content-Length when known. */
async function readWithProgress(res: Response, progress: (f: number) => void, signal: AbortSignal): Promise<ArrayBuffer> {
  // A compressed response's Content-Length counts the encoded bytes, not the ones read:
  // no honest fraction then, so no progress (the readout shows a plain "loading").
  const total = res.headers.get('content-encoding') ? 0 : Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    if (signal.aborted) {
      void reader.cancel();
      throw new DOMException('aborted', 'AbortError');
    }
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    progress(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out.buffer;
}

/** Worklet modules are per context; add the processor once per context. */
const workletAdded = new WeakMap<BaseAudioContext, Promise<void>>();

export async function createOrchestraEngine(opts: OrchestraEngineOpts): Promise<LoadResult<OrchestraSynth>> {
  const { audioContext: ac, destination, signal, progress } = opts;
  if (!ac || !destination) return { resource: null, reason: 'no-audio', retry: true, message: 'Tap to play first: the orchestra needs the audio graph.' };
  if (!ac.audioWorklet) return { resource: null, reason: 'unsupported', message: 'This browser cannot run the orchestra (no AudioWorklet).' };

  let added = workletAdded.get(ac);
  if (!added) {
    added = ac.audioWorklet.addModule(processorUrl);
    workletAdded.set(ac, added);
    added.catch(() => workletAdded.delete(ac));
  }
  await added;
  if (signal.aborted) return { resource: null, reason: 'aborted' };

  const url = `${import.meta.env.BASE_URL ?? '/'}${SOUNDFONT_PATH}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`the orchestra's soundfont did not load (${res.status} ${res.statusText})`);
  const bank = await readWithProgress(res, progress, signal);
  if (signal.aborted) return { resource: null, reason: 'aborted' };

  const synth = new WorkletSynthesizer(ac);
  synth.connect(destination);
  try {
    await synth.soundBankManager.addSoundBank(bank, 'orchestra');
    await synth.isReady;
  } catch (err) {
    synth.disconnect();
    synth.destroy();
    throw err;
  }
  if (signal.aborted) {
    synth.disconnect();
    synth.destroy();
    return { resource: null, reason: 'aborted' };
  }

  const at = (time: number) => ({ time });
  const resource: OrchestraSynth = {
    noteOn: (channel, key, velocity, time) => synth.noteOn(channel, key, velocity, at(time)),
    noteOff: (channel, key, time) => synth.noteOff(channel, key, at(time)),
    controllerChange: (channel, cc, value, time) => synth.controllerChange(channel, cc as Parameters<typeof synth.controllerChange>[1], value, at(time)),
    programChange: (channel, program) => synth.programChange(channel, program),
    allNotesOff: () => synth.stopAll(),
    close: () => {
      synth.stopAll(true);
      synth.disconnect();
      synth.destroy();
    },
  };
  return { resource, message: 'Orchestra ready' };
}
