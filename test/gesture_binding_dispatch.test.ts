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

/** The scripted take's frame period (30 fps). */
const FRAME_MS = 1000 / 30;

async function saved(bindings: Record<string, { command: string; args?: Record<string, unknown> }>) {
  const store = createCategorizerStore(handModality, { provider: createInMemoryProvider<CategorizerRecord>([], { idField: 'id', searchFields: ['name'] }) });
  const record = await store.save('Shapes and a wave', { categorizer: withRecordedGesture(), bindings });
  return { store, record };
}

describe.runIf(FACES)('a bound gesture fires its command on the event', () => {
  beforeEach(() => resetCategoryLive());

  /** `ticksPerFrame`: engine ticks per camera frame (the app's 60 Hz loop over a 30 fps camera
   *  re-offers each frame, under its own stamp, on a second tick); `restMs`: the rest before the
   *  first wave (0: the set becomes active while the hand already waves); `hushAt`: frames in
   *  which a trainer hushes the instrument. */
  async function play(
    over: { enabled?: boolean; hushed?: boolean; bindable?: boolean; waves?: number; ticksPerFrame?: number; restMs?: number; hushAt?: (frame: number) => boolean } = {},
  ) {
    const { record } = await saved({ 'gesture-1': { command: 'chord.next', args: { by: 1 } } });
    const set = playable(record);
    expect(set.gestures?.names).toEqual([{ id: 'gesture-1', label: 'wave' }]);
    let vector: FeatureVector | null = null;
    let t = 0;
    let hush = false;
    const dispatched: { command: string; args: unknown }[] = [];
    const notes: string[] = [];
    const d = createCategoryDispatcher({
      getActive: () => set,
      isEnabled: () => over.enabled ?? true,
      isPreviewing: () => true,
      holdMs: () => 0,
      isHushed: () => (over.hushed ?? false) || hush,
      readVector: () => (vector ? { vector, t } : null),
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
    const take = waveTake({ seed: 9, waves: over.waves ?? 1, restMs: over.restMs ?? 2000 });
    const ticks = over.ticksPerFrame ?? 1;
    /** Per frame, whether the live reading said the listener was warming. */
    const warming: boolean[] = [];
    take.frames.forEach((f, i) => {
      vector = f.v;
      t = f.t;
      hush = over.hushAt?.(i) ?? false;
      for (let k = 0; k < ticks; k++) d.tick(f.t + (k * FRAME_MS) / ticks);
      warming.push(readCategoryLive()?.gesturesWarming ?? false);
    });
    await new Promise((r) => setTimeout(r, 0));
    return { dispatched, notes, take, warming };
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

  it('a 60 Hz loop over a 30 fps camera reads each frame once: every wave still fires once', async () => {
    const { dispatched, take } = await play({ waves: 3, ticksPerFrame: 2 });
    expect(dispatched).toHaveLength(take.waves.length);
  });

  it('a set made active while the hand already waves hears the later waves', async () => {
    // No rest first: the listener's warm-up lands on motion, is judged against the rest ceiling
    // and redone, instead of learning the wave as jitter and going deaf.
    const { dispatched, take } = await play({ waves: 6, restMs: 0 });
    expect(dispatched.length).toBeGreaterThanOrEqual(take.waves.length - 2);
  });

  it('a hush mid-take silences the hushed wave and the listener hears again after it', async () => {
    // A trainer hushes over the second wave's frames (2 s rest, 1 s waves, 1 s pauses, 30 fps).
    // The listener is reset once, on the hush's edge, and warms up afresh after it: the pause
    // after the hush is exactly its warm-up, so the wave right after may fall in it; the rest fire.
    const inSecond = (i: number) => i >= 120 && i < 150;
    const { dispatched, take } = await play({ waves: 5, hushAt: inSecond });
    expect(take.waves).toHaveLength(5);
    expect(dispatched.length).toBeGreaterThanOrEqual(3);
    expect(dispatched.length).toBeLessThan(take.waves.length);
  });

  it('the reading says the listener is warming at the start and again after a hush, never while it hears (#954)', async () => {
    const inSecond = (i: number) => i >= 120 && i < 150;
    const { warming } = await play({ waves: 5, hushAt: inSecond });
    expect(warming[0]).toBe(true);
    const warm = warming.indexOf(false);
    expect(warm).toBeGreaterThan(0);
    // Warm before the hush; after it the listener warms afresh, and says so.
    expect(warming.slice(warm, 120).every((w) => !w)).toBe(true);
    expect(warming[150]).toBe(true);
    expect(warming.at(-1)).toBe(false);
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
