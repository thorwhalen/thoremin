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
import { isKnownModel, recommendedModel } from './providers';
import { DEFAULT_ASSISTANT_SETTINGS, type AssistantSettings, type ChatMessage } from './types';

const HISTORY_KEY = 'thoremin:plugin:assistant:history';
const MAX_PERSISTED = 50;

export default function AssistantChat({ onClose }: { onClose: () => void }) {
  const session = useMemo(() => new AssistantSession(), []);
  const [settings, setSettings] = useLocalStorage<AssistantSettings>(
    'thoremin:plugin:assistant:settings',
    DEFAULT_ASSISTANT_SETTINGS,
  );

  // Heal a settings blob that names a model we no longer offer. Providers retire models
  // out from under us — `gemini-2.5-flash` started returning 404 mid-2026 — and the
  // choice is persisted, so without this a user who once picked a now-dead model would
  // get an error on every send, forever, with no clue why. Fall back to the provider's
  // recommended model.
  useEffect(() => {
    if (!isKnownModel(settings.provider, settings.model)) {
      setSettings({ ...settings, model: recommendedModel(settings.provider) });
    }
  }, [settings, setSettings]);

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
