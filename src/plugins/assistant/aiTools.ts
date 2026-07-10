/**
 * Tool projection (#87 Phase 3) — projects the thoremin command registry as
 * Vercel-AI-SDK tools via `acture-ai-vercel`, so the same registry the palette and
 * hotkeys dispatch IS the assistant's tool surface (one projection, no drift). Every
 * dispatch is tagged `channel:'assistant'` so the confirmation gate only gates the AI
 * surface, and `onDispatched` reports each dispatch so the UI can trace it live.
 *
 * The generated per-dial `dial.<key>.set` commands are EXCLUDED from the model's tools:
 * the model uses the generic `dial.set`/`dial.patch`/`dial.reset` verbs plus the
 * system-prompt dial catalog (which it needs for relative edits anyway) — a small,
 * clear tool set instead of 30-plus near-duplicate typed setters. The instrument
 * commands (destructive, gated) and the generic dial verbs remain.
 */
import type { Tool } from 'ai';
import { toAITools, toToolNameMap } from 'acture-ai-vercel';
import type { AnyCommandRecord } from 'acture';
import { registry, DIAL_FIELD_COMMANDS } from '@/app/commands';

/** Reported to the UI after each assistant dispatch (the canonical command + its Result). */
export type DispatchListener = (command: AnyCommandRecord, result: unknown) => void;

/** The per-dial command ids to hide from the AI (kept for the palette, not the model). */
const PER_DIAL_IDS = new Set<string>((DIAL_FIELD_COMMANDS as AnyCommandRecord[]).map((c) => c.id));

/** Tier/when options — must be identical for `toAITools` and `toToolNameMap` so the
 *  wire-name → id map lines up with the projected tools. */
const PROJECTION_OPTS = { tiers: ['stable'] as const };

/**
 * Build the assistant's tool set from the registry. `onDispatched` fires (with the
 * canonical command + acture Result) after each tool the model calls is dispatched.
 */
export function buildAssistantTools(onDispatched: DispatchListener): Record<string, Tool> {
  const all = toAITools(registry, { ...PROJECTION_OPTS, context: { channel: 'assistant' }, onDispatched });
  const nameToId = toToolNameMap(registry, PROJECTION_OPTS);
  const tools: Record<string, Tool> = {};
  for (const [toolName, tool] of Object.entries(all)) {
    if (PER_DIAL_IDS.has(nameToId[toolName])) continue; // drop the per-dial setters
    tools[toolName] = tool;
  }
  return tools;
}
