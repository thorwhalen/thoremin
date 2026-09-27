/**
 * The pattern in play (#269): keep the air drum's `pattern` port in step with the
 * `airDrum.pattern` dial.
 *
 * The dial names a pattern id ('' for none). The node needs the pattern and its trained
 * model, which live in code (`DRUM_PATTERNS`) and in the pattern-models collection, so
 * this watches the dial, loads the model (async, off the tick) and publishes
 * `{pattern, model}` to the hot store's transient slot, which the store-controls node
 * feeds to the air drum. A pattern with no model yet publishes null: the mode is off
 * until the take that trains it. The `startFlutePriorSync` pattern.
 */
import { patternById } from '@/music/drum_patterns';
import type { PatternPlay } from '@/drums/pattern_play';
import type { PatternModel } from '@/drums/pattern_fit';
import { useControls } from '../store';
import { loadPatternModel } from './patternModels';

type DrumState = { airDrum?: { pattern?: string } };

export interface PatternPlaySyncDeps {
  store?: { getState(): DrumState; subscribe(l: (s: DrumState) => void): () => void };
  publish?: (play: PatternPlay | null) => void;
  load?: (patternId: string) => Promise<PatternModel | null>;
}

/** Resolve a dial value to what the node plays, or null. */
export async function resolvePatternPlay(patternId: string, load: (id: string) => Promise<PatternModel | null> = loadPatternModel): Promise<PatternPlay | null> {
  const pattern = patternById(patternId);
  if (!pattern) return null;
  const model = await load(pattern.id);
  return model ? { pattern, model } : null;
}

/** Start watching the dial. Returns the unsubscribe. A stale load (the dial changed
 *  again before the model arrived) is dropped. */
export function startPatternPlaySync(deps: PatternPlaySyncDeps = {}): () => void {
  const store = deps.store ?? useControls;
  const publish = deps.publish ?? ((play) => useControls.getState().setAirDrumPattern(play));
  let last: string | null = null;
  let generation = 0;
  const apply = (s: DrumState) => {
    const id = s.airDrum?.pattern ?? '';
    if (id === last) return;
    last = id;
    const mine = ++generation;
    void resolvePatternPlay(id, deps.load)
      .then((play) => {
        if (mine === generation) publish(play);
      })
      .catch(() => {
        if (mine === generation) publish(null);
      });
  };
  apply(store.getState());
  const unsubscribe = store.subscribe(apply);
  return () => {
    unsubscribe();
    generation += 1;
    publish(null);
  };
}

/** After a take trains a pattern, the mode picks the new model up: call this. */
export function refreshPatternPlay(deps: Pick<PatternPlaySyncDeps, 'publish' | 'load'> = {}): void {
  const id = useControls.getState().airDrum?.pattern ?? '';
  const publish = deps.publish ?? ((play) => useControls.getState().setAirDrumPattern(play));
  void resolvePatternPlay(id, deps.load).then(publish);
}
