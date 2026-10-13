/**
 * The silent latency levers of #240 (step 4 of the 2026-10-05 timing plan), the pure
 * halves: what the camera is asked for, which delegate a model loads with, and the per-device low-latency audio pref
 * (its hint, its browser label, its persistence and heal). The glitch counter that
 * guards the pref is `test/timing/glitches.test.ts`; the panel box is
 * `test/audio_panel.test.tsx`.
 */
import { describe, it, expect } from 'vitest';
import { CAPTURE, cameraConstraints } from '@/app/camera';
import { isSoftwareRenderer, resolveDelegate, DelegateChoiceSchema } from '@/nodes/sources/delegate';
import { latencyHintFor, honoursNumericLatencyHint, DEFAULT_AUDIO_PREFS, DEFAULT_LATENCY_HINT } from '@/app/timing/audioPrefs';
import { useControls, mergeControls } from '@/app/store';
import { SettingsSchema } from '@/settings/schema';
import { webcamHandsNode } from '@/nodes/sources/webcam_hands';
import { webcamFaceNode } from '@/nodes/sources/webcam_face';
import { webcamBodyNode } from '@/nodes/sources/webcam_body';

describe('the capture the instrument asks for', () => {
  it('is 1280x720 at 16:9, up to 60 fps, the front camera, all soft', () => {
    // Not 640x360: the CPU delegate finds no hands at 640x360 (measured; see camera.ts).
    expect(CAPTURE).toEqual({ width: 1280, height: 720, frameRate: 60 });
    const c = cameraConstraints();
    expect(c).toEqual({
      width: { ideal: 1280 },
      height: { ideal: 720 },
      aspectRatio: { ideal: 1280 / 720 },
      frameRate: { ideal: 60 },
      facingMode: { ideal: 'user' },
    });
    // 16:9, never 4:3: saved pad layouts are in normalised display coordinates.
    expect((c.aspectRatio as ConstrainDoubleRange).ideal).toBeCloseTo(16 / 9, 9);
  });

});

describe('the model delegate (auto: CPU on software WebGL)', () => {
  it('recognises software renderers and not hardware ones', () => {
    expect(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe(true);
    expect(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareRenderer('Microsoft Basic Render Driver')).toBe(true);
    expect(isSoftwareRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, Unspecified Version)')).toBe(false);
    expect(isSoftwareRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(false);
    expect(isSoftwareRenderer('Mali-G78')).toBe(false);
    // A masked string (privacy modes) reads as hardware: today's behaviour.
    expect(isSoftwareRenderer('WebKit WebGL')).toBe(false);
  });

  it('auto resolves by the renderer; GPU and CPU force one', () => {
    expect(resolveDelegate('auto', 'SwiftShader driver')).toBe('CPU');
    expect(resolveDelegate('auto', null)).toBe('CPU'); // no WebGL at all
    expect(resolveDelegate('auto', 'Apple M1 Max')).toBe('GPU');
    expect(resolveDelegate('auto', undefined)).toBe('GPU'); // not a browser
    expect(resolveDelegate('GPU', 'SwiftShader driver')).toBe('GPU');
    expect(resolveDelegate('CPU', 'Apple M1 Max')).toBe('CPU');
  });

  it('the hands, face and body models default to auto', () => {
    expect(DelegateChoiceSchema.options).toEqual(['auto', 'GPU', 'CPU']);
    for (const def of [webcamHandsNode, webcamFaceNode, webcamBodyNode]) {
      const params = (def as unknown as { params: { parse(x: unknown): { delegate: string } } }).params;
      expect(params.parse({}).delegate, def.type).toBe('auto');
    }
  });
});

describe('the low-latency audio pref (per device, off by default)', () => {
  it('maps to the hint: interactive when off, 0 when on', () => {
    expect(DEFAULT_AUDIO_PREFS).toEqual({ lowLatency: false });
    expect(latencyHintFor(DEFAULT_AUDIO_PREFS)).toBe(DEFAULT_LATENCY_HINT);
    expect(DEFAULT_LATENCY_HINT).toBe('interactive');
    expect(latencyHintFor({ lowLatency: true })).toBe(0);
  });

  it('labels the browsers that honour a numeric hint (Chromium) and those that do not', () => {
    expect(honoursNumericLatencyHint('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36')).toBe(true);
    expect(honoursNumericLatencyHint('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0')).toBe(true);
    expect(honoursNumericLatencyHint('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe(false);
    expect(honoursNumericLatencyHint('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15')).toBe(false);
  });

  it('is a per-device tooling pref, not a preset field: persisted, healed, never saved with an instrument', () => {
    expect('audioPrefs' in SettingsSchema.shape).toBe(false);
    const initial = useControls.getInitialState();
    expect(initial.audioPrefs).toEqual({ lowLatency: false });
    // A pre-#240 blob has none: the default hint.
    expect(mergeControls({ masterVolume: 0.5 }, initial).audioPrefs).toEqual({ lowLatency: false });
    expect(mergeControls({ audioPrefs: { lowLatency: true } } as never, initial).audioPrefs).toEqual({ lowLatency: true });
    expect(mergeControls({ audioPrefs: { lowLatency: 'yes' } } as never, initial).audioPrefs).toEqual({ lowLatency: false });
    const persist = (useControls as unknown as { persist: { getOptions(): { partialize(s: unknown): Record<string, unknown>; version: number } } }).persist.getOptions();
    expect(persist.version).toBe(24);
    expect(persist.partialize(useControls.getState()).audioPrefs).toEqual({ lowLatency: false });
  });

  it('setAudioPrefs patches the pref', () => {
    useControls.getState().setAudioPrefs({ lowLatency: true });
    expect(useControls.getState().audioPrefs.lowLatency).toBe(true);
    useControls.getState().setAudioPrefs({ lowLatency: false });
    expect(useControls.getState().audioPrefs.lowLatency).toBe(false);
  });
});
