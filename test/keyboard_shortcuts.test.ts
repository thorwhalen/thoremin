/**
 * Keyboard shortcuts (#90): the octave / magnetism actions dispatch dial commands
 * (so the keymap goes through the single write path) and land the store update
 * synchronously (dial.set's handler runs before dispatch's first await); mute is a
 * direct store toggle. The tinykeys DOM wiring is browser-only — these cover the
 * pure action logic + clamping. The isEditableTarget guard is covered in
 * keyboard_control.test.ts (the export is shared).
 */
import { describe, it, expect } from 'vitest';
import { shiftOctave, adjustMagnetism, toggleMute, DEFAULT_KEYMAP } from '../src/app/keyboardShortcuts';
import { registry } from '../src/app/commands/registry';
import { useControls } from '../src/app/store';

const setOctave = (v: number) => registry.dispatch('dial.set', { key: 'master.octaveShift', value: v });
const setMagnetism = (v: number) => registry.dispatch('dial.set', { key: 'master.magnetism', value: v });

describe('keyboard shortcuts (#90)', () => {
  it('shiftOctave dispatches dial.set, accumulates, and clamps to +2', async () => {
    await setOctave(0);
    shiftOctave(1);
    expect(useControls.getState().octaveShift).toBe(1); // synchronous via the command path
    shiftOctave(1);
    expect(useControls.getState().octaveShift).toBe(2);
    shiftOctave(1); // clamp
    expect(useControls.getState().octaveShift).toBe(2);
  });

  it('shiftOctave clamps to -2', async () => {
    await setOctave(0);
    shiftOctave(-1);
    shiftOctave(-1);
    shiftOctave(-1);
    expect(useControls.getState().octaveShift).toBe(-2);
  });

  it('adjustMagnetism accumulates and clamps to 1', async () => {
    await setMagnetism(0.8);
    adjustMagnetism(0.1);
    expect(useControls.getState().magnetism).toBeCloseTo(0.9, 10);
    adjustMagnetism(0.1);
    expect(useControls.getState().magnetism).toBeCloseTo(1.0, 10); // clamp
    adjustMagnetism(0.1);
    expect(useControls.getState().magnetism).toBeCloseTo(1.0, 10);
  });

  it('adjustMagnetism clamps to 0', async () => {
    await setMagnetism(0.05);
    adjustMagnetism(-0.1);
    expect(useControls.getState().magnetism).toBe(0);
  });

  it('toggleMute flips store.muted', () => {
    const before = useControls.getState().muted;
    toggleMute();
    expect(useControls.getState().muted).toBe(!before);
    toggleMute();
    expect(useControls.getState().muted).toBe(before);
  });

  it('DEFAULT_KEYMAP binds the expected keys', () => {
    expect(Object.keys(DEFAULT_KEYMAP).sort()).toEqual(['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'm']);
  });
});
