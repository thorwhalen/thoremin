/**
 * Feature-stream JSONL tap (#88): serialize-on-receipt, edge filtering, and the
 * drain-to-file contract. A pure DAG Tap, so it tests headlessly.
 */
import { describe, it, expect } from 'vitest';
import { FeatureJsonlTap } from '@/app/recording/featureTap';
import type { NodeContext } from '@/dag';

const ctx = (tick: number, time: number): NodeContext => ({ tick, time, dt: 1 / 60, resources: {} });

describe('FeatureJsonlTap', () => {
  it('records every edge as one JSONL line {tick,t,key,value}', () => {
    const tap = new FeatureJsonlTap();
    tap.onValue('pitch.freq', 440, ctx(0, 0));
    tap.onValue('pitch.freq', 442, ctx(1, 0.016));
    expect(tap.count).toBe(2);
    const lines = tap.drain().trim().split('\n');
    expect(JSON.parse(lines[0])).toEqual({ tick: 0, t: 0, key: 'pitch.freq', value: 440 });
    expect(JSON.parse(lines[1])).toEqual({ tick: 1, t: 0.016, key: 'pitch.freq', value: 442 });
  });

  it('filters to the selected edges when a set is given', () => {
    const tap = new FeatureJsonlTap(['a.x']);
    tap.onValue('a.x', 1, ctx(0, 0));
    tap.onValue('b.y', 2, ctx(0, 0)); // ignored
    expect(tap.count).toBe(1);
    expect(tap.keysSeen()).toEqual(['a.x']);
  });

  it('drain clears the buffer (so a second drain is empty)', () => {
    const tap = new FeatureJsonlTap();
    tap.onValue('a.x', 1, ctx(0, 0));
    expect(tap.drain()).toBe('{"tick":0,"t":0,"key":"a.x","value":1}\n');
    expect(tap.drain()).toBe('');
  });

  it('an empty stream drains to the empty string', () => {
    expect(new FeatureJsonlTap().drain()).toBe('');
  });
});
