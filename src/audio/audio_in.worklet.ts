/**
 * The audio-input AudioWorklet processor (`docs/design/audio-input.md`): a thin shell over the
 * pure processor core (`@thoremin/sdk/audio/processor`), which holds the analysers, routes the
 * host's messages to them and batches their events. Loaded by the browser hub (`./browser.ts`) as a bundled
 * worker chunk (`?worker&url`), so everything it imports is bundled into it.
 */
import { createProcessorCore, type ProcessorInMessage } from '@thoremin/sdk/audio/processor';

declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new (options?: unknown) => AudioWorkletProcessor): void;

class AudioInProcessor extends AudioWorkletProcessor {
  private core = createProcessorCore({
    sampleRate,
    post: (m, transfer) => this.port.postMessage(m, transfer ?? []),
  });

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<ProcessorInMessage>) => this.core.message(e.data);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    this.core.process(inputs[0]?.[0], out[0], currentFrame);
    // Every output channel carries the same mono signal.
    for (let c = 1; c < out.length; c++) out[c].set(out[0]);
    return true;
  }
}

registerProcessor('thoremin-audio-in', AudioInProcessor);
