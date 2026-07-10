/**
 * The assistant's app-layer mount (#87 Phase 3) — the HEAVY half, lazily loaded by
 * {@link ./AssistantOverlay} the first time the user opens the assistant (so the AI SDK
 * stays out of the initial bundle). Owns the single {@link AssistantSession} + persisted
 * settings, seeds/persists the transcript in localStorage, and renders the chat card.
 */
import { useEffect, useMemo } from 'react';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { AssistantSession } from './AssistantSession';
import { AssistantOverlayPanel } from './AssistantOverlayPanel';
import { DEFAULT_ASSISTANT_SETTINGS, type AssistantSettings, type ChatMessage } from './types';

const HISTORY_KEY = 'thoremin:plugin:assistant:history';
const MAX_PERSISTED = 50;

export default function AssistantChat({ onClose }: { onClose: () => void }) {
  const session = useMemo(() => new AssistantSession(), []);
  const [settings, setSettings] = useLocalStorage<AssistantSettings>(
    'thoremin:plugin:assistant:settings',
    DEFAULT_ASSISTANT_SETTINGS,
  );

  // Seed from persisted history once; persist the settled transcript on every change.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) session.loadHistory(JSON.parse(raw) as ChatMessage[]);
    } catch {
      /* ignore malformed history */
    }
    const persist = () => {
      if (session.busy) return; // wait for the turn to settle before writing
      localStorage.setItem(HISTORY_KEY, JSON.stringify(session.messages.slice(-MAX_PERSISTED)));
    };
    session.addEventListener('change', persist);
    return () => {
      session.removeEventListener('change', persist);
      session.dispose();
      // Flush unconditionally on teardown: closing mid-turn aborts it, but a turn may have
      // already applied additive dial edits to the instrument, so persist the partial
      // record too (loadHistory clears the `pending` flag on the next open).
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(session.messages.slice(-MAX_PERSISTED)));
      } catch {
        /* ignore */
      }
    };
  }, [session]);

  return <AssistantOverlayPanel session={session} settings={settings} onSettings={setSettings} onClose={onClose} />;
}
