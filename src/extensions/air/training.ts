/**
 * The air instruments' training (#263, #269): the flute and the guitar learn by a scripted
 * sequence and the drum by a pattern take, each in its own settings section. Core's
 * `src/app/training/routes.ts` folds these routes in before its Trainer tool, and resolves an
 * instrument to the first of them whose branch it composes (the flute before the guitar before
 * the drum: the lead instrument).
 *
 * Pure: data only. The trainers render the anchors as DOM ids, so a route can find them.
 */
import type { ExtensionTraining } from '@thoremin/sdk/instruments/extension';

/** The DOM ids the air trainers render, so a route can find them. */
export const TRAINING_ANCHORS = {
  fluteSequence: 'training-sequence-flute',
  guitarSequence: 'training-sequence-guitar',
  drumPatterns: 'training-patterns-drum',
} as const;

export const AIR_TRAINING: ExtensionTraining = {
  routes: [
    {
      id: 'sequence:flute',
      label: 'Learn a sequence of notes',
      hint: 'Walk through a scale or a list of notes; every note you hold is learned.',
      section: { label: 'Air flute', anchor: TRAINING_ANCHORS.fluteSequence },
    },
    {
      id: 'sequence:guitar',
      label: 'Learn a sequence of chords',
      hint: 'Walk through a list of chords; every shape you hold is learned.',
      section: { label: 'Air guitar', anchor: TRAINING_ANCHORS.guitarSequence },
    },
    {
      id: 'patterns:drum',
      label: 'Learn a drum pattern',
      hint: 'Play a pattern through a few times; your tempo, feel and pads are learned, then played back snapped.',
      section: { label: 'Air drum', anchor: TRAINING_ANCHORS.drumPatterns },
    },
  ],
  byBranch: [
    ['air-flute', 'sequence:flute'],
    ['air-guitar', 'sequence:guitar'],
    ['air-drum', 'patterns:drum'],
  ],
};
