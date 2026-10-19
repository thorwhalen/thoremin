/**
 * Two small watchers the face session store runs inside its poll, apart from it so the store
 * does not grow with every status line: the rest ring and "stay relaxed" (#403) and the room's
 * light (#348). Each tells the store only when what a person can see changes.
 */
import { createLightJudge } from '@thoremin/sdk/enroll/light';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import type { LiveFrames } from './thumbnails';

/** The slice of the store a watcher reads and writes. */
export interface WatchStore<S> {
  get(): S;
  set(patch: Partial<S>): void;
}

export interface RestWatchConfig {
  progressStep: number;
  movingAt: number;
  movingForMs: number;
  movingHoldMs: number;
}

/** The rest ring and "stay relaxed" (#403). A movement counts once it has lasted `movingForMs`
 *  (a blink is not one), and shows for `movingHoldMs` after it ends. */
export function createRestWatch(store: WatchStore<{ restProgress: number | null; restMoving: boolean }>, config: RestWatchConfig) {
  let overSince: number | null = null;
  let movedAt = Number.NEGATIVE_INFINITY;
  const reset = () => {
    overSince = null;
    movedAt = Number.NEGATIVE_INFINITY;
  };
  return {
    reset,
    watch(progress: number | null, motion: number | null, tMs: number) {
      const shown = progress === null ? null : Math.floor(progress / config.progressStep + 1e-9) * config.progressStep;
      if (progress === null) reset();
      else if (motion === null || motion < config.movingAt) overSince = null;
      else {
        overSince ??= tMs;
        if (tMs - overSince >= config.movingForMs) movedAt = tMs;
      }
      const moving = tMs - movedAt < config.movingHoldMs;
      const s = store.get();
      if (s.restProgress !== shown || s.restMoving !== moving) store.set({ restProgress: shown, restMoving: moving });
    },
  };
}

/** The room's light (#348): read from the frame showing once per `everyMs`, over the crop the
 *  modality places the part in, judged over a few readings; the status line follows. */
export function createLightWatch(
  store: WatchStore<{ tooDark: boolean }>,
  options: { everyMs: number; frames: () => LiveFrames | null; region?: (at: { vector: FeatureVector; width: number; height: number }) => ReturnType<NonNullable<NonNullable<Parameters<NonNullable<LiveFrames['luma']>>[0]>>> },
) {
  const judge = createLightJudge();
  let at = Number.NEGATIVE_INFINITY;
  return {
    reset() {
      judge.reset();
      at = Number.NEGATIVE_INFINITY;
    },
    watch(vector: FeatureVector | null, nowMs: number) {
      const frames = options.frames();
      if (!frames?.luma || nowMs - at < options.everyMs) return;
      at = nowMs;
      const { region } = options;
      const dark = judge.push(frames.luma(region && vector ? (size) => region({ vector, ...size }) : null));
      if (store.get().tooDark !== dark) store.set({ tooDark: dark });
    },
  };
}
