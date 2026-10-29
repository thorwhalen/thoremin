/**
 * The listening games' React half: the editor section (game, lesson, difficulty, Start and Stop,
 * the timing take) and the status hook that mirrors the game node's status into the store the
 * section reads.
 */
import type { ExtensionUi } from '@thoremin/sdk-ui/types';
import { GamesControls, GamesReadout } from './panels/GamesPanel';
import { makeGamesReporter, useGamesStatus } from './app/status';
import { startAutostart } from './app/controls';
import { GAMES_DIAL, GAMES_EXTENSION_ID, GAMES_NODE_ID } from '.';

export const GAMES_UI: ExtensionUi = {
  id: GAMES_EXTENSION_ID,
  panels: [{ instrumentId: GAMES_DIAL, section: 'Listening games', Controls: GamesControls, Readout: GamesReadout }],
  statusHooks: [
    {
      nodeId: GAMES_NODE_ID,
      make: (engine) => makeGamesReporter(engine, GAMES_NODE_ID),
      onRemoved: () => useGamesStatus.getState().reset(),
      reset: () => useGamesStatus.getState().reset(),
    },
  ],
  onMount: [() => startAutostart()],
};

export default GAMES_UI;
