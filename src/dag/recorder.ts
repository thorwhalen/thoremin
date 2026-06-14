/**
 * Recording & replay — the backbone of Thoremin's DAG-aware test strategy.
 *
 * The pipeline is multi-stage: video -> landmarks -> features -> mapping ->
 * music-logic -> synth-params -> audio. Re-running the whole thing from video
 * is slow (camera + ML inference) and non-deterministic. So we *tap every edge*
 * and persist the values flowing on it. Once a stage's output is recorded, any
 * downstream stage can be tested by *replaying* that recording — fast and
 * deterministic, no camera or GPU required.
 *
 * This module is intentionally pure (no filesystem, no DOM): it produces and
 * consumes plain strings/objects. The Node-only `scripts/` layer does the
 * actual disk I/O so the same code runs in the browser.
 */
import type { NodeContext, NodeHandlers, PortValues, StreamRecord, Tap } from './types';

/**
 * A Tap that accumulates every observed value in memory, grouped by key
 * (`"<nodeId>.<port>"`). Attach it to an {@link Engine} via `opts.taps`.
 */
export class StreamRecorder implements Tap {
  private streams = new Map<string, StreamRecord[]>();
  /** Only record these keys (if set). Useful to limit recording to a few edges. */
  private only?: Set<string>;

  constructor(opts: { only?: string[] } = {}) {
    if (opts.only) this.only = new Set(opts.only);
  }

  onValue(key: string, value: unknown, ctx: NodeContext): void {
    if (this.only && !this.only.has(key)) return;
    let arr = this.streams.get(key);
    if (!arr) {
      arr = [];
      this.streams.set(key, arr);
    }
    arr.push({ tick: ctx.tick, t: ctx.time, value });
  }

  keys(): string[] {
    return [...this.streams.keys()];
  }

  get(key: string): StreamRecord[] {
    return this.streams.get(key) ?? [];
  }

  /** Just the values for a key, in tick order. */
  values(key: string): unknown[] {
    return this.get(key).map((r) => r.value);
  }

  splitByKey(): Map<string, StreamRecord[]> {
    return new Map(this.streams);
  }

  /**
   * One NDJSON string per key, keyed by a safe filename (`"<key>.ndjson"`).
   * The Node layer writes these into a scenario directory.
   */
  toFiles(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, records] of this.streams) {
      out[`${key}.ndjson`] = serializeRecords(records);
    }
    return out;
  }

  clear(): void {
    this.streams.clear();
  }
}

/** Serialize records as newline-delimited JSON (one record per line). */
export function serializeRecords(records: StreamRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
}

/** Parse newline-delimited JSON back into records (blank lines ignored). */
export function parseRecords(ndjson: string): StreamRecord[] {
  return ndjson
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as StreamRecord);
}

/** Extract just the values from an NDJSON stream, in tick order. */
export function valuesFromNDJSON(ndjson: string): unknown[] {
  return parseRecords(ndjson).map((r) => r.value);
}

export interface ReplayOptions {
  /** Seconds-per-tick used to synthesize ctx.time when frames lack their own. */
  dt?: number;
  /** Host resources to expose to the node (usually empty in tests). */
  resources?: Record<string, unknown>;
}

/**
 * Drive a single node's handlers over a recorded set of input frames and
 * collect its outputs per tick. This is the workhorse for unit-testing one
 * stage in isolation from a replay.
 *
 * @param handlers  The node instance (from `def.make(params)`).
 * @param inputFramesByPort  Map of input port name -> array of per-tick values.
 *   All arrays should be the same length (the tick count); shorter arrays leave
 *   that input `undefined` for the missing ticks.
 */
export async function replayNode(
  handlers: NodeHandlers,
  inputFramesByPort: Record<string, unknown[]>,
  opts: ReplayOptions = {},
): Promise<PortValues[]> {
  const dt = opts.dt ?? 1 / 60;
  const resources = opts.resources ?? {};
  const ports = Object.keys(inputFramesByPort);
  const ticks = ports.reduce((max, p) => Math.max(max, inputFramesByPort[p].length), 0);

  if (handlers.init) {
    await handlers.init({ tick: 0, time: 0, dt: 0, resources });
  }

  const results: PortValues[] = [];
  for (let i = 0; i < ticks; i++) {
    const inputs: PortValues = {};
    for (const p of ports) {
      const v = inputFramesByPort[p][i];
      if (v !== undefined) inputs[p] = v;
    }
    const ctx: NodeContext = { tick: i, time: i * dt, dt: i === 0 ? 0 : dt, resources };
    results.push(handlers.process(inputs, ctx) ?? {});
  }
  handlers.dispose?.();
  return results;
}
