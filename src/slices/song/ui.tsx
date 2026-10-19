/**
 * The song slice's React half (#600 S15): the Song tool (its panel, running detached with the bar's
 * stop control, its icon), "Conduct a recording" as a section of the Conductor panel, the song
 * commands, and the status hook that mirrors the player and the pace controller into the Song
 * tool's readout. Importing it installs the song host the commands act through (`./app/host`).
 */
import { Disc3 } from 'lucide-react';
import type { ExtensionUi } from '@thoremin/sdk-ui/types';
import { dispatchCommand } from '@thoremin/sdk-ui/dials';
import './app/host';
import './app/stretchers';
import SongPanel, { SONG_TOOL_ID } from './panels/SongPanel';
import { RecordingSection, recordingStart, recordingStop } from './panels/RecordingSection';
import { makeSongReporter, SONG_NODE_ID, useSongStatus } from './app/songStatus';
import { SONG_COMMANDS } from './app/songCommands';
import { setSongPlaying, songPlaying, useSongField } from './app/state';

/** The transport goes off, if it is on (a song that ended, an engine that is gone). */
function stopTransport(): void {
  try {
    if (songPlaying()) setSongPlaying(false);
  } catch {
    // No hot store in this host (a headless test): no transport to stop.
  }
}

export const SONG_UI: ExtensionUi = {
  id: 'song-tool',
  panels: [],
  statusHooks: [
    {
      nodeId: SONG_NODE_ID,
      // A song that played to its end, or one the browser refused to start, is not playing.
      make: (engine) => makeSongReporter(engine, useSongStatus.getState(), stopTransport),
      onRemoved: () => useSongStatus.getState().reset(),
      // The engine is gone: the new player must not start the song by itself on the next tap.
      reset: () => {
        useSongStatus.getState().reset();
        stopTransport();
      },
    },
  ],
  onMount: [],
  commands: SONG_COMMANDS,
  // A tool, not a mode: the song plays under whatever instrument is loaded, and on with its panel
  // closed, so it runs detached and the bar carries its stop control (`song.pause`, a command).
  tools: [
    {
      id: SONG_TOOL_ID,
      label: 'Song',
      description: 'Load a song to dance or play along to: its beat is tracked in the browser, and it plays at any tempo without changing pitch.',
      group: 'tool',
      defaultPinned: false,
      Panel: SongPanel,
      icon: Disc3,
      detached: { useRunning: () => useSongField(songPlaying), stop: () => void dispatchCommand('song.pause', {}), hint: 'pause the song' },
    },
  ],
  toolSections: [{ id: 'song.recording', from: 'conductor', when: { 'conductor.conducts': 'recording' }, Section: RecordingSection, on: { start: recordingStart, stop: recordingStop } }],
};

export default SONG_UI;
