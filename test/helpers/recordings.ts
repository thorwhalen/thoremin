/**
 * The player's own recordings, as tests and demos read them: real hands and faces from
 * thoremin sessions, kept as landmark streams with transcripts and annotations in the PRIVATE
 * repository `thoremin-recordings` (its README says what is in a recording).
 *
 * This repository is public and those landmarks are the player's own body, so they are never
 * copied here: a test reads them at run time from a checkout and is skipped without one
 * (`describe.runIf(HAS_RECORDINGS)`). Only numbers measured on them are committed. Where the
 * checkout is, in order:
 *
 * 1. `$THOREMIN_RECORDINGS_DIR` (the `recordings/` folder itself);
 * 2. a `thoremin-recordings/recordings/` folder beside this checkout or beside any of its
 *    ancestors, which finds the usual sibling layout from a git worktree too.
 *
 * Every stream is a list of `StreamRecord`s with `t` in seconds from the take's start;
 * {@link recordingSegment} cuts one stretch and re-times it from zero, so a segment drops into
 * `replay-hands` / `replay-source` like a committed fixture.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import type { StreamRecord } from '@thoremin/dag';

function findRecordingsDir(): string | null {
  const env = process.env.THOREMIN_RECORDINGS_DIR;
  if (env) return existsSync(env) ? env : null;
  let dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  for (;;) {
    const candidate = join(dirname(dir), 'thoremin-recordings', 'recordings');
    if (existsSync(candidate)) return candidate;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** The dataset's `recordings/` folder, or null when no checkout is reachable. */
export const RECORDINGS_DIR: string | null = findRecordingsDir();
/** Whether the private recordings are here: gate every test that reads them on this. */
export const HAS_RECORDINGS = RECORDINGS_DIR !== null;

/** One typed event of `annotations.json` (schema `thoremin-recordings/annotations/1`). */
export interface RecordingEvent {
  kind: 'asl-letter' | 'chord-intent' | 'ux-comment' | 'segment';
  start: number;
  end: number;
  label?: string;
  hand?: 'left' | 'right';
  topics?: string[];
  tags?: string[];
  quote?: string;
}

export interface RecordingMeta {
  id: string;
  durationS: number;
  instrument: { label: string; seed?: string };
  streams: Record<string, { file: string; keys?: string[] }>;
}

function dir(id: string): string {
  if (!RECORDINGS_DIR) throw new Error('thoremin-recordings is not checked out (set THOREMIN_RECORDINGS_DIR); gate the test on HAS_RECORDINGS');
  return join(RECORDINGS_DIR, id);
}

const readJson = <T>(id: string, name: string): T => JSON.parse(readFileSync(join(dir(id), name), 'utf8')) as T;

export const recordingMeta = (id: string): RecordingMeta => readJson(id, 'meta.json');
export const recordingSettings = (id: string): Record<string, unknown> => readJson(id, 'ui.json');
export const recordingEvents = (id: string, kind?: RecordingEvent['kind']): RecordingEvent[] =>
  readJson<{ events: RecordingEvent[] }>(id, 'annotations.json').events.filter((e) => !kind || e.kind === kind);

const cache = new Map<string, StreamRecord[]>();

/** Every record of one stream: `hands`, `face`, `pose`, `app` (change-only `{t, tick, key, value}`)
 *  or `ui_changes`. */
export function recordingStream(id: string, stream: string): StreamRecord[] {
  const key = `${id}/${stream}`;
  let rows = cache.get(key);
  if (!rows) {
    const text = gunzipSync(readFileSync(join(dir(id), `${stream}.ndjson.gz`))).toString('utf8');
    rows = text.trim().split('\n').map((l) => JSON.parse(l) as StreamRecord);
    cache.set(key, rows);
  }
  return rows;
}

/** The records of one stream with `start <= t < end`, re-timed from 0 (ticks renumbered), the
 *  frame's own `value.t` moved with them. */
export function recordingSegment(id: string, stream: string, start = 0, end = Infinity): StreamRecord[] {
  const out: StreamRecord[] = [];
  for (const r of recordingStream(id, stream)) {
    if (r.t < start || r.t >= end) continue;
    const t = Math.round((r.t - start) * 1e4) / 1e4;
    const v = r.value as Record<string, unknown> | null;
    const value = v && typeof v === 'object' && 't' in v ? { ...v, t } : v;
    out.push({ ...r, tick: out.length, t, value });
  }
  return out;
}

/** The live value of one app port at each of `ticks` (the app logs a port only when it
 *  changes, so the value at a tick is the last one logged at or before it). */
export function liveValuesAt(id: string, key: string, ticks: readonly number[]): unknown[] {
  const rows = recordingStream(id, 'app').filter((r) => (r as unknown as { key: string }).key === key);
  const out: unknown[] = [];
  let j = -1;
  for (const tk of ticks) {
    while (j + 1 < rows.length && rows[j + 1]!.tick <= tk) j++;
    out.push(j >= 0 ? rows[j]!.value : undefined);
  }
  return out;
}

/** Recording ids, optionally only those whose instrument label is one of `labels`. */
export function recordingIds(...labels: string[]): string[] {
  if (!RECORDINGS_DIR) return [];
  return readdirSync(RECORDINGS_DIR)
    .filter((d) => existsSync(join(RECORDINGS_DIR!, d, 'meta.json')))
    .filter((d) => !labels.length || labels.includes(recordingMeta(d).instrument.label))
    .sort();
}
