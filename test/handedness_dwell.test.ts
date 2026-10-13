/**
 * The handedness dwell on the SOUND path (#148): one tracker shared with the Lab,
 * surfaced as the `hands.handednessDwell` dial, default 0.
 *
 * Three things are pinned, each with a different kind of evidence:
 *
 *  1. Dwell 0 is TODAY's instrument, byte for byte. The `hand-features` and
 *     `voice-mapping` streams over the four real hand fixtures are digested and compared
 *     against sha256s captured from the stateless node as it stood before this change
 *     (main `a13282d`). If this fails, the default moved — do not re-baseline, decide.
 *  2. A non-zero dwell does what it says on the real flicker clip: `video_hand_sweep`
 *     relabels its one hand for 2 frames (61-62) and for 8 frames (35-42). Dwell 3 holds
 *     the first and re-routes the second after three frames — and those are the ONLY
 *     frames whose features change, so nothing else in the pipeline moved.
 *  3. The dial reaches the node: a live port on `hand-features`, emitted by
 *     `store-controls`, wired in the trunk, with a generated per-dial command. A dial
 *     whose port is left unconnected is a dial that silently does nothing (#137).
 *
 * The helper's own semantics (dropouts, phantom second hands, the sustained two-hand
 * reset) are pinned on the Lab node in `test/feature_vector_nodes.test.ts`; the unit
 * block here covers what is new: dwell 0 as a stateless pass-through.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { replayNode, runHeadless, type GraphSpec } from '@thoremin/dag';
import { createHandednessDwell, DEFAULT_HANDEDNESS_DWELL_FRAMES } from '@thoremin/sdk/features/handedness';
import { createCoreRegistry, handFeaturesNode, type HandFeatures, type HandsFrame } from '@/nodes';
import { storeControlsNode } from '@/nodes/sources/store_controls';
import type { NodeContext } from '@thoremin/dag';
import { defaultGraph } from '@/app/graph';
import { useControls } from '@/app/store';
import { createThoreminRegistry } from '@/app/commands';
import { thoreminDials } from '@/settings/dials';
import { loadStream } from './helpers/fixtures';

// ---- the helper -------------------------------------------------------------

describe('createHandednessDwell', () => {
  it('defaults to 0 frames: raw sides pass through, and the tracker keeps no memory', () => {
    expect(DEFAULT_HANDEDNESS_DWELL_FRAMES).toBe(0);
    const dwell = createHandednessDwell();
    expect(dwell.step(['left'])).toEqual(['left']);
    expect(dwell.step(['right'])).toEqual(['right']); // no hysteresis at all
    expect(dwell.step([])).toEqual([]);
    expect(dwell.step(['left', 'right'])).toEqual(['left', 'right']);
    // No memory: raising the dwell live starts cold from the CURRENT label, not a stale one.
    dwell.step(['left']);
    expect(dwell.step(['right'], { dwellFrames: 3 })).toEqual(['right']);
  });

  it('holds a flickered label for the dwell and switches on a sustained one', () => {
    const dwell = createHandednessDwell({ dwellFrames: 3 });
    for (let i = 0; i < 4; i++) expect(dwell.step(['left'])).toEqual(['left']);
    expect(dwell.step(['right'])).toEqual(['left']);
    expect(dwell.step(['right'])).toEqual(['left']);
    expect(dwell.step(['left'])).toEqual(['left']); // a 2-frame flicker never surfaced
    expect(dwell.step(['right'])).toEqual(['left']);
    expect(dwell.step(['right'])).toEqual(['left']);
    expect(dwell.step(['right'])).toEqual(['right']); // the third consecutive frame commits
  });

  it('the per-step dwell is live: lowering it to 0 mid-stream releases the hold at once', () => {
    const dwell = createHandednessDwell({ dwellFrames: 5 });
    for (let i = 0; i < 3; i++) dwell.step(['left']);
    expect(dwell.step(['right'])).toEqual(['left']);
    expect(dwell.step(['right'], { dwellFrames: 0 })).toEqual(['right']);
  });
});

// ---- 1. dwell 0 is today's instrument, byte for byte -----------------------------

/** sha256 of each stream, captured from the STATELESS `hand-features` (main a13282d),
 *  replaying every frame of the fixture through the trunk's default params. */
const GOLDEN: Record<string, { feat: string; map: string }> = {
  video_hand_sweep: {
    feat: '4c9a4f6f235a42a10048199496c59b6b33fc830c0ff7d8fb7bc22250c9060eb4',
    map: 'bfcb9d0520f83483e30a4750930522e8d6169bf7330cf2d9a0b2dbbf84b7540d',
  },
  two_hands: {
    feat: '5e1b0e6292658c86f06ae2e0c21235ef4de9917f7f0a28c77092627b67db9305',
    map: 'de2ba77d150bfb287c23f33a6a397352e614c9436d7343b3a62b4851343c3f0a',
  },
  video_hand_open_close: {
    feat: '091be36444f374e596f604b2846b9a9aad0305868efdbc23b81318ec7db80204',
    map: 'c3978d7ecd058b6ee845e63f952031da7b69f71097e5062c098aeffdaccfe4af',
  },
  video_hand_pinch: {
    feat: 'b792c901f41daba14d2c45e68c7366f673337c19a6386fdfe9b9be2e2fc70d72',
    map: '3141fb8f9f60d6fe8916dd4426a0d1c5c72f0d2c7effcac7b1d754034f7b7d9e',
  },
};

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

function soundPathSpec(scenario: string, featParams: Record<string, unknown> = {}): GraphSpec {
  const hands = loadStream(scenario, 'src.hands');
  return {
    nodes: [
      { id: 'src', type: 'replay-source', params: { values: hands } },
      { id: 'feat', type: 'hand-features', params: featParams },
      { id: 'map', type: 'voice-mapping', params: {} },
    ],
    edges: [
      { from: { node: 'src', port: 'value' }, to: { node: 'feat', port: 'hands' } },
      { from: { node: 'feat', port: 'features' }, to: { node: 'map', port: 'features' } },
    ],
  };
}

describe('hand-features at dwell 0 is byte-identical to its stateless self (#148)', () => {
  for (const [scenario, golden] of Object.entries(GOLDEN)) {
    it(`${scenario}: the feature stream and the note stream digest to the pre-#148 goldens`, async () => {
      const ticks = loadStream(scenario, 'src.hands').length;
      const { recorder } = await runHeadless(soundPathSpec(scenario), createCoreRegistry(), { ticks, nominalDt: 1 / 30 });
      const files = recorder.toFiles();
      expect(sha256(files['feat.features.ndjson'])).toBe(golden.feat);
      expect(sha256(files['map.params.ndjson'])).toBe(golden.map);
    });
  }

  it('the build-time default IS 0 — the dial and the node agree', () => {
    expect(handFeaturesNode.params.parse({}).handednessDwellFrames).toBe(0);
    expect((thoreminDials.schema.parse({}) as Record<string, unknown>)['hands.handednessDwell']).toBe(0);
  });
});

// ---- 2. a non-zero dwell on the real flicker clip ------------------------------------

describe('hand-features with a dwell holds the measured flicker (video_hand_sweep)', () => {
  // The clip's raw labels: Left throughout, except Right on 35-42 (8 frames, a sustained
  // relabel) and 61-62 (the 1-2 frame flicker #144 measured). The trunk mirrors
  // handedness, so the hand plays on the RIGHT side and the relabels put it on the left.
  const frames = loadStream('video_hand_sweep', 'src.hands') as HandsFrame[];
  const sideOf = (f: HandFeatures): 'left' | 'right' | 'none' => (f.right.present ? 'right' : f.left.present ? 'left' : 'none');

  async function sidesAt(dwell: number): Promise<string[]> {
    const node = handFeaturesNode.make(handFeaturesNode.params.parse({ handednessDwellFrames: dwell }));
    const out = await replayNode(node, { hands: frames }, { dt: 1 / 30 });
    return out.map((o) => sideOf(o.features as HandFeatures));
  }

  it('dwell 0 follows every relabel; the flicker frames reach the voice', async () => {
    const sides = await sidesAt(0);
    expect(sides[61]).toBe('left');
    expect(sides[62]).toBe('left');
    expect(sides[35]).toBe('left');
  });

  it('dwell 3 holds the 2-frame flicker and re-routes the 8-frame relabel after 3 frames', async () => {
    const sides = await sidesAt(3);
    // The flicker (61-62) never reaches the voice.
    expect(sides.slice(59, 66)).toEqual(['right', 'right', 'right', 'right', 'right', 'right', 'right']);
    // The sustained relabel: held for two frames, committed on the third; and the way
    // back (43 onward) costs the same three frames.
    expect(sides.slice(34, 46)).toEqual([
      'right', 'right', 'right', 'left', 'left', 'left', 'left', 'left', 'left', 'left', 'left', 'right',
    ]);
  });

  it('those six frames are the ONLY ones where dwell 3 differs from dwell 0', async () => {
    const run = async (dwell: number) => {
      const node = handFeaturesNode.make(handFeaturesNode.params.parse({ handednessDwellFrames: dwell }));
      return (await replayNode(node, { hands: frames }, { dt: 1 / 30 })).map((o) => JSON.stringify(o.features));
    };
    const [raw, held] = await Promise.all([run(0), run(3)]);
    const differing = raw.map((line, i) => (line === held[i] ? -1 : i)).filter((i) => i >= 0);
    expect(differing).toEqual([35, 36, 43, 44, 61, 62]);
  });

  it('the live port overrides the build-time param, frame by frame', async () => {
    const node = handFeaturesNode.make(handFeaturesNode.params.parse({}));
    const dwell = frames.map(() => 3);
    const held = await replayNode(node, { hands: frames, handednessDwell: dwell }, { dt: 1 / 30 });
    expect(sideOf(held[61].features as HandFeatures)).toBe('right');
    expect(sideOf(held[62].features as HandFeatures)).toBe('right');
  });
});

// ---- 3. the dial reaches the node --------------------------------------------------------

describe('the hands.handednessDwell dial reaches hand-features (#148 wiring)', () => {
  const ctxWith = (resources: Record<string, unknown>): NodeContext => ({ tick: 0, time: 0, dt: 1 / 30, resources });

  it('store-controls emits the dwell as a live port', () => {
    useControls.setState({ hands: { handednessDwell: 0 } });
    const node = storeControlsNode.make(storeControlsNode.params.parse({}));
    let out = node.process({}, ctxWith({ controls: () => useControls.getState() }));
    expect(out.handednessDwell).toBe(0);
    useControls.setState({ hands: { handednessDwell: 3 } });
    out = node.process({}, ctxWith({ controls: () => useControls.getState() }));
    expect(out.handednessDwell).toBe(3);
    useControls.setState({ hands: { handednessDwell: 0 } });
  });

  it('the trunk wires ui.handednessDwell into feat.handednessDwell', () => {
    const edges = defaultGraph().edges;
    expect(edges.some((e) => e.from.node === 'ui' && e.from.port === 'handednessDwell' && e.to.node === 'feat' && e.to.port === 'handednessDwell')).toBe(true);
    // The structural guard (#137's lesson): the port must not be left unconnected.
    expect(edges.filter((e) => e.to.node === 'feat').map((e) => e.to.port)).toContain('handednessDwell');
  });

  it('the per-dial command exists, so the palette and the AI assistant can set it', () => {
    expect(createThoreminRegistry().has('dial.hands.handednessDwell.set')).toBe(true);
  });
});
