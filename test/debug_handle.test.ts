// @vitest-environment jsdom
/**
 * The `window.thoremin` debug handle (#209): read-only, reports the live loop
 * through the same reads the per-frame bridges use, installs on `window` and
 * uninstalls only its own handle — so a torn-down engine is never reachable through
 * a stale probe, and a newer engine's handle is never removed by an older teardown.
 * The browser smoke harness depends on this shape; `engine_wiring.test.ts` pins that
 * `useEngine` actually installs it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createFrameHold } from '@thoremin/sdk/view/frame_hold';
import { makeDebugHandle, installDebugHandle, DEBUG_HANDLE_KEY } from '@/app/engine/debugHandle';
import { LiveVectorTap, resetLiveVector } from '@/app/enroll/liveVector';

afterEach(() => {
  delete window[DEBUG_HANDLE_KEY];
  resetLiveVector();
});

const fakeEngine = (outputs: Record<string, unknown> = {}) => ({
  getOutput: (id: string, port: string) => outputs[`${id}.${port}`],
});

describe('makeDebugHandle', () => {
  it('reads node outputs, the audio graph, and the live vector time', () => {
    const h = makeDebugHandle(fakeEngine({ 'gen.status': { phase: 'off' } }), {
      audioContext: { state: 'running' },
      masterGain: { gain: { value: 0.4 } },
    });
    expect(h.getOutput('gen', 'status')).toEqual({ phase: 'off' });
    expect(h.audio()).toEqual({ state: 'running', masterGain: 0.4 });
    expect(h.liveVectorTime()).toBe(0);
    // The live vector tap is what the smoke harness watches rising.
    const tap = new LiveVectorTap();
    tap.onValue?.('handVec.vector', {}, { tick: 3, time: 0.1, dt: 1 / 30, resources: {} });
    expect(h.liveVectorTime()).toBeGreaterThan(0);
  });

  it('reports the held-frame hit counts when the option is on, null when off (#850)', () => {
    expect(makeDebugHandle(fakeEngine(), {}).holdStats()).toBeNull();
    const hold = createFrameHold();
    hold.at(1);
    expect(makeDebugHandle(fakeEngine(), { frameHold: hold }).holdStats()).toEqual({ exact: 0, earlier: 0, none: 1 });
  });

  it('reports a null audio graph before tap-to-play', () => {
    expect(makeDebugHandle(fakeEngine(), {}).audio()).toEqual({ state: null, masterGain: null });
  });

  it('is frozen: no way to write through it', () => {
    const h = makeDebugHandle(fakeEngine(), {});
    expect(Object.isFrozen(h)).toBe(true);
    expect(Object.keys(h).sort()).toEqual(['audio', 'getOutput', 'holdStats', 'level', 'liveVectorTime']);
  });
});

describe('installDebugHandle', () => {
  it('publishes on window and the uninstaller removes only its own handle', () => {
    const un1 = installDebugHandle(fakeEngine({ 'a.b': 1 }), {});
    expect(window[DEBUG_HANDLE_KEY]?.getOutput('a', 'b')).toBe(1);
    const un2 = installDebugHandle(fakeEngine({ 'a.b': 2 }), {});
    expect(window[DEBUG_HANDLE_KEY]?.getOutput('a', 'b')).toBe(2);
    un1(); // an older teardown must not remove the newer engine's handle
    expect(window[DEBUG_HANDLE_KEY]?.getOutput('a', 'b')).toBe(2);
    un2();
    expect(window[DEBUG_HANDLE_KEY]).toBeUndefined();
  });
});

describe('makeDebugHandle().level (the seed sweep\'s "not silent")', () => {
  it('is null until audio runs, then the loudest recent sample at the master output', () => {
    const samples = [0.1, -0.4, 0.2];
    let connected = 0;
    const analyser = { fftSize: 3, getFloatTimeDomainData: (b: Float32Array) => b.set(samples) };
    const ac = { state: 'suspended', createAnalyser: () => analyser };
    const master = { gain: { value: 1 }, connect: () => void connected++ };
    const h = makeDebugHandle(fakeEngine(), { audioContext: ac, masterGain: master });
    expect(makeDebugHandle(fakeEngine(), {}).level()).toBeNull();
    expect(h.level()).toBeNull();
    ac.state = 'running';
    expect(h.level()).toBeCloseTo(0.4);
    expect(h.level()).toBeCloseTo(0.4);
    expect(connected).toBe(1);
  });
});
