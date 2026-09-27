/**
 * The tools as a zodal collection (Round 4, Discussion #271) — what the Tools launcher
 * and the bar's pins are renderings OF.
 *
 * Two collections, because they are two different kinds of data:
 *
 * - **the tools** ({@link toolsCollection}): the registry in `tools.ts`, shipped in code.
 *   Its affordances are declared here, abstractly — searchable by label and description,
 *   grouped by launcher section, listed, read-only — and `ToolsLauncher` renders them.
 *   The items reach the UI through a `DataProvider` ({@link createToolsProvider}), in
 *   memory over `TOOLS` today; that provider is the seam an extension's tools join later
 *   (the core/extensions ADR, #268), without the launcher changing.
 * - **the player's pins** ({@link toolPinsCollection}): one record per tool the player
 *   has pinned or unpinned, persisted through a `DataProvider` (localStorage by default,
 *   {@link createToolPinsProvider}). A tool with no record uses its `defaultPinned`, so a
 *   default can improve in code without being shadowed by a stale stored copy.
 *
 * React-free. The live, synchronous pin state the bar reads each render is `toolPins.ts`,
 * hydrated from this provider (the project's hot-path split: zustand for what renders,
 * zodal for what persists).
 */
import { z } from 'zod';
import { defineCollection } from '@zodal/core';
import { createInMemoryProvider, type DataProvider } from '@zodal/store';
import { createLocalStorageProvider } from '@zodal/store-localstorage';
import { ToolSchema, TOOLS, type Tool } from './tools';

/** The fields a launcher search matches (the text a player reads on the row). */
export const TOOL_SEARCH_FIELDS = ['label', 'description'] as const;

/** The tools collection: its affordances, declared once; rendering is `ToolsLauncher`. */
export const toolsCollection = defineCollection(ToolSchema, {
  idField: 'id',
  labelField: 'label',
  affordances: {
    // Shipped in code: nothing to create, edit or delete from the UI.
    create: false,
    update: false,
    delete: false,
    search: { placeholder: 'Find a tool…', minChars: 1 },
    groupBy: { defaultField: 'group', collapsible: false, defaultState: 'expanded' },
    defaultView: 'list',
    views: ['list'],
    pagination: false,
    selectable: false,
  },
  fields: {
    id: { visible: false, searchable: false },
    label: { searchable: true },
    description: { searchable: true },
    group: { groupable: true, searchable: false },
    kind: { visible: false, searchable: false },
    defaultPinned: { visible: false },
    hotkey: { searchable: false },
    href: { visible: false, searchable: false },
    runsDetached: { visible: false },
  },
  operations: [
    { name: 'open', label: 'Open', scope: 'item' },
    { name: 'pin', label: 'Pin to the bar', scope: 'item', icon: 'pin' },
  ],
});

/** The tools' provider: in memory over the shipped registry. Pass `tools` to add more
 *  (an extension's, or a test's). */
export function createToolsProvider(tools: readonly Tool[] = TOOLS): DataProvider<Tool> {
  return createInMemoryProvider<Tool>([...tools], { idField: 'id', searchFields: [...TOOL_SEARCH_FIELDS] });
}

/** A player's pin choice for one tool (absent = the tool's `defaultPinned`). */
export const ToolPinSchema = z.object({
  /** The tool's id (the collection's idField). */
  id: z.string().min(1),
  pinned: z.boolean(),
});
export type ToolPin = z.infer<typeof ToolPinSchema>;

export const toolPinsCollection = defineCollection(ToolPinSchema, {
  idField: 'id',
  affordances: { create: true, update: true, delete: true, search: false, pagination: false },
});

/** localStorage key (the browser default target). */
export const TOOL_PINS_STORAGE_KEY = 'thoremin.toolPins';

/** The pins' provider: localStorage in the browser; pass any other `DataProvider` (in
 *  memory in tests, files or cloud later) without touching a caller. */
export function createToolPinsProvider(): DataProvider<ToolPin> {
  // The adapter only touches localStorage when it reads or writes, so ask up front: a
  // non-browser host (plain Node) gets an in-memory store rather than a throw per write.
  return typeof localStorage === 'undefined'
    ? createInMemoryProvider<ToolPin>([], { idField: 'id' })
    : createLocalStorageProvider<ToolPin>({ storageKey: TOOL_PINS_STORAGE_KEY, idField: 'id' });
}

/** Write one pin choice: update the tool's record, or create it the first time. (The
 *  `DataProvider` contract's `upsert` is optional, and the localStorage adapter has none.) */
export async function savePin(provider: DataProvider<ToolPin>, pin: ToolPin): Promise<void> {
  const record = ToolPinSchema.parse(pin);
  try {
    await provider.update(record.id, record);
  } catch {
    await provider.create(record);
  }
}

/** Every stored pin choice, by tool id. Records that fail the schema are skipped. */
export async function loadPins(provider: DataProvider<ToolPin>): Promise<Record<string, boolean>> {
  const { data } = await provider.getList({});
  const out: Record<string, boolean> = {};
  for (const raw of data) {
    const r = ToolPinSchema.safeParse(raw);
    if (r.success) out[r.data.id] = r.data.pinned;
  }
  return out;
}

/** Whether `tool` is pinned, given the player's choices (by tool id). */
export function isPinned(tool: Tool, choices: Readonly<Record<string, boolean>>): boolean {
  return choices[tool.id] ?? tool.defaultPinned;
}
