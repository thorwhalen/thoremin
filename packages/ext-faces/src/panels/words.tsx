/**
 * The modality's words for the carve panels (#385 E8): "Your faces" and "Your hand shapes" are one
 * set of panels, and every sentence that names what is carved takes the noun from here (`one`:
 * `face` / `hand shape`, `many`, `part`: `face` / `hand`). The panel's root provides its store's
 * modality; the face's words are the default, so a panel rendered alone reads as it always did.
 */
import { createContext, useContext } from 'react';
import type { ModalityWords } from '@thoremin/sdk/enroll/modality';
import { faceModality } from '@thoremin/sdk/features/modalities/face';

export const WordsContext = createContext<ModalityWords>(faceModality.words);

/** The words of the modality the panel shows. */
export function useWords(): ModalityWords {
  return useContext(WordsContext);
}
