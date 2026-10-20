/**
 * The generative transport (#188; the slice's since #600 S14, moved from
 * `test/keyboard_shortcuts.test.ts` with its assertions): `p` plays and pauses the transient
 * transport, only while the layer is enabled, through the key's `run` action (deliberately not a
 * command: nothing but a human press may start a paid stream); switching the layer off pauses it (the rule `applySettings` held in core).
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_KEYMAP } from '@/app/shell/keyboardShortcuts';
import { useControls } from '@/app/store';
import { registry } from '@/app/commands/registry';
import { pauseWhenDisabled } from '@/slices/generative/app/transport';
import { GENERATIVE } from '../helpers/extensions';

type WithSteer = { steer: { enabled: boolean; volume: number; config: unknown }; steerPlaying: boolean | null };
const state = () => useControls.getState() as unknown as WithSteer;
const setEnabled = (enabled: boolean) => {
  const s = useControls.getState();
  s.applySettings({ ...s, steer: { ...state().steer, enabled } } as never);
};
const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe.runIf(GENERATIVE)('the generative transport shortcut (#188)', () => {
  it("'p' toggles the transient transport only while the layer is enabled", async () => {
    expect(DEFAULT_KEYMAP.p).toBeTypeOf('function');
    // Not a command: no assistant tool, palette entry or gesture can start the stream.
    expect(registry.list().some((c) => /play/i.test(c.id) && c.id.startsWith('generative'))).toBe(false);
    setEnabled(false);
    useControls.setState({ steerPlaying: false } as never);
    DEFAULT_KEYMAP.p();
    await flush();
    expect(state().steerPlaying).toBe(false); // disabled: a no-op, never a stale flag
    setEnabled(true);
    DEFAULT_KEYMAP.p();
    await flush();
    expect(state().steerPlaying).toBe(true);
    DEFAULT_KEYMAP.p();
    await flush();
    expect(state().steerPlaying).toBe(false);
  });

  it('switching the layer off pauses the transport', async () => {
    const stop = pauseWhenDisabled();
    try {
      setEnabled(true);
      useControls.setState({ steerPlaying: true } as never);
      setEnabled(false);
      expect(state().steerPlaying).toBe(false);
    } finally {
      stop();
    }
  });
});
