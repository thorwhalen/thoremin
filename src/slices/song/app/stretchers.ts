/**
 * Installs the song player's default stretchers (#600 S15): Signalsmith Stretch (an AudioWorklet,
 * #187 PR 7), which falls back by itself to the browser's media element, or the element outright.
 * Each loads by a dynamic `import()` the first time a song needs it, so neither is in the entry
 * chunk. Imported by the slice's React half; a test imports it to get the browser defaults.
 */
import { provideStretcherLoader } from '../nodes/song_player.schema';

provideStretcherLoader((kind) =>
  kind === 'element'
    ? import('./song_stretcher').then((m) => m.createMediaElementStretcher)
    : import('./song_stretcher_signalsmith').then((m) => m.createSignalsmithStretcher),
);
