/**
 * Bluetooth headphones + the computer's microphone (#247 follow-up): the recorder avoids
 * a headset's microphone when the computer's own is there, and the pairing notices a
 * take recorded through one anyway (by its name, its rate, or its missing high band), or
 * a click delay that did not hold steady.
 */
import { describe, it, expect } from 'vitest';
import { chooseMicrophone, isHeadsetMic } from '@/app/recording/mic';
import { hasHighBand, unsteadyLag } from '../../scripts/cue/lib_pair_take';

const input = (deviceId: string, label: string) => ({ deviceId, kind: 'audioinput', label });

describe('choosing the microphone', () => {
  it('knows a headset by name', () => {
    for (const l of ['AirPods Pro', 'Powerbeats Pro', 'Bose QC45', 'Jabra Evolve2', 'WH-1000XM4', 'Galaxy Buds2', 'Hands-Free AG Audio', 'Plantronics BT600']) {
      expect(isHeadsetMic(l), l).toBe(true);
    }
    // A studio microphone is not a headset, whoever made it.
    for (const l of ['MacBook Air Microphone', 'MacBook Pro Microphone', 'Built-in Microphone', 'Blue Yeti', 'Scarlett 2i2 USB', 'Sennheiser MK 4', 'Shure MV7', 'RODE NT-USB']) {
      expect(isHeadsetMic(l), l).toBe(false);
    }
  });

  it("switches off a headset's microphone to the computer's, and never to a pseudo-device", () => {
    const devices = [
      input('default', 'Default - AirPods Pro'),
      input('a', 'AirPods Pro'),
      input('usb', 'Scarlett 2i2 USB'),
      input('mac', 'MacBook Air Microphone'),
      { deviceId: 'cam', kind: 'videoinput', label: 'FaceTime HD Camera' },
    ];
    expect(chooseMicrophone(devices, 'AirPods Pro')?.deviceId).toBe('mac');
    expect(chooseMicrophone(devices.filter((d) => d.deviceId !== 'mac'), 'AirPods Pro')?.deviceId).toBe('usb');
    expect(chooseMicrophone([input('a', 'AirPods Pro')], 'AirPods Pro')).toBeNull();
    // Already the computer's: keep it.
    expect(chooseMicrophone(devices, 'MacBook Air Microphone')).toBeNull();
  });
});

describe("noticing a call-quality recording", () => {
  const SR = 48000;
  const onsets = [0.1, 0.4, 0.7];
  let seed = 5;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296), seed / 2147483648 - 1);

  it('a broadband tap has a high band; the same through an 8 kHz band limit does not', () => {
    const broad = new Float32Array(SR);
    for (const t of onsets) for (let i = 0; i < 0.03 * SR; i++) broad[Math.round(t * SR) + i] += 0.3 * rnd() * Math.exp(-i / 400);
    expect(hasHighBand({ sampleRate: SR, pcm: broad }, onsets)).toBe(true);
    // Band-limited: a sum of partials below 7 kHz (what a 16 kHz input resampled up holds).
    const narrow = new Float32Array(SR);
    for (const t of onsets) {
      for (let f = 200; f < 7000; f += 150) {
        const ph = rnd() * Math.PI;
        for (let i = 0; i < 0.03 * SR; i++) narrow[Math.round(t * SR) + i] += (0.02 * Math.exp(-i / 400)) * Math.sin((2 * Math.PI * f * i) / SR + ph);
      }
    }
    expect(hasHighBand({ sampleRate: SR, pcm: narrow }, onsets)).toBe(false);
  });

  it('a click delay that steps or scatters is named; a steady one is not', () => {
    const steady = Array.from({ length: 16 }, (_, i) => 230 + ((i * 7) % 5) * 4);
    expect(unsteadyLag(steady)).toBeNull();
    const stepped = steady.map((x, i) => (i < 8 ? x : x + 130));
    expect(unsteadyLag(stepped)).toMatch(/stepped by 1[23]\d ms/);
    // A 40 ms step: half the air beats would inherit a lag 40 ms off.
    expect(unsteadyLag(steady.map((x, i) => (i < 8 ? x : x + 40)))).toMatch(/stepped by (3[5-9]|4\d) ms/);
    const scattered = steady.map((x, i) => x + (i % 2 ? 90 : -90));
    expect(unsteadyLag(scattered)).toMatch(/scatters/);
  });
});
