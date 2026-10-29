/**
 * The games slice's view of the controls (`@thoremin/sdk-ui/host`'s seam), typed by its own
 * manifest. A type-only import of the manifest, so no runtime cycle.
 */
import { controls, controlsFor } from '@thoremin/sdk-ui/host';
import type { GAMES_EXTENSION } from '..';
import { GAMES_PREFS, type GamesPrefs } from '../schema';

export const gamesControls = controlsFor<typeof GAMES_EXTENSION>();

/** Start the selected game (a new session even when one runs). */
export function startGame(): void {
  const c = gamesControls.get();
  gamesControls.setTransient('gamesRun', (c.gamesRun ?? 0) + 1);
  gamesControls.setTransient('gamesPlaying', true);
}

export function stopGame(): void {
  gamesControls.setTransient('gamesPlaying', false);
}

/** Keep a calibration take's estimate as this device's offset. */
export function keepOffset(prefs: GamesPrefs): void {
  controls().setPref(GAMES_PREFS, prefs);
}

/**
 * `?games.autostart=1`: start a game as soon as an instrument turns the games on (once per
 * enabling), for the guide's pictures and the browser smoke, which have no one to press Start.
 */
export function startAutostart(search: string = typeof location === 'undefined' ? '' : location.search): () => void {
  if (new URLSearchParams(search).get('games.autostart') !== '1') return () => undefined;
  let started = false;
  const check = () => {
    const c = gamesControls.get();
    const on = (c.games as { enabled?: boolean } | undefined)?.enabled === true;
    if (!on) started = false;
    else if (!started) {
      started = true;
      startGame();
    }
  };
  check();
  return gamesControls.store().subscribe(check);
}
