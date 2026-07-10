/**
 * Assistant tool projection (#87 Phase 3) — the registry → Vercel-AI-SDK tools bridge.
 * Verifies the projected tool set (generic dial verbs + instrument commands, per-dial
 * setters excluded) and that a projected tool dispatches through the SAME registry the
 * palette uses, with errors returned as data (never thrown across the tool boundary).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildAssistantTools } from '@/plugins/assistant/aiTools';
import { dialsStore } from '@/app/dials/settingsStore';
import { useControls } from '@/app/store';

/** Run a projected tool's execute (arity/typing of the AI-SDK Tool relaxed for the test). */
const run = (tool: unknown, args: unknown): Promise<{ ok: boolean; error?: { code: string } }> =>
  (tool as { execute: (a: unknown) => Promise<{ ok: boolean; error?: { code: string } }> }).execute(args);

describe('assistant tool projection (#87 Phase 3)', () => {
  beforeEach(() => {
    useControls.setState(useControls.getInitialState(), true);
  });

  it('projects the generic dial + instrument verbs and excludes the per-dial setters', () => {
    const names = Object.keys(buildAssistantTools(() => {}));
    // Generic verbs present (wire-safe names: dots → underscores).
    expect(names).toContain('dial_set');
    expect(names).toContain('dial_patch');
    expect(names).toContain('dial_reset');
    expect(names).toContain('instrument_save');
    expect(names).toContain('instrument_load');
    // The generated per-dial `dial.<key>.set` → `dial_<key>_set` tools are hidden from the model.
    expect(names.some((n) => /^dial_.+_set$/.test(n))).toBe(false);
  });

  it('a projected tool dispatches through the registry, with errors-as-data', async () => {
    let reported: { ok: boolean } | null = null;
    const tools = buildAssistantTools((_cmd, result) => {
      reported = result as { ok: boolean };
    });
    const key = 'right.baseOctave';
    const current = dialsStore.getState().effective[key];

    // Setting a dial to a valid value succeeds and fires onDispatched with the Result.
    const okRes = await run(tools['dial_set'], { key, value: current });
    expect(okRes.ok).toBe(true);
    expect(reported).not.toBeNull();
    expect(reported!.ok).toBe(true);

    // An unknown dial comes back as errors-as-data — no throw across the tool boundary.
    const badRes = await run(tools['dial_set'], { key: 'nope.not_a_dial', value: 1 });
    expect(badRes.ok).toBe(false);
    expect(badRes.error?.code).toBe('unknown_dial');
  });
});
