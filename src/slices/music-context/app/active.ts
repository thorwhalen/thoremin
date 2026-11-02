/**
 * The timeline in force, from the producers' layers: each producer (the loaded score; later the
 * player's own entries and an estimate from the audio) publishes its layer here, and the transient
 * field the graph reads (`musicContextActive`) is the strongest one present. Ranked by
 * {@link LAYER_ORDER}: a score is exact, so it outranks an estimate.
 */
import { useSyncExternalStore } from 'react';
import { controls } from '@thoremin/sdk-ui/host';
import type { ActiveContext } from '@thoremin/sdk/context/reading';
import { MUSIC_CONTEXT_ACTIVE } from '../schema';

/** The producers' layers, strongest first. */
export const LAYER_ORDER = ['score'] as const;
export type LayerId = (typeof LAYER_ORDER)[number];

const layers = new Map<LayerId, ActiveContext>();

/** The timeline in force given the layers (null: none). */
export function strongest(from: ReadonlyMap<LayerId, ActiveContext>): ActiveContext | null {
  for (const id of LAYER_ORDER) {
    const layer = from.get(id);
    if (layer) return layer;
  }
  return null;
}

/** Publish a producer's layer (null withdraws it) and hand the graph the timeline in force. */
export function setLayer(id: LayerId, layer: ActiveContext | null): void {
  if (layer) layers.set(id, layer);
  else layers.delete(id);
  const next = strongest(layers);
  if (controls().get()[MUSIC_CONTEXT_ACTIVE] !== next) controls().setTransient(MUSIC_CONTEXT_ACTIVE, next);
}

/** The timeline in force now (null: none). */
export const activeContext = (): ActiveContext | null => (controls().get()[MUSIC_CONTEXT_ACTIVE] as ActiveContext | null | undefined) ?? null;

const subscribe = (listener: () => void): (() => void) => controls().subscribe(listener);

/** A React hook over the timeline in force. */
export const useActiveContext = (): ActiveContext | null => useSyncExternalStore(subscribe, activeContext, activeContext);
