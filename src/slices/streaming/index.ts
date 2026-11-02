/**
 * The streaming embeds slice (lab build only, `extensions.lab.json`): Spotify and Apple Music in
 * the Song tool, by link, each in its own official player (`embed_only`, like YouTube). It has no
 * nodes, dials or branches: its React half adds the two source adapters to the Song tool's search
 * box on mount.
 */
import { defineExtension } from '@thoremin/sdk/instruments/extension';

export const STREAMING_EXTENSION = defineExtension({
  id: 'streaming-embeds',
  nodes: [],
  branches: [],
  dials: [] as const,
  derive: () => [],
});

export default STREAMING_EXTENSION;
