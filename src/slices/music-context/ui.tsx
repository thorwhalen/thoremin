/**
 * The musical-context slice's React half: the editor's Music section, the Music tool (the player's
 * key, tapped tempo and chord chart for the piece playing), their commands, the status hooks (the
 * node, for the readout; the song's position, for the taps), and the producers as mount effects
 * (the loaded score's timeline, the player's).
 */
import { Music2 } from 'lucide-react';
import type { ExtensionUi } from '@thoremin/sdk-ui/types';
import { SONG_PLAYER } from '@thoremin/sdk/instruments/trunk';
import type { MusicalTime } from '@thoremin/ictus';
import { timingFrom } from '@thoremin/sdk/timing/tracker';
import { MUSIC_CONTEXT_NODE_ID } from '@thoremin/sdk/context/reading';
import { MusicContextControls, MusicContextReadout } from './panels/MusicContextSection';
import { makeMusicContextReporter, useMusicContextStatus } from './app/status';
import { startScoreContext } from './app/scoreContext';
import { mirrorSongTime, startUserContext } from './app/user';
import { MUSIC_COMMANDS } from './app/commands';
import { MusicTool } from './panels/MusicTool';
import { MUSIC_TOOL } from './tool';
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
    // The song's position, for the Music tool's taps.
    {
      nodeId: SONG_PLAYER,
      make: (engine, resources) => () => mirrorSongTime(engine.getOutput(SONG_PLAYER, 'songTime') as MusicalTime | undefined, timingFrom(resources()).outputStage.value),
      onRemoved: () => mirrorSongTime(null),
      reset: () => mirrorSongTime(null),
    },
  ],
  onMount: [() => startScoreContext(), () => startUserContext()],
  commands: MUSIC_COMMANDS,
  tools: [{ ...MUSIC_TOOL, Panel: MusicTool, icon: Music2 }],
};

export default MUSIC_CONTEXT_UI;
