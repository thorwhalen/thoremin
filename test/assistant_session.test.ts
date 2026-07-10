/**
 * The assistant session state machine (#87 Phase 3) — driven by a scripted mock
 * ChatBackend (no network), so we exercise text streaming, inline tool traces, the
 * BYO-key gate, and the human approval flow for destructive commands in the headless
 * node env. The real Vercel backend implements the same seam; tests never touch an SDK.
 */
// Minimal browser-global shims for the node test env (the session is browser code).
if (typeof (globalThis as { localStorage?: unknown }).localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}
if (typeof (globalThis as { CustomEvent?: unknown }).CustomEvent === 'undefined') {
  (globalThis as { CustomEvent?: unknown }).CustomEvent = class extends Event {
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      super(type);
      this.detail = init?.detail;
    }
  };
}

import { describe, it, expect } from 'vitest';
import { AssistantSession } from '@/plugins/assistant/AssistantSession';
import { setStoredKey, removeStoredKey } from '@/plugins/assistant/providers';
import type { ChatBackend, AssistantTurnCallbacks } from '@/plugins/assistant/backend';
import type { AssistantSettings } from '@/plugins/assistant/types';

const SETTINGS: AssistantSettings = { provider: 'openai', model: 'gpt-4o' };

/** A backend that runs a canned script over the callbacks instead of calling a model. */
function scriptedBackend(script: (cb: AssistantTurnCallbacks) => void | Promise<void>) {
  return (): ChatBackend => ({
    runTurn: async (_input, cb) => {
      await script(cb);
    },
  });
}

describe('AssistantSession (#87 Phase 3)', () => {
  it('streams assistant text and records an inline tool trace', async () => {
    setStoredKey('openai', 'test-key');
    const session = new AssistantSession(
      scriptedBackend((cb) => {
        cb.onTextDelta('Making it ');
        cb.onTextDelta('warmer.');
        cb.onDispatch({ id: 'dial.set', title: 'Set dial' } as never, {
          ok: true,
          value: { key: 'right.sound', value: 'pad' },
        });
      }),
    );
    await session.send('make it warmer', SETTINGS);

    const last = session.messages.at(-1);
    expect(session.messages.at(-2)?.role).toBe('user');
    expect(last?.role).toBe('assistant');
    expect(last?.text).toBe('Making it warmer.');
    expect(last?.pending).toBe(false);
    expect(last?.traces?.[0]).toMatchObject({ command: 'dial.set', ok: true });
    expect(session.busy).toBe(false);
  });

  it('never sends an empty-content assistant message after a tool-only turn', async () => {
    // Regression for the empty-text bug: a turn where the model dispatches a command but
    // narrates nothing leaves text=''. It must NOT be re-sent to the model as an empty
    // assistant content block (Anthropic/Gemini reject it with a 400 and brick the chat).
    setStoredKey('openai', 'test-key');
    const captured: unknown[][] = [];
    const session = new AssistantSession(
      () => ({
        runTurn: async (input, cb) => {
          captured.push(input.messages);
          if (captured.length === 1) {
            // Turn 1: tool-only — a dispatch, no text.
            cb.onDispatch({ id: 'dial.set', title: 'Set dial' } as never, {
              ok: true,
              value: { key: 'right.sound', value: 'pad' },
            });
          } else {
            cb.onTextDelta('done');
          }
        },
      }),
    );
    await session.send('make it warmer', SETTINGS); // tool-only turn (empty text)
    await session.send('and brighter', SETTINGS); // second turn

    const secondTurnInput = captured[1] as Array<{ role: string; content: string }>;
    // No assistant message with empty content reaches the provider.
    expect(secondTurnInput.some((m) => m.role === 'assistant' && (m.content ?? '').trim() === '')).toBe(false);
    // The tool-only turn's trace is still visible in the transcript (UI shows what changed).
    expect(session.messages.some((m) => (m.traces?.length ?? 0) > 0)).toBe(true);
  });

  it('refuses to send with no API key for the active provider', async () => {
    removeStoredKey('openai');
    let ran = false;
    const session = new AssistantSession(
      scriptedBackend(() => {
        ran = true;
      }),
    );
    await session.send('hello', SETTINGS);
    expect(ran).toBe(false);
    expect(session.error).toMatch(/No API key/);
  });

  it('raises a pending approval on confirmation_required and clears it on deny', async () => {
    setStoredKey('openai', 'test-key');
    const session = new AssistantSession(
      scriptedBackend((cb) => {
        cb.onDispatch({ id: 'instrument.save', title: 'Save instrument' } as never, {
          ok: false,
          error: {
            code: 'confirmation_required',
            message: 'needs approval',
            details: { command: 'instrument.save', params: { name: 'X' } },
          },
        });
      }),
    );
    await session.send('save it as X', SETTINGS);

    expect(session.pendingApprovals.length).toBe(1);
    expect(session.pendingApprovals[0]).toMatchObject({ command: 'instrument.save' });

    session.deny(session.pendingApprovals[0].id);
    expect(session.pendingApprovals.length).toBe(0);
    expect(session.messages.at(-1)?.text).toContain('Cancelled');
  });

  it('approve mints a token, clears the pending, and reports an outcome', async () => {
    setStoredKey('openai', 'test-key');
    const session = new AssistantSession(
      scriptedBackend((cb) => {
        cb.onDispatch({ id: 'instrument.save', title: 'Save instrument' } as never, {
          ok: false,
          error: {
            code: 'confirmation_required',
            message: 'needs approval',
            details: { command: 'instrument.save', params: { name: 'ApprovalTest' } },
          },
        });
      }),
    );
    await session.send('save as ApprovalTest', SETTINGS);
    const pid = session.pendingApprovals[0].id;

    await session.approve(pid);
    expect(session.pendingApprovals.length).toBe(0);
    const last = session.messages.at(-1);
    expect(last?.role).toBe('assistant');
    // The re-dispatch happened through the real gated registry; either outcome is fine here.
    expect(last?.text).toMatch(/Done:|Couldn't/);
  });
});
