/**
 * The body conductor's timing commands (#427): keep the lead offsets a "Learn my timing"
 * take measured, or forget them. Through the one dispatch surface (#87), so the Conductor
 * tool's buttons, the palette and the AI assistant write the per-device pref the same way.
 * The take itself is not a command: it plays a click and listens, which is not a parameter.
 */
import { z } from 'zod';
import { defineCommand, ok, err } from 'acture';
import { conductorLeadHost } from './conductorLeadCommandHost';

const CATEGORY = 'Conductor';

/** Keep the finished take's offsets. */
export const keepConductorTimingCmd = defineCommand({
  id: 'conductor.timing.keep',
  title: 'Keep my conducting timing',
  description: "Keep the lead offsets the last 'Learn my timing' take measured (the body conductor subtracts each joint's lag from its beats). Joints the take did not measure keep their offsets.",
  category: CATEGORY,
  params: z.object({}),
  execute: async () => {
    const kept = conductorLeadHost().keep();
    if (!kept) return err('nothing_to_keep', "Nothing to keep: no 'Learn my timing' take has finished, or it measured no joint well enough (the Conductor tool, conducting with the body).");
    return ok({ offsets: kept });
  },
});

/** Forget the kept offsets. */
export const clearConductorTimingCmd = defineCommand({
  id: 'conductor.timing.clear',
  title: 'Forget my conducting timing',
  description: "Forget the body conductor's learned lead offsets: every joint's beats are played where they land again.",
  category: CATEGORY,
  params: z.object({}),
  execute: async () => {
    conductorLeadHost().clear();
    return ok({ offsets: {} });
  },
});

export const CONDUCTOR_TIMING_COMMANDS = [keepConductorTimingCmd, clearConductorTimingCmd] as const;
