// @vitest-environment jsdom
/**
 * One app registry per page (#974 item 2): the live engine and the camera derivation read the
 * same `pageAppRegistry()`, never a registry each. A second one would read a lazy extension's
 * types as unloaded after the engine's had loaded them, and building one is a full fold of every
 * extension's nodes.
 *
 * Counted where every app registry is made: `createRegistry` from `@thoremin/dag`, called with
 * the generated `store-controls` among the definitions. The real hook boots, its slots change (the
 * derivation's input, and a live re-wire), and it is torn down and mounted again (a rebuild): one
 * app registry throughout.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { NO_SLOTS } from '@/app/graph';
import { useControls } from '@/app/store';
import { Harness, stubMissingCamera, type Seen } from './helpers/engine_boot';

const built = vi.hoisted(() => ({ app: 0 }));

vi.mock('@thoremin/dag', async (importOriginal) => {
  const dag = await importOriginal<typeof import('@thoremin/dag')>();
  return {
    ...dag,
    createRegistry: (defs: Parameters<typeof dag.createRegistry>[0] = []) => {
      if (defs.some((d) => d.type === 'store-controls')) built.app += 1;
      return dag.createRegistry(defs);
    },
  };
});

const initial = useControls.getState();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useControls.setState(initial, true);
});

/** An instrument that reads no camera, so the boot needs none. */
function listenOnly(): void {
  const s = useControls.getState();
  useControls.setState({
    handMap: { ...s.handMap, maxGain: 0 },
    faceMapping: 'none',
    overlay: { ...s.overlay, video: { ...s.overlay.video, show: false }, landmarks: { ...s.overlay.landmarks, show: false } },
  });
}

describe('one app registry per page', () => {
  it('the engine and the camera derivation share it, across a slot change and a rebuild', async () => {
    listenOnly();
    stubMissingCamera();
    const seen: Seen = {};
    const first = render(<Harness slots={NO_SLOTS} seen={seen} />);
    await waitFor(() => expect(seen.status).toBe('ready'), { timeout: 4000 });
    expect(built.app).toBe(1);

    first.rerender(<Harness slots={{ body: 'synthetic-body' }} seen={seen} />);
    await waitFor(() => expect(seen.status).toBe('ready'), { timeout: 4000 });
    first.unmount();

    const again: Seen = {};
    render(<Harness slots={NO_SLOTS} seen={again} />);
    await waitFor(() => expect(again.status).toBe('ready'), { timeout: 4000 });
    expect(built.app).toBe(1);
  });
});
