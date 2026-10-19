/**
 * What the chord map hears from the microphone (H8 of #613, second part): the chroma of what is
 * sounding, and whether there is anything to hear it from. Pure: the microphone and its analyser
 * are the app half (`../app/micChordIn`).
 */

export interface AudioHeard {
  available: boolean;
  /** The energy of each pitch class (C first), the loudest 1; empty while nothing is heard. */
  chroma: number[];
  /** The total energy in the band read (silence is near 0). */
  energy: number;
  /** Why nothing can be heard: no microphone API, the player refused it, or the browser is asking. */
  reason?: 'unsupported' | 'denied' | 'pending';
}
