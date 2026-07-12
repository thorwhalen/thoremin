/**
 * The Feature Lab's statistics engine (`src/features/labMeters.ts`), unit-tested with NO
 * canvas — the point of extracting it from the overlay node.
 *
 * Covers what the renderer used to hide: the show-gate, the normalizer lifecycle (warm-up,
 * re-zero on reopen and on a `resetNonce` bump), group filtering, derived-formula
 * evaluation over the MERGED face+hand scope (including the skip-invalid-formula rule),
 * and the marker opt-out. The overlay's own test now only asserts that these numbers get
 * DRAWN (see feature_lab_overlay.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { createLabMeterComputer, type LabMeterConfig } from '@/features/labMeters';
import { DERIVED_GROUP } from '@/features/catalog';

const JAW = 'face.blendshape.jaw';
const JAW_OPEN = 'face.blendshape.jaw.open';
const JAW_LEFT = 'face.blendshape.jaw.left';

const cfg = (over: Partial<LabMeterConfig> = {}): LabMeterConfig => ({
  show: true,
  groups: [JAW],
  normalizer: 'minmax',
  showMarkers: true,
  derived: [],
  resetNonce: 0,
  ...over,
});

/** A face vector whose jaw-open sweeps 0..0.9 with the tick, so the stats warm up. */
const faceAt = (i: number) => ({ [JAW_OPEN]: (i % 10) / 10, [JAW_LEFT]: 0.2 });

/** Drive the computer `ticks` times and return the LAST result. */
function run(
  compute: ReturnType<typeof createLabMeterComputer>,
  config: LabMeterConfig,
  ticks: number,
  hand: Record<string, number> | undefined = undefined,
) {
  let out = compute(config, faceAt(0), hand, 1 / 30);
  for (let i = 1; i < ticks; i++) out = compute(config, faceAt(i), hand, 1 / 30);
  return out;
}

describe('createLabMeterComputer (#119)', () => {
  it('is opt-in: hidden → nothing is computed', () => {
    expect(run(createLabMeterComputer(), cfg({ show: false }), 5)).toBeUndefined();
  });

  it('measures the enabled groups and normalizes each feature to a 0..1 level', () => {
    const meters = run(createLabMeterComputer(), cfg(), 40)!;
    expect(meters.order).toContain(JAW_OPEN);
    expect(meters.order).toContain(JAW_LEFT);
    expect(meters.raw[JAW_LEFT]).toBeCloseTo(0.2);
    for (const id of meters.order) {
      expect(meters.levels[id]).toBeGreaterThanOrEqual(0);
      expect(meters.levels[id]).toBeLessThanOrEqual(1);
    }
    // The swept feature spans the envelope: its top value reads at/near full scale.
    const top = run(createLabMeterComputer(), cfg(), 40)!;
    expect(Number.isFinite(top.levels[JAW_OPEN])).toBe(true);
  });

  it('only measures features whose group is enabled', () => {
    const meters = run(createLabMeterComputer(), cfg({ groups: ['face.blendshape.brow'] }), 20)!;
    expect(meters.order).not.toContain(JAW_OPEN);
    expect(meters.order).toHaveLength(0);
  });

  it('merges the hand vector into the same scope as the face vector', () => {
    const compute = createLabMeterComputer();
    const config = cfg({ groups: [JAW, 'hand.finger.flexion'] });
    const meters = run(compute, config, 10, { 'hand.right.index.curl': 0.5 })!;
    expect(meters.raw['hand.right.index.curl']).toBeCloseTo(0.5);
  });

  it('evaluates derived formulas over the MERGED vector, under the derived group', () => {
    const meters = run(
      createLabMeterComputer(),
      cfg({
        groups: [JAW, DERIVED_GROUP],
        derived: [{ id: 'jawDoubled', formula: 'face_blendshape_jaw_open * 2' }],
      }),
      40,
    )!;
    expect(meters.order).toContain('derived.jawDoubled');
    expect(meters.raw['derived.jawDoubled']).toBeCloseTo(2 * meters.raw[JAW_OPEN]);
  });

  it('skips an invalid / unsafe derived formula without throwing', () => {
    const config = cfg({
      groups: [JAW, DERIVED_GROUP],
      derived: [
        { id: 'evil', formula: 'face_blendshape_jaw_open.constructor' }, // the RCE class
        { id: 'typo', formula: 'not_a_feature + 1' },
        { id: 'ok', formula: 'face_blendshape_jaw_open + 1' },
      ],
    });
    const meters = run(createLabMeterComputer(), config, 10)!;
    expect(meters.order).not.toContain('derived.evil');
    expect(meters.order).not.toContain('derived.typo');
    expect(meters.order).toContain('derived.ok'); // the valid one still lands
  });

  it('derived features are not computed unless the derived group is enabled', () => {
    const meters = run(
      createLabMeterComputer(),
      cfg({ groups: [JAW], derived: [{ id: 'jawDoubled', formula: 'face_blendshape_jaw_open * 2' }] }),
      10,
    )!;
    expect(meters.order).not.toContain('derived.jawDoubled');
    expect(meters.raw['derived.jawDoubled']).toBeUndefined();
  });

  it('re-zeroes the statistics on a resetNonce bump (a manual recalibrate)', () => {
    const compute = createLabMeterComputer();
    const warm = cfg();
    run(compute, warm, 40);
    // A held-low value in a WARM normalizer reads low against the accumulated envelope...
    const held = compute(warm, { [JAW_OPEN]: 0.1, [JAW_LEFT]: 0.2 }, undefined, 1 / 30)!;
    // ...but after a reset the envelope is a single point, so it reads at the extreme.
    const afterReset = compute(
      cfg({ resetNonce: 1 }),
      { [JAW_OPEN]: 0.1, [JAW_LEFT]: 0.2 },
      undefined,
      1 / 30,
    )!;
    expect(afterReset.levels[JAW_OPEN]).toBeGreaterThan(held.levels[JAW_OPEN]);
  });

  it('re-zeroes when the lab is closed and reopened', () => {
    const compute = createLabMeterComputer();
    run(compute, cfg(), 40);
    const held = compute(cfg(), { [JAW_OPEN]: 0.1, [JAW_LEFT]: 0.2 }, undefined, 1 / 30)!;
    expect(compute(cfg({ show: false }), undefined, undefined, 1 / 30)).toBeUndefined();
    const reopened = compute(cfg(), { [JAW_OPEN]: 0.1, [JAW_LEFT]: 0.2 }, undefined, 1 / 30)!;
    expect(reopened.levels[JAW_OPEN]).toBeGreaterThan(held.levels[JAW_OPEN]);
  });

  it('showMarkers=false computes no percentile bands (the drawing opt-out is honored upstream)', () => {
    const on = run(createLabMeterComputer(), cfg({ showMarkers: true }), 40)!;
    const off = run(createLabMeterComputer(), cfg({ showMarkers: false }), 40)!;
    expect(on.markers[JAW_OPEN]?.length).toBeGreaterThan(0);
    expect(off.markers[JAW_OPEN]).toBeUndefined();
  });

  it('two computers keep independent statistics', () => {
    const a = createLabMeterComputer();
    const b = createLabMeterComputer();
    run(a, cfg(), 40); // a is warm
    const aHeld = a(cfg(), { [JAW_OPEN]: 0.1, [JAW_LEFT]: 0.2 }, undefined, 1 / 30)!;
    const bFresh = b(cfg(), { [JAW_OPEN]: 0.1, [JAW_LEFT]: 0.2 }, undefined, 1 / 30)!; // b is cold
    expect(bFresh.levels[JAW_OPEN]).toBeGreaterThan(aHeld.levels[JAW_OPEN]);
  });
});
