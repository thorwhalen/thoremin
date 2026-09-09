/**
 * `ScoreLoader` (#187 PR 3) — the headless component that keeps the loaded score in
 * step with the conductor dial. Mounted once at the app root (so the score loads even
 * while the settings editor is closed): whenever conducting is enabled and `piece`
 * changes, it resolves the piece (`resolvePiece.ts`), hands the document to the hot
 * store (`setScoreDoc`, which `store-controls` emits to the `score` node), and reports
 * the shared load status for the Conductor panel's readout. Nothing loads while
 * conducting is off — the parsers and the demo file are a lazy cost of turning it on.
 */
import { useEffect } from 'react';
import { createScoreStore } from '@/score';
import { useDialsSettings } from './dials/useDialsSettings';
import { fetchBytesFromUrl, resolvePiece } from './resolvePiece';
import { setScoreStatus } from './scoreStatus';
import { useControls } from './store';
import type { ConductorSettings } from '@/settings/schema';

const scoreStore = createScoreStore();

export default function ScoreLoader() {
  const { state } = useDialsSettings();
  const conductor = (state.effective.conductor ?? {}) as Partial<ConductorSettings>;
  const enabled = conductor.enabled === true;
  const piece = conductor.piece ?? '';
  const setScoreDoc = useControls((s) => s.setScoreDoc);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const baseUrl = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    void resolvePiece(piece, { fetchBytes: fetchBytesFromUrl, baseUrl, store: scoreStore }, (s) => {
      if (!cancelled) setScoreStatus(s);
    }).then((doc) => {
      if (!cancelled) setScoreDoc(doc);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, piece, setScoreDoc]);

  return null;
}
