/**
 * Trainer guidance on the video (#163 §5) — the Trainer slice's contributed overlay cue (#600
 * S16d; core's `trainerHud` element before), the snapshot of what the trainer says that feeds it
 * (a transient the slice keeps in step with its store), and the guidance-sink seam.
 *
 * Same fake-canvas harness as the tag HUD test: drive the `canvas-overlay` node, built with the
 * slice's element, with a recording 2D context and assert what it paints — the instruction, large;
 * the nudge beneath; a coverage bar — ONLY while a routine runs, and nothing otherwise (the common
 * case, so it must cost nothing).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import { overlayPortName } from '@thoremin/sdk/instruments/extension';
import type { Extension } from '@thoremin/sdk/instruments/extension';
import { makeCanvasOverlayNode, OVERLAY_ELEMENTS } from '@/nodes/output/canvas_overlay';
import { CONTRIBUTIONS } from '@/host/contributions';
import { wrapLines, type TrainerHudSnapshot } from '@/slices/trainer/lib/hud';
import { installTrainerHud, setTrainerHud, trainerHud, trainerHudSnapshot, TRAINER_HUD_SNAPSHOT } from '@/slices/trainer/app/hud';
import { TRAINER_EXTENSION, TRAINER_EXTENSION_ID, TRAINER_HUD, TRAINER_HUD_CONFIG_PORT, TRAINER_HUD_SNAPSHOT_PORT } from '@/slices/trainer';
import { TRAINER_HUD_ELEMENT } from '@/slices/trainer/nodes/hud';
import { addGuidanceSink, emitGuidance, resetGuidanceSinks } from '@thoremin/sdk-ui/enroll/guidance';
import { useTrainer, type TranscriptLine } from '@/slices/trainer/app/store';
import { STARTER_CUES } from '@/slices/trainer/app/starterCues';
import { OVERLAY_CONTROLS } from '@/app/dials/overlayControls';
import { appFeatureDemand } from '@thoremin/sdk-ui/featureDemand';
// The hot store installs the controls host the slice's pref and transient go through.
import { useControls } from '@/app/store';
import { TRAINER } from '../helpers/extensions';

interface Call {
  m: string;
  args: unknown[];
}
function makeCanvas(width = 1280, height = 720) {
  const calls: Call[] = [];
  const ctx: Record<string, unknown> = { globalAlpha: 1, fillStyle: '', font: '', textBaseline: '', textAlign: '' };
  const rec = (m: string) => (...args: unknown[]) => void calls.push({ m, args });
  for (const m of ['clearRect', 'save', 'restore', 'beginPath', 'arc', 'fill', 'stroke', 'moveTo', 'lineTo', 'drawImage', 'fillText', 'setLineDash', 'scale', 'translate', 'rotate', 'fillRect']) {
    ctx[m] = rec(m);
  }
  const canvas = { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, calls, texts: () => calls.filter((c) => c.m === 'fillText').map((c) => c.args[0] as string) };
}

/** Every core element off, so only the slice's banner (and what a case turns on) shows up. */
const allCoreOff = Object.fromEntries(OVERLAY_ELEMENTS.map((e) => [e.configKey ?? e.name, { show: false }]));
const hudPort = (input: string) => overlayPortName(TRAINER_EXTENSION_ID, TRAINER_HUD_ELEMENT, input);

/** One overlay tick with the slice's element: (was: the overlay node read the snapshot from
 *  `ctx.resources.trainerHud` and the pref from its own params). */
function runWith(params: Record<string, unknown>, snapshot: TrainerHudSnapshot | null, hud: { show: boolean; position?: 'top' | 'bottom' }, W = 1280, H = 720, inputs: Record<string, unknown> = {}) {
  const rc = makeCanvas(W, H);
  const node = makeCanvasOverlayNode(CONTRIBUTIONS.overlayElements.filter((e) => e.extension === TRAINER_EXTENSION_ID));
  const handlers = node.make(node.params.parse({ ...allCoreOff, ...params }));
  const ctx: NodeContext = { tick: 0, time: 1, dt: 0, resources: { canvas: rc.canvas } };
  handlers.process({ octaveShift: 0, ...inputs, [hudPort('snapshot')]: snapshot, [hudPort('hud')]: { position: 'bottom', ...hud } }, ctx);
  return rc;
}
const run = (snapshot: TrainerHudSnapshot | null, position?: 'top' | 'bottom', show = true) => runWith({}, snapshot, { show, ...(position ? { position } : {}) });

const snap: TrainerHudSnapshot = {
  status: 'running',
  cueName: 'Look left',
  index: 2,
  total: 9,
  say: 'Turn your head to look to your left, and hold it.',
  guidance: 'A bit further, if you can.',
  coverage: 0.5,
};

describe.runIf(TRAINER)('the Trainer\'s overlay cue', () => {
  it('is the slice\'s contributed cue, placed below fingerBars; core has no trainerHud element or control', () => {
    // (Was: registered in core's OVERLAY_ELEMENTS with a control descriptor.)
    expect(TRAINER_EXTENSION.overlay?.map((d) => [d.name, d.cue, d.drawBefore])).toEqual([[TRAINER_HUD_ELEMENT, true, 'fingerBars']]);
    const names = OVERLAY_ELEMENTS.map((e) => e.name);
    expect(names).not.toContain('trainerHud');
    expect(names[names.length - 1]).toBe('fingerBars');
    expect(OVERLAY_CONTROLS.some((d) => d.name === 'trainerHud')).toBe(false);
  });

  it('paints the cue label, the instruction, the nudge and a coverage bar while a routine runs', () => {
    const rc = run(snap);
    const texts = rc.texts();
    expect(texts).toContain('2/9 · Look left');
    expect(texts.join(' ')).toContain('Turn your head to look to your left, and hold it.');
    expect(texts).toContain('A bit further, if you can.');
    // The banner box, the bar track and the bar fill: at least three rects.
    expect(rc.calls.filter((c) => c.m === 'fillRect').length).toBeGreaterThanOrEqual(3);
  });

  it('draws nothing when no routine runs (the snapshot is null) or when hidden', () => {
    expect(run(null).calls.some((c) => c.m === 'fillRect' || c.m === 'fillText')).toBe(false);
    expect(run(snap, undefined, false).texts()).toHaveLength(0);
  });

  it('anchors to the chosen edge', () => {
    const yOf = (rc: ReturnType<typeof run>) => rc.calls.find((c) => c.m === 'fillRect')!.args[1] as number;
    expect(yOf(run(snap, 'top'))).toBeLessThan(200);
    expect(yOf(run(snap, 'bottom'))).toBeGreaterThan(400);
  });

  it('wraps a long instruction onto more than one line rather than running off the frame', () => {
    const long = { ...snap, say: 'Now make faces you can make reliably, whichever ones you like. Hold each one for a moment, then move on to the next.' };
    const lines = run(long).texts().filter((t) => long.say.includes(t) && t !== long.say);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(wrapLines(long.say, 40).every((l) => l.length <= 40)).toBe(true);
    expect(wrapLines('one', 40)).toEqual(['one']);
    expect(wrapLines('', 40)).toEqual([]);
  });
});

describe.runIf(TRAINER)('the HUD snapshot reads the trainer store', () => {
  beforeEach(() => {
    useTrainer.getState().reset();
    appFeatureDemand.reset();
  });

  it('is null when idle, the instruction while running, the end phrase during the beat', () => {
    expect(trainerHudSnapshot()).toBeNull();
    useTrainer.getState().start(1000);
    const hud = trainerHudSnapshot();
    expect(hud?.status).toBe('running');
    expect(hud?.say).toBe(STARTER_CUES[0].instruction);
    expect(hud?.cueName).toBe(STARTER_CUES[0].name);
    expect(hud?.index).toBe(1);
    expect(hud?.total).toBe(STARTER_CUES.length);
    expect(hud?.guidance).toBeNull();
    expect(hud?.coverage).toBe(0);
    // Skip: the beat shows what was just said (nothing, for a skip), then the next.
    useTrainer.getState().skip(1100);
    const between = trainerHudSnapshot();
    expect(between?.status).toBe('between');
    expect(between?.cueName).toBe(STARTER_CUES[1].name);
    expect(between?.say).toBe('');
    useTrainer.getState().stop(1200);
    expect(trainerHudSnapshot()).toBeNull();
  });
});

describe('guidance sinks — the seam the voice layer plugs into', () => {
  beforeEach(() => {
    resetGuidanceSinks();
    if (TRAINER) useTrainer.getState().reset();
    appFeatureDemand.reset();
  });

  it.runIf(TRAINER)('receives every line the store transcribes, in order (after the event settles), and a throwing sink is isolated', async () => {
    const heard: string[] = [];
    const off = addGuidanceSink({ say: (l: TranscriptLine) => void heard.push(l.say) });
    addGuidanceSink({
      say: () => {
        throw new Error('autoplay blocked');
      },
    });
    useTrainer.getState().start(1000);
    useTrainer.getState().skip(1100);
    expect(heard).toEqual([]); // not yet: sinks run in a microtask, never inside the runner's dispatch
    await Promise.resolve();
    expect(heard).toEqual([STARTER_CUES[0].instruction]);
    useTrainer.getState().stop(1200);
    off();
    emitGuidance({ t: 0, kind: 'guidance', say: 'x' });
    expect(heard).toEqual([STARTER_CUES[0].instruction]);
  });
});

// (Was: a source guard that useEngine installed `resources.trainerHud` and the overlay read it.)
describe.runIf(TRAINER)('the production wiring: a pref port and a transient, wired by the slice\'s trunk branch', () => {
  let uninstall = () => {};
  afterEach(() => {
    uninstall();
    useTrainer.getState().reset();
    appFeatureDemand.reset();
  });

  it('the branch feeds the element from the bridge, and joins every instrument', () => {
    expect(TRAINER_HUD.edges.map((e) => [e.from.port, e.to.port])).toEqual([
      [TRAINER_HUD_CONFIG_PORT, hudPort('hud')],
      [TRAINER_HUD_SNAPSHOT_PORT, hudPort('snapshot')],
    ]);
    expect(CONTRIBUTIONS.trunkBranches).toContain(TRAINER_HUD.id);
  });

  it('the mount effect keeps the snapshot transient in step with the trainer, and clears it on uninstall', () => {
    uninstall = installTrainerHud();
    const field = () => (useControls.getState() as unknown as Record<string, unknown>)[TRAINER_HUD_SNAPSHOT] as TrainerHudSnapshot | null;
    expect(field()).toBeNull();
    useTrainer.getState().start(1000);
    expect(field()?.cueName).toBe(STARTER_CUES[0].name);
    useTrainer.getState().stop(1200);
    expect(field()).toBeNull();
    useTrainer.getState().start(1300);
    uninstall();
    uninstall = () => {};
    expect(field()).toBeNull();
  });
});

describe.runIf(TRAINER)('the HUD pref is per-device, not an instrument parameter (the #136 lesson)', () => {
  it('is NOT in the instrument overlay dial; toggling it dirties nothing and survives an instrument load', async () => {
    const { OverlayDialSchema } = await import('@/nodes/output/canvas_overlay');
    const { createThoreminRegistry } = await import('@/app/commands/registry');
    const { ensureSeeded } = await import('@/app/dials/instruments');
    const { dialsStore } = await import('@/app/dials/settingsStore');
    // Not a dial: the schema the instrument persists has no such key, and the path is
    // not dispatchable as an instrument edit.
    expect('trainerHud' in OverlayDialSchema.shape).toBe(false);
    const reg = createThoreminRegistry();
    await ensureSeeded();
    await reg.dispatch('instrument.load', { name: 'Split Voices' });
    const dirtyBefore = dialsStore.getState().dirty.length;
    setTrainerHud({ show: false });
    expect(dialsStore.getState().dirty.length).toBe(dirtyBefore);
    await reg.dispatch('instrument.load', { name: 'Pentatonic' });
    // Loading an instrument does not flip the pref back on.
    expect(trainerHud().show).toBe(false);
    setTrainerHud({ show: true });
  });

  // (Was: store-controls composed the pref into the overlay node's params.)
  it('store-controls emits the pref on the element\'s port each tick, the default when the store has none', async () => {
    const { makeStoreControlsNode } = await import('@/host/storeControls');
    const { OverlayDialSchema, TrainerHudParamsSchema } = { ...(await import('@/nodes/output/canvas_overlay')), ...(await import('@/slices/trainer/schema')) };
    const node = makeStoreControlsNode([TRAINER_EXTENSION as unknown as Extension]);
    const h = node.make({} as never);
    const base = { ...useControls.getState(), overlay: OverlayDialSchema.parse({}) };
    const tickWith = (c: unknown) => h.process({}, { tick: 0, time: 0, dt: 1 / 30, resources: { controls: () => c } } as unknown as NodeContext) as Record<string, unknown>;
    expect(tickWith({ ...base, trainerHud: TrainerHudParamsSchema.parse({ show: false, position: 'top' }) })[TRAINER_HUD_CONFIG_PORT]).toEqual({ show: false, position: 'top' });
    expect((tickWith({ ...base, trainerHud: { show: true } }).overlay as Record<string, unknown>).trainerHud).toBeUndefined();
    // And a control store with NO pref yet (an older blob) emits the default.
    const { trainerHud: _omit, ...withoutPref } = base as Record<string, unknown>;
    void _omit;
    expect((tickWith(withoutPref)[TRAINER_HUD_CONFIG_PORT] as { show: boolean }).show).toBe(false);
  });

  it('mergeControls heals a missing or corrupt pref to the default', async () => {
    const { mergeControls } = await import('@/app/store');
    const current = useControls.getState() as unknown as Record<string, { show: boolean }>;
    const merged = (p: unknown) => (mergeControls(p as never, current as never) as unknown as Record<string, { show: boolean }>).trainerHud;
    expect(merged({}).show).toBe(true);
    expect(merged({ trainerHud: { show: 'nope' } })).toEqual(current.trainerHud);
    expect(merged({ trainerHud: { show: false } }).show).toBe(false);
  });
});

describe.runIf(TRAINER)('the banner takes part in the cue layout', () => {
  it('sits above the bottom inset (the object-cover crop band / tools bar), not flush with the edge', () => {
    const rc = runWith({}, snap, { show: true, position: 'bottom' }, 1280, 720);
    const box = rc.calls.find((c) => c.m === 'fillRect')!.args as number[];
    const [, y, , h] = box;
    expect(y + h).toBeLessThanOrEqual(720 - 60);
  });

  it('leaves room at the sides for the edge stacks, and wraps rather than overflowing', () => {
    const rc = runWith({}, snap, { show: true, position: 'bottom' }, 640, 480);
    const [x, , w] = rc.calls.find((c) => c.m === 'fillRect')!.args as number[];
    expect(x).toBeGreaterThanOrEqual(100);
    expect(x + w).toBeLessThanOrEqual(540);
  });

  it('with position "top" it stacks BELOW a top-anchored cue instead of painting over it', () => {
    // chordName on top (its default), the banner on top too: the layout pass places the
    // banner after the chord name on that edge.
    const rc = runWith({ chordName: { show: true, position: 'top' } }, snap, { show: true, position: 'top' }, 1280, 720, { chord: [60, 64, 67], scale: [60, 62, 64, 65, 67, 69, 71] });
    const rects = rc.calls.filter((c) => c.m === 'fillRect').map((c) => c.args as number[]);
    // The banner is the widest rect. Everything drawn BEFORE it on the top row (the
    // chord name is earlier in z-order) must end above where the banner begins.
    const bi = rects.findIndex((r) => r[2] === Math.max(...rects.map((x) => x[2])));
    const banner = rects[bi];
    const topRow = rects.slice(0, bi).filter((r) => r[1] < 100);
    expect(topRow.length).toBeGreaterThan(0);
    for (const r of topRow) expect(banner[1]).toBeGreaterThanOrEqual(r[1] + r[3] - 1e-6);
  });
});
