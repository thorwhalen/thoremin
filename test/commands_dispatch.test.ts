/**
 * Command dispatch (#87) — dispatching a param-mutation command writes the dials
 * store AND syncs the hot `useControls` mirror (the same path the panel drives),
 * and every failure is DATA (`{ ok:false, error }`), never a thrown exception across
 * the dispatch boundary. Pure + headless: no camera, audio, or React.
 */
import { describe, it, expect } from 'vitest';
import { createThoreminRegistry, registry } from '@/app/commands';
import { dialsStore } from '@/app/dials/settingsStore';
import { useControls } from '@/app/store';

describe('command dispatch (#87)', () => {
  it('the registry exposes the generic dial commands', () => {
    expect(registry.has('dial.set')).toBe(true);
    expect(registry.has('dial.reset')).toBe(true);
    expect(registry.has('dial.patch')).toBe(true);
  });

  it('dispatch dial.set writes the dial AND syncs the hot store', async () => {
    const r = await registry.dispatch('dial.set', { key: 'right.root', value: 5 });
    expect(r.ok).toBe(true);
    expect(dialsStore.getState().effective['right.root']).toBe(5);
    expect(useControls.getState().right.root).toBe(5); // synced into the hot mirror
  });

  it('dispatch dial.reset returns a dial to its default', async () => {
    await registry.dispatch('dial.set', { key: 'right.octaves', value: 4 });
    expect(dialsStore.getState().effective['right.octaves']).toBe(4);
    const r = await registry.dispatch('dial.reset', { key: 'right.octaves' });
    expect(r.ok).toBe(true);
    expect(dialsStore.getState().effective['right.octaves']).toBe(2); // the dial's default
    expect(useControls.getState().right.octaves).toBe(2);
  });

  it('dispatch dial.patch sets several dials in order (a synced-voice edit)', async () => {
    const r = await registry.dispatch('dial.patch', {
      writes: [
        { key: 'right.root', value: 7 },
        { key: 'left.root', value: 7 },
      ],
    });
    expect(r.ok).toBe(true);
    expect(useControls.getState().right.root).toBe(7);
    expect(useControls.getState().left.root).toBe(7);
  });

  it('errors are DATA: an unknown dial → err(unknown_dial), never a throw', async () => {
    const r = await registry.dispatch('dial.set', { key: 'nope.nope', value: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('unknown_dial');
  });

  it('bad params (missing key) → err(invalid_params) from the schema, no throw', async () => {
    const r = await registry.dispatch('dial.set', { value: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid_params');
  });

  it('rejects an out-of-range VALUE (errors-as-data) and leaves the hot store unchanged', async () => {
    // master.volume is bound 0..1 — the write must be refused, not silently dropped
    // into the dials layer while the audio keeps the old value (the false-ok trap).
    const before = useControls.getState().masterVolume;
    const r = await registry.dispatch('dial.set', { key: 'master.volume', value: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid_value');
    expect(useControls.getState().masterVolume).toBe(before); // audio never changed
    expect(dialsStore.getState().effective['master.volume']).toBe(before); // dials layer clean
  });

  it('dial.patch is atomic: one invalid value rejects the WHOLE batch (no partial write)', async () => {
    const rootBefore = dialsStore.getState().effective['right.root'];
    const r = await registry.dispatch('dial.patch', {
      writes: [
        { key: 'right.root', value: 6 }, // valid
        { key: 'right.octaves', value: 99 }, // valid KEY, invalid VALUE (max 4) → rejects the batch
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid_value');
    // Neither write landed: the earlier (valid) write did NOT half-apply.
    expect(dialsStore.getState().effective['right.root']).toBe(rootBefore);
    expect(dialsStore.getState().effective['right.octaves']).not.toBe(99);
  });

  it('sync/mode are just dials: dispatching dial.set on master.syncHands works', async () => {
    // No special "toggle sync" command — sync-hands is the `master.syncHands` dial,
    // so the generic verb covers it (and the generated per-dial command does too).
    const iso = createThoreminRegistry();
    expect(iso.has('dial.set')).toBe(true); // generic verbs (+ generated per-dial commands) registered
    const r = await iso.dispatch('dial.set', { key: 'master.syncHands', value: false });
    expect(r.ok).toBe(true);
    expect(useControls.getState().syncHands).toBe(false);
  });
});
