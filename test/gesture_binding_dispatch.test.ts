/**
 * A saved categorizer's gesture, bound to a command, runs it when the player MAKES the gesture
 * (#754): an event, once per repetition, through the category dispatcher's refusals.
 *
 * The categorizer is the shipped hand-shape demo with a wave recorded into it the way the carve
 * tool records one (`helpers/gesture_categorizer.ts`), saved in
 * the one collection with a binding on the wave, and played as the host plays it (`playable`).
 * The live stream is another scripted wave, read as the merged live vector (`hand.right.*`).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ok, type Result } from 'acture';
import { createInMemoryProvider } from '@zodal/store';
import { renameGesture } from '@thoremin/sdk/enroll/gestures';
import { recordBindings } from '@thoremin/sdk/enroll/record';
import { handModality } from '@thoremin/sdk/features/modalities/hand';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { createCategorizerStore, type CategorizerRecord } from '@thoremin/sdk-ui/enroll/categorizers';
import { createCategoryDispatcher, readCategoryLive, resetCategoryLive } from '@/app/enroll/categoryDispatch';
import { playable } from '@/app/enroll/categoryBinding';
import { FACES } from './helpers/extensions';
import { waveTake } from './helpers/wave_take';
import { withRecordedGesture } from './helpers/gesture_categorizer';

async function saved(bindings: Record<string, { command: string; args?: Record<string, unknown> }>) {
  const store = createCategorizerStore(handModality, { provider: createInMemoryProvider<CategorizerRecord>([], { idField: 'id', searchFields: ['name'] }) });
  const record = await store.save('Shapes and a wave', { categorizer: withRecordedGesture(), bindings });
  return { store, record };
}

describe.runIf(FACES)('a bound gesture fires its command on the event', () => {
  beforeEach(() => resetCategoryLive());

  async function play(over: { enabled?: boolean; hushed?: boolean; bindable?: boolean; waves?: number } = {}) {
    const { record } = await saved({ 'gesture-1': { command: 'chord.next', args: { by: 1 } } });
    const set = playable(record);
    expect(set.gestures?.names).toEqual([{ id: 'gesture-1', label: 'wave' }]);
    let vector: FeatureVector | null = null;
    const dispatched: { command: string; args: unknown }[] = [];
    const notes: string[] = [];
    const d = createCategoryDispatcher({
      getActive: () => set,
      isEnabled: () => over.enabled ?? true,
      isPreviewing: () => true,
      holdMs: () => 0,
      isHushed: () => over.hushed ?? false,
      readVector: () => vector,
      hasCommand: () => true,
      commandTitle: (id) => id,
      isBindable: () => over.bindable ?? true,
      dispatch: async (command, args): Promise<Result<unknown>> => {
        dispatched.push({ command, args });
        return ok(undefined);
      },
      notify: (m) => notes.push(m),
    });
    // Another take of the scripted wave, as the merged live vector the dispatcher reads.
    const take = waveTake({ seed: 9, waves: over.waves ?? 1, restMs: 2000 });
    for (const f of take.frames) {
      vector = f.v;
      d.tick(f.t);
    }
    await new Promise((r) => setTimeout(r, 0));
    return { dispatched, notes };
  }

  it('one wave runs the bound command once, with its args', async () => {
    const { dispatched, notes } = await play();
    expect(dispatched).toEqual([{ command: 'chord.next', args: { by: 1 } }]);
    expect(notes).toEqual(['wave → chord.next']);
    expect(readCategoryLive()?.gestureFires).toEqual({ 'gesture-1': 1 });
  });

  it('three waves, three runs; none while binding is off, hushed, or for a gated command', async () => {
    expect((await play({ waves: 3 })).dispatched).toHaveLength(3);
    expect((await play({ enabled: false })).dispatched).toEqual([]);
    expect((await play({ hushed: true })).dispatched).toEqual([]);
    const gated = await play({ bindable: false });
    expect(gated.dispatched).toEqual([]);
    expect(gated.notes[0]).toMatch(/needs confirmation and cannot be fired hands-free/);
  });

  it('the binding survives the tool re-saving the categorizer (carried by gesture id and name)', async () => {
    const { store, record } = await saved({ 'gesture-1': { command: 'chord.next' } });
    const renamed = renameGesture(record.model.categorizer, 'gesture-1', 'wave');
    if (!renamed.ok) throw new Error(renamed.error);
    // A category renamed in the tool: a save with no bindings given carries the stored ones.
    const edited = { ...renamed.categorizer, categories: renamed.categorizer.categories.map((c, i) => (i === 0 ? { ...c, label: `${c.label} too` } : c)) };
    const after = await store.save('Shapes and a wave', { categorizer: edited });
    expect(recordBindings(after)).toEqual({ 'gesture-1': { command: 'chord.next' } });
  });
});
