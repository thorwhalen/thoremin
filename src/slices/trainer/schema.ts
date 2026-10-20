/**
 * The Trainer's per-device HUD pref (#163 §5; the Trainer slice's since #600 S16d): whether the
 * running banner's words are also painted into the video, and on which edge. Kept under the key it
 * always had (`trainerHud`), so a returning player's choice carries over; core's v18 store step
 * (the show default turned off once) still runs on it, in core's chain, before the slice reads it.
 */
import { z } from 'zod';

/** The hot-store field (and persisted key) of the HUD pref. */
export const TRAINER_HUD_PREF = 'trainerHud';

export const TrainerHudParamsSchema = z
  .object({
    /** Off by default since the Trainer's own banner moved above every panel (the
     *  on-screen instruction lives there now); on, the same words are also painted INTO
     *  the video, which a screen recording of the composited canvas then carries. */
    show: z.boolean().default(false),
    /** Which edge the banner anchors to. */
    position: z.enum(['bottom', 'top']).default('bottom'),
  })
  .prefault({});
export type TrainerHudParams = z.infer<typeof TrainerHudParamsSchema>;

export const defaultTrainerHud = (): TrainerHudParams => TrainerHudParamsSchema.parse({});
