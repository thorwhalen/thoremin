// @vitest-environment jsdom
/**
 * The listening games never open the camera (#869): each game seed composes nothing that reads
 * it, and Sing Along boots and plays through the real `useThoreminEngine` on a machine where
 * `getUserMedia({ video })` rejects, without ever calling it; switching to a hand instrument asks
 * for the camera then. Runs in the lab build (`npm run test:lab`), the one that lists the games.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { NO_SLOTS } from '@/app/graph';
import { useControls } from '@/app/store';
import { liveReadsCamera } from '@/app/engine/liveApply';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { seedSettings } from '../../scripts/stability/lib_run';
import { GAMES } from '../helpers/extensions';
import { Harness, stubMissingCamera, type Seen } from '../helpers/engine_boot';

const GAME_SEEDS = ['Sing Along', 'Play Along Lessons', 'Match the Note'];

const initial = useControls.getState();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useControls.setState(initial, true);
});

/** Load a seed into the hot store, as picking it in the library does. */
const load = (name: string) => useControls.getState().applySettings(seedSettings(name));

describe.runIf(GAMES)('the listening games and the camera', () => {
  for (const seed of GAME_SEEDS) {
    it(`${seed} reads no camera`, () => {
      load(seed);
      expect(liveReadsCamera(useControls.getState(), new Set())).toBe(false);
    });
  }

  it('Sing Along boots and plays without calling getUserMedia; a hand instrument then asks for it', async () => {
    load('Sing Along');
    const getUserMedia = stubMissingCamera();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: Seen = {};
    render(<Harness slots={NO_SLOTS} seen={seen} />);

    await waitFor(() => expect(seen.status).toBe('ready'), { timeout: 4000 });
    expect(seen.error).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();

    // The first seed is the default field instrument: the hands play it, so it reads the camera.
    act(() => load(SEED_INSTRUMENTS[0].name));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled(), { timeout: 4000 });
    expect(seen.status).toBe('ready');
  });
});
