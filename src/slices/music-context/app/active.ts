/**
 * The timeline in force, from the producers' layers: each producer (the loaded score, the player's
 * own entries; later an estimate from the audio) publishes its layer here, and the transient field
 * the graph reads (`musicContextActive`) is their combination (`combineLayers`).
 */
import { useSyncExternalStore } from 'react';
import { controls } from '@thoremin/sdk-ui/host';
import type { ActiveContext } from '@thoremin/sdk/context/reading';
import { MUSIC_CONTEXT_ACTIVE } from '../schema';
import { combineLayers, type Layers } from './combine';

const layers: Layers = {};

/** Publish a producer's layer (null withdraws it) and hand the graph the timeline in force. */
export function setLayer<K extends keyof Layers>(id: K, layer: Layers[K]): void {
  layers[id] = layer;
  const next = combineLayers(layers);
  if (controls().get()[MUSIC_CONTEXT_ACTIVE] !== next) controls().setTransient(MUSIC_CONTEXT_ACTIVE, next);
}

/** The timeline in force now (null: none). */
export const activeContext = (): ActiveContext | null => (controls().get()[MUSIC_CONTEXT_ACTIVE] as ActiveContext | null | undefined) ?? null;

const subscribe = (listener: () => void): (() => void) => controls().subscribe(listener);

/** A React hook over the timeline in force. */
export const useActiveContext = (): ActiveContext | null => useSyncExternalStore(subscribe, activeContext, activeContext);
