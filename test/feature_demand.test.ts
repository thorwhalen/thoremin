/**
 * Feature demand (#163) — a non-Lab consumer can have feature groups computed.
 *
 * The regression this guards: trainer v1 polled the feature vector with the Lab closed,
 * and the vector nodes — gated on the Lab being SHOWN — handed it `{}` every tick. Every
 * unit test stayed green because nothing asserted that a demanded group actually reaches
 * the emitted vector. The node-level cases below do exactly that, with the production
 * control shape (`featureLab.show === false`).
 */
import { describe, it, expect } from 'vitest';
import type { NodeContext } from '@/dag';
import { createFeatureDemand } from '@/features/demand';
import { resolveLabGate } from '@/features/labConfig';
import { faceFeatureVectorNode, handFeatureVectorNode } from '@/nodes';
import { makeHandKeypoints, type FaceFrame, type FeatureVector, type HandsFrame } from '@/nodes';
import { appFeatureDemand, featureDemandResource } from '@/app/featureDemand';
import { useTrainer } from '@/app/enroll/store';

const ctx = (resources: Record<string, unknown> = {}): NodeContext => ({ tick: 0, time: 0, dt: 1 / 30, resources });

describe('the demand registry', () => {
  it('is empty (null) until someone claims, and unions claims across owners', () => {
    const d = createFeatureDemand();
    expect(d.groups()).toBeNull();
    d.claim('a', ['face.head']);
    d.claim('b', ['face.geom.mouth', 'face.head']);
    expect([...d.groups()!].sort()).toEqual(['face.geom.mouth', 'face.head']);
    expect(d.owners().sort()).toEqual(['a', 'b']);
  });

  it('re-claiming REPLACES an owner\'s claim rather than accumulating it', () => {
    const d = createFeatureDemand();
    d.claim('a', ['face.head']);
    d.claim('a', ['face.au']);
    expect([...d.groups()!]).toEqual(['face.au']);
  });

  it('releasing the last owner returns to null; an empty claim is a release', () => {
    const d = createFeatureDemand();
    d.claim('a', ['face.head']);
    d.release('a');
    expect(d.groups()).toBeNull();
    d.claim('a', ['face.head']);
    d.claim('a', []);
    expect(d.groups()).toBeNull();
    d.release('never-claimed'); // no throw
    expect(d.groups()).toBeNull();
  });
});

describe('resolveLabGate with a demand', () => {
  const hidden = { featureLab: { show: false, groups: ['face.blendshape.jaw'] } };
  const shown = { featureLab: { show: true, groups: ['face.blendshape.jaw'] } };

  it('Lab hidden + no demand → inactive (the #136 default, unchanged)', () => {
    expect(resolveLabGate({}, hidden).active).toBe(false);
    expect(resolveLabGate({}, hidden, null).active).toBe(false);
    expect(resolveLabGate({}, hidden, new Set()).active).toBe(false);
  });

  it('Lab hidden + demand → active for the DEMANDED groups only (the Lab\'s stay off)', () => {
    const g = resolveLabGate({}, hidden, new Set(['face.head']));
    expect(g.active).toBe(true);
    expect(g.enabled('face.head')).toBe(true);
    expect(g.enabled('face.blendshape.jaw')).toBe(false);
    expect(g.enabled('face.au')).toBe(false);
  });

  it('Lab shown + demand → the union', () => {
    const g = resolveLabGate({}, shown, new Set(['face.head']));
    expect(g.active).toBe(true);
    expect(g.enabled('face.head')).toBe(true);
    expect(g.enabled('face.blendshape.jaw')).toBe(true);
    expect(g.enabled('face.au')).toBe(false);
  });

  it('headless (no controls) + demand → params groups plus the demand', () => {
    const g = resolveLabGate({ groups: ['face.au'] }, undefined, new Set(['face.head']));
    expect(g.enabled('face.au')).toBe(true);
    expect(g.enabled('face.head')).toBe(true);
    expect(g.enabled('face.blendshape.jaw')).toBe(false);
    // and with no params either, everything (unchanged headless behaviour)
    expect(resolveLabGate({}, undefined, new Set(['face.head'])).enabled('face.au')).toBe(true);
  });
});

describe('the vector nodes serve a demand with the Lab CLOSED (the v1 trainer bug)', () => {
  const face: FaceFrame = {
    present: true,
    blendshapes: { jawOpen: 0.7, mouthSmileLeft: 0.3, mouthSmileRight: 0.5, browInnerUp: 0.2 },
  };
  const labHidden = () => ({ featureLab: { show: false, groups: ['face.blendshape.brow'] } });

  it('face: without a demand the hidden Lab yields {} — with one, the demanded group arrives', () => {
    const h = faceFeatureVectorNode.make(faceFeatureVectorNode.params.parse({}));
    const none = h.process({ face }, ctx({ controls: labHidden })) as { vector: FeatureVector };
    expect(Object.keys(none.vector)).toHaveLength(0);

    const demanded = h.process(
      { face },
      ctx({ controls: labHidden, featureDemand: () => new Set(['face.blendshape.jaw']) }),
    ) as { vector: FeatureVector };
    expect(demanded.vector['face.blendshape.jaw.open']).toBeCloseTo(0.7);
    // The Lab's own group (brow) is NOT computed: the meters are off, and a demand must
    // not widen what they measure behind their back.
    expect(Object.keys(demanded.vector).some((k) => k.startsWith('face.blendshape.brow'))).toBe(false);
  });

  it('hand: the same, through the shared gate', () => {
    const hands: HandsFrame = {
      width: 640,
      height: 480,
      hands: [
        {
          handedness: 'Right',
          keypoints: makeHandKeypoints({ cx: 320, cy: 240, scale: 70, spread: 0.5, pinch: 0.2, handedness: 'Right' }),
        },
      ],
    };
    const h = handFeatureVectorNode.make(handFeatureVectorNode.params.parse({}));
    const none = h.process({ hands }, ctx({ controls: labHidden })) as { vector: FeatureVector };
    expect(Object.keys(none.vector)).toHaveLength(0);
    const demanded = h.process(
      { hands },
      ctx({ controls: labHidden, featureDemand: () => new Set(['hand.finger.flexion']) }),
    ) as { vector: FeatureVector };
    const keys = Object.keys(demanded.vector);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.startsWith('hand.'))).toBe(true);
  });
});

describe('the trainer claims the catalog while a step runs, and lets go after', () => {
  it('begin → claim; end → release; reset → release', () => {
    appFeatureDemand.reset();
    useTrainer.getState().reset();
    expect(featureDemandResource()).toBeNull();
    useTrainer.getState().begin('rest');
    const during = featureDemandResource();
    expect(during).not.toBeNull();
    expect(during!.has('face.head')).toBe(true);
    expect(during!.has('hand.finger.flexion')).toBe(true);
    useTrainer.getState().end();
    expect(featureDemandResource()).toBeNull();
    useTrainer.getState().begin('vocabulary');
    useTrainer.getState().reset();
    expect(featureDemandResource()).toBeNull();
  });
});
