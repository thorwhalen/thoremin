// @vitest-environment jsdom
/**
 * The low-latency audio box's reachability (#240): the settings panel's Sound section
 * (open by default) carries it, off by default, and ticking it sets the per-device pref
 * the host reads when it creates the audio context. Two clicks from a cold load:
 * Settings, the box.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import DialsControlsPanel from '@/app/dials/DialsControlsPanel';
import { useControls } from '@/app/store';

afterEach(() => {
  cleanup();
  useControls.getState().setAudioPrefs({ lowLatency: false });
});

describe('the Sound section carries the low-latency audio box', () => {
  it('renders it off, and ticking it sets the per-device pref', () => {
    render(<DialsControlsPanel />);
    const section = document.querySelector('[data-section="Sound"]');
    expect(section).toBeTruthy();
    const box = section!.querySelector('[data-low-latency-audio] input[type="checkbox"]') as HTMLInputElement;
    expect(box).toBeTruthy();
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(useControls.getState().audioPrefs.lowLatency).toBe(true);
    // It says when it applies, or that this browser ignores it.
    expect(section!.querySelector('[data-low-latency-audio]')!.textContent).toMatch(/reload|ignores/);
  });
});
