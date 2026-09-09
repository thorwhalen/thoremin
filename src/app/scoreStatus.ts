/**
 * The score loader's status (#187 PR 3): where the `ScoreLoader` component reports and
 * the Conductor panel reads. A tiny external store rather than React context so the
 * panel (mounted inside the settings editor) and the loader (mounted at the app root)
 * share it without threading props, the same shape as `generativeStatus.ts`.
 */
import { useSyncExternalStore } from 'react';
import type { LoadStatus } from '@/lazy';

let status: LoadStatus = { phase: 'off', message: 'No score loaded' };
const listeners = new Set<() => void>();

export function setScoreStatus(next: LoadStatus): void {
  status = next;
  for (const l of listeners) l();
}

export function getScoreStatus(): LoadStatus {
  return status;
}

export function subscribeScoreStatus(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useScoreStatus(): LoadStatus {
  return useSyncExternalStore(subscribeScoreStatus, getScoreStatus, getScoreStatus);
}
