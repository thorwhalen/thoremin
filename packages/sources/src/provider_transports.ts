/**
 * What each controllable provider's player can do, as data: read by its adapter (what it declares)
 * and by its player module (what it reports), so neither imports the other.
 */
import { NO_CONTROL } from './embed';
import type { TransportCapabilities } from './types';

/** The rates the YouTube IFrame API documents; a video's own list replaces them once its player is ready. */
export const YOUTUBE_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export const YOUTUBE_TRANSPORT: TransportCapabilities = {
  ...NO_CONTROL,
  play: true,
  position: true,
  seek: true,
  rate: { min: 0.25, max: 2, steps: YOUTUBE_RATES },
  volume: true,
};

export const SOUNDCLOUD_TRANSPORT: TransportCapabilities = { ...NO_CONTROL, play: true, position: true, seek: true, volume: true };

/** Spotify seeks in whole seconds and offers no tempo or volume. */
export const SPOTIFY_TRANSPORT: TransportCapabilities = { ...NO_CONTROL, play: true, position: true, seek: true, seekGranularity: { s: 1, source: 'stated' } };
