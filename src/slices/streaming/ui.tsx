/**
 * The streaming embeds slice's React half: on mount, Spotify and Apple Music join the Song tool's
 * sources (`@thoremin/sdk-ui/sources`), so their links open in their own players.
 */
import type { ExtensionUi } from '@thoremin/sdk-ui/types';
import { contributeSourceAdapters } from '@thoremin/sdk-ui/sources';
import { createAppleMusicAdapter, createSpotifyAdapter } from '@thoremin/sources';

export const STREAMING_UI: ExtensionUi = {
  id: 'streaming-embeds',
  panels: [],
  statusHooks: [],
  onMount: [() => contributeSourceAdapters([createSpotifyAdapter(), createAppleMusicAdapter()])],
};

export default STREAMING_UI;
