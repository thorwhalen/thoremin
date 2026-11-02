/**
 * The musical-context slice's React half: the editor's Music section, the status hook that mirrors
 * the node for it, and the producers as mount effects (the loaded score's timeline).
 */
import type { ExtensionUi } from '@thoremin/sdk-ui/types';
import { MUSIC_CONTEXT_NODE_ID } from '@thoremin/sdk/context/reading';
import { MusicContextControls, MusicContextReadout } from './panels/MusicContextSection';
import { makeMusicContextReporter, useMusicContextStatus } from './app/status';
import { startScoreContext } from './app/scoreContext';
import { MUSIC_CONTEXT_EXTENSION_ID } from './index';
import type { MusicContextSettings } from './schema';

export const MUSIC_CONTEXT_UI: ExtensionUi = {
  id: MUSIC_CONTEXT_EXTENSION_ID,
  panels: [
    {
      instrumentId: 'musicContext',
      section: 'Music',
      Controls: MusicContextControls,
      Readout: MusicContextReadout,
      readoutOn: (s) => (s.musicContext as Partial<MusicContextSettings> | undefined)?.scaleFrom === 'music',
    },
  ],
  statusHooks: [
    {
      nodeId: MUSIC_CONTEXT_NODE_ID,
      make: (engine) => makeMusicContextReporter(engine),
      onRemoved: () => useMusicContextStatus.getState().reset(),
      reset: () => useMusicContextStatus.getState().reset(),
    },
  ],
  onMount: [() => startScoreContext()],
};

export default MUSIC_CONTEXT_UI;
