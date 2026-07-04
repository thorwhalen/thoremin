/**
 * The finger→effect routing math (hand_map.ts). fingerEffects combines the per-finger
 * closeness into a per-effect amount: additive effects default to 0, the gain `gate`
 * defaults to 1 (pass-through), fingers sharing a target are averaged ("combined
 * spread"), and the mode/invert/sensitivity shaping is applied. Pure — the voice
 * mapping just applies this output.
 */
import { describe, it, expect } from 'vitest';
import {
  fingerEffects,
  DEFAULT_HAND_MAP,
  RECOMMENDED_FINGER_ROUTES,
  EFFECTS,
  TRIGGER_THRESHOLD,
  type FingerRoute,
} from '@/nodes/mapping/hand_map';
import type { FingerCloseness } from '@/nodes/domain';

const closeness = (o: Partial<FingerCloseness> = {}): FingerCloseness => ({ index: 0, middle: 0, ring: 0, pinky: 0, ...o });
const route = (over: Partial<FingerRoute>): FingerRoute => ({ target: 'none', sensitivity: 1, mode: 'continuous', invert: false, ...over });
const noRoutes = () => ({ index: route({}), middle: route({}), ring: route({}), pinky: route({}) });

describe('fingerEffects', () => {
  it('no routing → every additive effect 0, gate 1 (pass-through)', () => {
    const fx = fingerEffects(closeness({ index: 0.8 }), noRoutes());
    for (const e of EFFECTS) expect(fx[e]).toBe(e === 'gate' ? 1 : 0);
  });

  it('a continuous route passes closeness*sensitivity to its target', () => {
    const routes = { ...noRoutes(), index: route({ target: 'brightness', sensitivity: 1 }) };
    expect(fingerEffects(closeness({ index: 0.7 }), routes).brightness).toBeCloseTo(0.7);
    const routes2 = { ...noRoutes(), index: route({ target: 'brightness', sensitivity: 2 }) };
    expect(fingerEffects(closeness({ index: 0.7 }), routes2).brightness).toBe(1); // clamped
  });

  it('two fingers on the same target are averaged (combined spread)', () => {
    const routes = {
      ...noRoutes(),
      index: route({ target: 'brightness' }),
      middle: route({ target: 'brightness' }),
    };
    expect(fingerEffects(closeness({ index: 1, middle: 0 }), routes).brightness).toBeCloseTo(0.5);
  });

  it('trigger mode is binary at the threshold', () => {
    const routes = { ...noRoutes(), pinky: route({ target: 'octave', mode: 'trigger' }) };
    expect(fingerEffects(closeness({ pinky: TRIGGER_THRESHOLD + 0.05 }), routes).octave).toBe(1);
    expect(fingerEffects(closeness({ pinky: TRIGGER_THRESHOLD - 0.05 }), routes).octave).toBe(0);
  });

  it('invert flips the sense', () => {
    const routes = { ...noRoutes(), index: route({ target: 'vibrato', invert: true }) };
    expect(fingerEffects(closeness({ index: 0.25 }), routes).vibrato).toBeCloseTo(0.75);
  });

  it('gate averages when driven, else passes through at 1', () => {
    const routes = { ...noRoutes(), ring: route({ target: 'gate' }) };
    expect(fingerEffects(closeness({ ring: 0.4 }), routes).gate).toBeCloseTo(0.4);
    expect(fingerEffects(closeness({ ring: 0 }), routes).gate).toBe(0); // driven → 0 (muted)
    expect(fingerEffects(closeness({}), noRoutes()).gate).toBe(1); // undriven → pass-through
  });

  it('the default hand map does no finger routing (backward compatible)', () => {
    const fx = fingerEffects(closeness({ index: 1, middle: 1, ring: 1, pinky: 1 }), DEFAULT_HAND_MAP.fingers);
    for (const e of EFFECTS) expect(fx[e]).toBe(e === 'gate' ? 1 : 0);
  });

  it('the recommended routes drive brightness/vibrato/pan/pitchBend', () => {
    const fx = fingerEffects(closeness({ index: 0.9, middle: 0.5, ring: 0.3, pinky: 0.2 }), RECOMMENDED_FINGER_ROUTES);
    expect(fx.brightness).toBeCloseTo(0.9);
    expect(fx.vibrato).toBeCloseTo(0.5);
    expect(fx.pan).toBeCloseTo(0.3);
    expect(fx.pitchBend).toBeCloseTo(0.2);
  });
});
