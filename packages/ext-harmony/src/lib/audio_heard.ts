/**
 * What the chord map hears from the microphone (H8 of #613, second part): the chroma of what is
 * sounding, and whether there is anything to hear it from. Pure: the microphone and its analyser
 * are the app half (`../app/micChordIn`).
 */

export interface AudioHeard {
  available: boolean;
  /** The energy of each pitch class (C first), the loudest 1, to two decimals; empty while
   *  nothing is sounding. */
  chroma: number[];
  /** Something is sounding: clearly above the room's own noise floor. */
  sounding: boolean;
  /** Why nothing can be heard: no microphone API, the player refused it, the browser is still
   *  asking, or it opened and then failed. */
  reason?: 'unsupported' | 'denied' | 'pending' | 'failed';
}
