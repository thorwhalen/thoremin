/**
 * Reading a recording to replay (the Replay tool): both shapes are read, and a file that is not
 * a good recording is refused or its bad lines skipped, never handed to the graph.
 */
import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { readHandRecording, isGzip, HANDS_EDGE } from '@/app/replay/handRecording';
import { loadRecords } from '../helpers/fixtures';

const kp = (n = 21) => Array.from({ length: n }, (_, i) => ({ x: 100 + i, y: 200 + i, z: 0 }));
const frame = (hands: unknown[] = [{ handedness: 'Right', keypoints: kp() }]) => ({ width: 640, height: 480, hands });
const lines = (...xs: unknown[]) => xs.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n');

describe('reading a hand recording', () => {
  it("keeps the camera's hands from the Record tool's feature stream, and nothing else", () => {
    const text = lines(
      { tick: 0, t: 10, key: HANDS_EDGE, value: frame() },
      { tick: 0, t: 10, key: 'feat.features', value: { x: 1 } },
      { tick: 1, t: 10.033, key: HANDS_EDGE, value: frame([]) },
    );
    const r = readHandRecording(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recording.format).toBe('features');
    expect(r.recording.frames).toHaveLength(2);
    expect(r.recording.times[0]).toBe(0);
    expect(r.recording.times[1]).toBeCloseTo(0.033);
    expect(r.recording.skipped).toBe(0);
  });

  it('reads a committed fixture stream as is', () => {
    const recs = loadRecords('conducting_44', 'src.hands');
    const r = readHandRecording(recs.map((x) => JSON.stringify(x)).join('\n'));
    expect(r.ok && r.recording.frames.length).toBe(recs.length);
    expect(r.ok && r.recording.format).toBe('stream');
  });

  it('skips a frame the graph could not take, and counts it', () => {
    const bad = [
      '{not json',
      { t: 1, value: frame([{ handedness: 'Right', keypoints: kp(20) }]) }, // 20 keypoints
      { t: 2, value: frame([{ handedness: 'Right', keypoints: kp() }, { handedness: 'Left', keypoints: kp() }, { handedness: 'Left', keypoints: kp() }]) }, // three hands
      { t: 3, value: frame([{ handedness: 'Right', keypoints: kp().map((k, i) => (i === 4 ? { ...k, x: null } : k)) }]) }, // not a number
      { t: 4, value: { width: 0, height: 480, hands: [] } }, // no size
      { t: 5, value: frame([{ handedness: 'Middle', keypoints: kp() }]) }, // no such hand
      { t: 'soon', value: frame() }, // no time
    ];
    const r = readHandRecording(lines({ t: 0, value: frame() }, ...bad, { t: 6, value: frame() }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recording.frames).toHaveLength(2);
    expect(r.recording.skipped).toBe(bad.length);
  });

  it('skips a frame that goes back in time', () => {
    const r = readHandRecording(lines({ t: 1, value: frame() }, { t: 2, value: frame() }, { t: 1.5, value: frame() }, { t: 3, value: frame() }));
    expect(r.ok && r.recording.times).toEqual([0, 1, 2]);
    expect(r.ok && r.recording.skipped).toBe(1);
  });

  it('refuses a file with no hand frame, saying what to record', () => {
    const features = readHandRecording(lines({ tick: 0, t: 0, key: 'feat.features', value: {} }));
    expect(features).toEqual({ ok: false, reason: expect.stringContaining('Feature stream') });
    const junk = readHandRecording('hello\nworld');
    expect(junk.ok).toBe(false);
    expect(readHandRecording('').ok).toBe(false);
  });

  it('knows a gzipped file by its magic number', () => {
    expect(isGzip(new Uint8Array(gzipSync('{}')))).toBe(true);
    expect(isGzip(new TextEncoder().encode('{"t":0}'))).toBe(false);
  });
});

describe('reading a hostile file', () => {
  it('refuses a file of nothing but line breaks past the line cap, without splitting it up front', async () => {
    const { MAX_RECORDING_LINES } = await import('@/app/replay/handRecording');
    const r = readHandRecording('\n'.repeat(MAX_RECORDING_LINES + 1));
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('lines') });
  });
});
