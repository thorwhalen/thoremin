/**
 * The tools as a zodal collection (Round 4, #271): the registry validates against its
 * schema, the collection declares the affordances the launcher renders, and the player's
 * pins persist through a `DataProvider` and come back on the next load.
 */
import { describe, it, expect } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { TOOLS, TOOL_GROUPS, ToolGroupSchema, ToolSchema } from '@/app/tools';
import {
  createToolsProvider,
  isPinned,
  loadPins,
  savePin,
  toolsCollection,
  type ToolPin,
} from '@/app/toolsCollection';
import { createToolPinsStore } from '@/app/toolPins';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the tools registry', () => {
  it('every shipped tool satisfies the schema, with a unique id and a known group', () => {
    for (const t of TOOLS) expect(ToolSchema.safeParse(t).success).toBe(true);
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
    const groups = new Set<string>(TOOL_GROUPS.map((g) => g.id));
    for (const t of TOOLS) expect(groups.has(t.group), t.id).toBe(true);
  });

  it('every launcher section in the schema has a heading, and no heading lacks a section', () => {
    expect(TOOL_GROUPS.map((g) => g.id).sort()).toEqual([...ToolGroupSchema.options].sort());
  });

  it('a link tool has an href; no other kind needs one', () => {
    for (const t of TOOLS) if (t.kind === 'link') expect(t.href, t.id).toBeTruthy();
  });

  it('ships some tools pinned and some not (the bar is a choice, not the whole registry)', () => {
    const pinned = TOOLS.filter((t) => t.defaultPinned);
    expect(pinned.length).toBeGreaterThan(0);
    expect(pinned.length).toBeLessThan(TOOLS.length);
  });
});

describe('the tools collection declares what the launcher renders', () => {
  it('is searchable by what a player reads on a row, grouped by launcher section, and read-only', () => {
    expect(toolsCollection.getSearchableFields().sort()).toEqual(['description', 'label']);
    const groupBy = toolsCollection.affordances.groupBy;
    expect(typeof groupBy === 'object' && groupBy.defaultField).toBe('group');
    expect(toolsCollection.affordances.create).toBe(false);
    expect(toolsCollection.affordances.update).toBe(false);
    expect(toolsCollection.affordances.delete).toBe(false);
    expect(toolsCollection.getOperations('item').map((o) => o.name)).toEqual(['open', 'pin']);
  });

  it("the provider's search matches a tool by its description, not only its name", async () => {
    const { data } = await createToolsProvider().getList({ search: 'meters' });
    expect(data.map((t) => t.id)).toEqual(['lab']);
  });

  it("the provider is the seam an extension's tools join", async () => {
    const extra = { ...TOOLS[0], id: 'looper', label: 'Looper', description: 'Loop a phrase.' };
    const { data } = await createToolsProvider([...TOOLS, extra]).getList({ search: 'loop' });
    expect(data.map((t) => t.id)).toEqual(['looper']);
  });
});

describe("the player's pins", () => {
  it('a tool with no stored choice uses its default; a stored choice overrides it', () => {
    const lab = TOOLS.find((t) => t.id === 'lab')!;
    expect(isPinned(lab, {})).toBe(lab.defaultPinned);
    expect(isPinned(lab, { lab: !lab.defaultPinned })).toBe(!lab.defaultPinned);
  });

  it('a provider with upsert is written through it', async () => {
    const base = createInMemoryProvider<ToolPin>([], { idField: 'id' });
    const calls: ToolPin[] = [];
    const withUpsert = { ...base, upsert: async (p: ToolPin) => (calls.push(p), p) };
    await savePin(withUpsert, { id: 'lab', pinned: true });
    expect(calls).toEqual([{ id: 'lab', pinned: true }]);
  });

  it('save creates the record the first time and updates it after', async () => {
    const provider = createInMemoryProvider<ToolPin>([], { idField: 'id' });
    await savePin(provider, { id: 'lab', pinned: true });
    await savePin(provider, { id: 'lab', pinned: false });
    const { data } = await provider.getList({});
    expect(data).toEqual([{ id: 'lab', pinned: false }]);
  });

  it('a pin set in one session is there after a reload (a new store over the same provider)', async () => {
    const provider = createInMemoryProvider<ToolPin>([], { idField: 'id' });
    const first = createToolPinsStore(provider);
    first.getState().setPinned('gestures', true);
    await flush();

    const second = createToolPinsStore(provider);
    expect(second.getState().choices).toEqual({});
    await second.getState().hydrate();
    expect(second.getState().choices).toEqual({ gestures: true });
    expect(second.getState().hydrated).toBe(true);
  });

  it('a choice made before the stored ones arrive is not overwritten by them', async () => {
    const provider = createInMemoryProvider<ToolPin>([{ id: 'lab', pinned: true }], { idField: 'id' });
    const store = createToolPinsStore(provider);
    const hydrating = store.getState().hydrate();
    store.getState().setPinned('lab', false);
    await hydrating;
    expect(store.getState().choices.lab).toBe(false);
  });

  it('a stored record that fails the schema is skipped, not trusted', async () => {
    const provider = createInMemoryProvider<Record<string, unknown>>(
      [{ id: 'lab', pinned: 'yes' }, { id: 'gestures', pinned: true }],
      { idField: 'id' },
    );
    expect(await loadPins(provider as never)).toEqual({ gestures: true });
  });
});
