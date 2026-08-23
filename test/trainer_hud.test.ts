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

  it('receives every line the store transcribes, in order, and a throwing sink is isolated', () => {
    const heard: string[] = [];
    const off = addGuidanceSink({ say: (l: TranscriptLine) => void heard.push(l.say) });
    addGuidanceSink({
      say: () => {
        throw new Error('autoplay blocked');
      },
    });
    useTrainer.getState().start(1000);
    useTrainer.getState().skip(1100);
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
