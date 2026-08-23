/**
 * Trainer guidance on the video (#163 §5) — the `trainerHud` overlay element, the
 * resource that feeds it from the trainer store, and the guidance-sink seam.
 *
 * Same fake-canvas harness as the tag HUD test: drive the `canvas-overlay` node with a
 * recording 2D context and assert what it paints — the instruction, large; the nudge
 * beneath; a coverage bar — ONLY while a routine runs, and nothing otherwise (the
 * common case, so it must cost nothing).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NodeContext } from '@/dag';
import { canvasOverlayNode, OVERLAY_ELEMENTS } from '@/nodes/output/canvas_overlay';
import { wrapLines, type TrainerHudSnapshot } from '@/enroll/hud';
import { trainerHudResource } from '@/app/enroll/hud';
import { addGuidanceSink, emitGuidance, resetGuidanceSinks } from '@/app/enroll/guidance';
import { useTrainer, type TranscriptLine } from '@/app/enroll/store';
import { STARTER_CUES } from '@/app/enroll/starterCues';
import { OVERLAY_CONTROLS } from '@/app/overlayControls';
import { appFeatureDemand } from '@/app/featureDemand';

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

/** Every element off except trainerHud, so only its draws show up. */
const onlyTrainerHud = Object.fromEntries(OVERLAY_ELEMENTS.map((e) => [e.name, { show: e.name === 'trainerHud' }]));

function run(snapshot: TrainerHudSnapshot | null, position?: 'top' | 'bottom', show = true) {
  const rc = makeCanvas();
  const params = { ...onlyTrainerHud, trainerHud: { show, ...(position ? { position } : {}) } };
  const handlers = canvasOverlayNode.make(canvasOverlayNode.params.parse(params));
  const ctx: NodeContext = { tick: 0, time: 1, dt: 0, resources: { canvas: rc.canvas, trainerHud: () => snapshot } };
  handlers.process({}, ctx);
  return rc;
}

const snap: TrainerHudSnapshot = {
  status: 'running',
  cueName: 'Look left',
  index: 2,
  total: 9,
  say: 'Turn your head to look to your left, and hold it.',
  guidance: 'A bit further, if you can.',
  coverage: 0.5,
};

describe('the trainerHud overlay element', () => {
  it('is registered, has a control descriptor, and sits below fingerBars (the z-order invariant)', () => {
    const names = OVERLAY_ELEMENTS.map((e) => e.name);
    expect(names).toContain('trainerHud');
    expect(names[names.length - 1]).toBe('fingerBars');
    expect(OVERLAY_CONTROLS.some((d) => d.name === 'trainerHud')).toBe(true);
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

  it('draws nothing when no routine runs (the resource returns null) or when hidden', () => {
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

describe('the HUD resource reads the trainer store', () => {
  beforeEach(() => {
    useTrainer.getState().reset();
    appFeatureDemand.reset();
  });

  it('is null when idle, the instruction while running, the end phrase during the beat', () => {
    expect(trainerHudResource()).toBeNull();
    useTrainer.getState().start(1000);
    const hud = trainerHudResource();
    expect(hud?.status).toBe('running');
    expect(hud?.say).toBe(STARTER_CUES[0].instruction);
    expect(hud?.cueName).toBe(STARTER_CUES[0].name);
    expect(hud?.index).toBe(1);
    expect(hud?.total).toBe(STARTER_CUES.length);
    expect(hud?.guidance).toBeNull();
    expect(hud?.coverage).toBe(0);
    // Skip: the beat shows what was just said (nothing, for a skip), then the next.
    useTrainer.getState().skip(1100);
    const between = trainerHudResource();
    expect(between?.status).toBe('between');
    expect(between?.cueName).toBe(STARTER_CUES[1].name);
    expect(between?.say).toBe('');
    useTrainer.getState().stop(1200);
    expect(trainerHudResource()).toBeNull();
  });
});

describe('guidance sinks — the seam the voice layer plugs into', () => {
  beforeEach(() => {
    resetGuidanceSinks();
    useTrainer.getState().reset();
    appFeatureDemand.reset();
  });

  it('receives every line the store transcribes, in order (after the event settles), and a throwing sink is isolated', async () => {
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

describe('the production wiring (source guard — useEngine is outside the strict typecheck)', () => {
  it('useEngine installs the HUD resource under the key the overlay reads', () => {
    const engine = readFileSync(resolve(process.cwd(), 'src/app/useEngine.ts'), 'utf8');
    expect(engine).toMatch(/resources\.trainerHud\s*=\s*trainerHudResource/);
    const overlay = readFileSync(resolve(process.cwd(), 'src/nodes/output/canvas_overlay.ts'), 'utf8');
    expect(overlay).toMatch(/ctx\.resources\.trainerHud/);
  });
});

describe('the HUD pref is per-device, not an instrument parameter (the #136 lesson)', () => {
  it('is NOT in the instrument overlay dial; toggling it dirties nothing and survives an instrument load', async () => {
    const { OverlayDialSchema } = await import('@/nodes/output/canvas_overlay');
    const { createThoreminRegistry } = await import('@/app/commands/registry');
    const { ensureSeeded } = await import('@/app/dials/instruments');
    const { dialsStore } = await import('@/app/dials/settingsStore');
    const { useControls } = await import('@/app/store');
    // Not a dial: the schema the instrument persists has no such key, and the path is
    // not dispatchable as an instrument edit.
    expect('trainerHud' in OverlayDialSchema.shape).toBe(false);
    const reg = createThoreminRegistry();
    await ensureSeeded();
    await reg.dispatch('instrument.load', { name: 'Split Voices' });
    const dirtyBefore = dialsStore.getState().dirty.length;
    useControls.getState().setTrainerHud({ show: false });
    expect(dialsStore.getState().dirty.length).toBe(dirtyBefore);
    await reg.dispatch('instrument.load', { name: 'Pentatonic' });
    // Loading an instrument does not flip the pref back on.
    expect(useControls.getState().trainerHud.show).toBe(false);
    useControls.getState().setTrainerHud({ show: true });
  });

  it('store-controls composes the pref into the overlay node\'s params each tick', async () => {
    const { storeControlsNode } = await import('@/nodes/sources/store_controls');
    const { TrainerHudParamsSchema, OverlayDialSchema } = await import('@/nodes/output/canvas_overlay');
    const { useControls } = await import('@/app/store');
    const h = storeControlsNode.make(storeControlsNode.params.parse({}));
    const base = { ...useControls.getState(), overlay: OverlayDialSchema.parse({}) };
    const controls = () => ({ ...base, trainerHud: TrainerHudParamsSchema.parse({ show: false, position: 'top' }) });
    const out = h.process({}, { tick: 0, time: 0, dt: 1 / 30, resources: { controls } }) as { overlay?: { trainerHud?: { show: boolean; position: string } } };
    expect(out.overlay?.trainerHud).toEqual({ show: false, position: 'top' });
    // And a control store with NO pref yet (an older blob) composes the default.
    const { trainerHud: _omit, ...withoutPref } = base;
    void _omit;
    const out2 = h.process({}, { tick: 0, time: 0, dt: 1 / 30, resources: { controls: () => withoutPref } }) as { overlay?: { trainerHud?: { show: boolean } } };
    expect(out2.overlay?.trainerHud?.show).toBe(true);
  });

  it('mergeControls heals a missing or corrupt pref to the default', async () => {
    const { mergeControls, useControls } = await import('@/app/store');
    const current = useControls.getState();
    expect(mergeControls({}, current).trainerHud.show).toBe(true);
    expect(mergeControls({ trainerHud: { show: 'nope' } }, current).trainerHud).toEqual(current.trainerHud);
    expect(mergeControls({ trainerHud: { show: false } }, current).trainerHud.show).toBe(false);
  });
});

describe('the banner takes part in the cue layout', () => {
  function runWith(params: Record<string, unknown>, snapshot: TrainerHudSnapshot | null, W = 1280, H = 720) {
    const rc = makeCanvas(W, H);
    const handlers = canvasOverlayNode.make(canvasOverlayNode.params.parse(params));
    const ctx: NodeContext = { tick: 0, time: 1, dt: 0, resources: { canvas: rc.canvas, trainerHud: () => snapshot } };
    handlers.process({ chord: [60, 64, 67], scale: [60, 62, 64, 65, 67, 69, 71] }, ctx);
    return rc;
  }

  it('sits above the bottom inset (the object-cover crop band / tools bar), not flush with the edge', () => {
    const rc = runWith({ ...onlyTrainerHud, trainerHud: { show: true, position: 'bottom' } }, snap, 1280, 720);
    const box = rc.calls.find((c) => c.m === 'fillRect')!.args as number[];
    const [, y, , h] = box;
    expect(y + h).toBeLessThanOrEqual(720 - 60);
  });

  it('leaves room at the sides for the edge stacks, and wraps rather than overflowing', () => {
    const rc = runWith({ ...onlyTrainerHud, trainerHud: { show: true, position: 'bottom' } }, snap, 640, 480);
    const [x, , w] = rc.calls.find((c) => c.m === 'fillRect')!.args as number[];
    expect(x).toBeGreaterThanOrEqual(100);
    expect(x + w).toBeLessThanOrEqual(540);
  });

  it('with position "top" it stacks BELOW a top-anchored cue instead of painting over it', () => {
    // chordName on top (its default), trainerHud on top too: the layout pass places the
    // banner after the chord name on that edge.
    const params = { ...onlyTrainerHud, chordName: { show: true, position: 'top' }, trainerHud: { show: true, position: 'top' } };
    const rc = runWith(params, snap, 1280, 720);
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
