/**
 * The score loader (#187 PR 3; a mount effect of the conductor slice since #600 S18b, a component
 * at the app root before): keeps the loaded score in step with the conductor dial, so the score
 * loads even while the settings editor is closed. Whenever conducting is enabled and `piece`
 * changes, it resolves the piece (`resolvePiece.ts`), hands the document to the graph (the
 * `scoreDoc` transient, which `store-controls` emits to the `score` node), and reports the shared
 * load status for the Conductor panel's readout. Nothing loads while conducting is off: the
 * parsers and the demo file are a lazy cost of turning it on.
 */
import { controls } from '@thoremin/sdk-ui/host';
import { createScoreStore } from '../score';
import { fetchBytesFromUrl, resolvePiece } from './resolvePiece';
import { setScoreStatus } from './scoreStatus';
import { setScoreDoc } from './state';
import type { ConductorSettings } from '../schema';

const scoreStore = createScoreStore();

/** Start following the dial; returns the stop (which also abandons a load in flight). */
export function startScoreLoader(): () => void {
  let key: string | null = null;
  let abandon: (() => void) | null = null;
  const apply = (): void => {
    const conductor = (controls().get().conductor ?? {}) as Partial<ConductorSettings>;
    const enabled = conductor.enabled === true;
    const piece = conductor.piece ?? '';
    const next = enabled ? `on:${piece}` : 'off';
    if (next === key) return;
    key = next;
    abandon?.();
    abandon = null;
    if (!enabled) return;
    let cancelled = false;
    abandon = () => {
      cancelled = true;
    };
    const baseUrl = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    void resolvePiece(piece, { fetchBytes: fetchBytesFromUrl, baseUrl, store: scoreStore }, (s) => {
      if (!cancelled) setScoreStatus(s);
    }).then((doc) => {
      if (!cancelled) setScoreDoc(doc);
    });
  };
  apply();
  const unsubscribe = controls().subscribe(apply);
  return () => {
    unsubscribe();
    abandon?.();
  };
}
