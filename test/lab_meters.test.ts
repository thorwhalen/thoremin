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
  showCorrelation: false,
  correlationMaxFeatures: 12,
  correlationEveryNFrames: 1,
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

/**
 * The rolling correlation matrix (#150), folded into this computer so it shares ONE
 * lifecycle with the normalizer and the derived formulas.
 *
 * That sharing is the point of putting it here rather than in the overlay element: #131's
 * reset comment already warns that "recalibrate" must reset EVERY online statistic, not
 * all-but-one, and a correlation coefficient that survived a recalibrate would be a
 * stale number sitting beside freshly-zeroed meters, indistinguishable from a live one.
 */
describe('correlation matrix lifecycle (#150)', () => {
  const GROUPS = [JAW];

  /** Drive the computer with jaw-open sweeping and jaw-left tracking it exactly, so the
   *  pair is perfectly correlated and any failure to accumulate is visible. */
  function runCorrelated(
    compute: ReturnType<typeof createLabMeterComputer>,
    config: LabMeterConfig,
    ticks: number,
  ) {
    let out;
    for (let i = 0; i < ticks; i++) {
      const v = (i % 10) / 10;
      out = compute(config, { [JAW_OPEN]: v, [JAW_LEFT]: v }, undefined, 1 / 30);
    }
    return out;
  }

  it('is absent by default — the meters cost nothing extra until you ask', () => {
    const meters = run(createLabMeterComputer(), cfg({ groups: GROUPS }), 40)!;
    expect(meters.correlation).toBeUndefined();
  });

  it('appears once showCorrelation is on, covering exactly the features on screen', () => {
    const config = cfg({ groups: GROUPS, showCorrelation: true });
    const meters = runCorrelated(createLabMeterComputer(), config, 60)!;
    expect(meters.correlation).toBeDefined();
    // The matrix must cover the same ids, in the same order, as the meters: the grid's
    // row labels come from `ids`, so a divergence would label cells with the wrong
    // features — a diagnostic that lies rather than one that is missing.
    expect(meters.correlation!.ids).toEqual(meters.order.slice(0, meters.correlation!.ids.length));
    expect(meters.correlation!.r[0]).toBeCloseTo(1, 2); // jaw.open vs jaw.left move together
  });

  it('re-zeroes on a resetNonce bump, exactly like the normalizer', () => {
    const compute = createLabMeterComputer();
    const config = cfg({ groups: GROUPS, showCorrelation: true });
    const warm = runCorrelated(compute, config, 200)!;
    expect(warm.correlation!.frames).toBeGreaterThan(50);
    // One tick after the bump: the statistics must be back at the seeding sample.
    const after = compute({ ...config, resetNonce: 1 }, { [JAW_OPEN]: 0.5, [JAW_LEFT]: 0.5 }, undefined, 1 / 30)!;
    expect(after.correlation!.frames).toBe(0);
  });

  it('re-zeroes when the matrix is closed and reopened', () => {
    const compute = createLabMeterComputer();
    const on = cfg({ groups: GROUPS, showCorrelation: true });
    runCorrelated(compute, on, 200);
    // Close it…
    compute({ ...on, showCorrelation: false }, { [JAW_OPEN]: 0.5, [JAW_LEFT]: 0.5 }, undefined, 1 / 30);
    // …and reopen. Coefficients accumulated before you closed it describe a pose you are
    // no longer holding; silently resuming them makes a stale number look fresh.
    const after = compute(on, { [JAW_OPEN]: 0.5, [JAW_LEFT]: 0.5 }, undefined, 1 / 30)!;
    expect(after.correlation!.frames).toBe(0);
  });

  it('honours the cost guards it is handed', () => {
    const compute = createLabMeterComputer();
    const config = cfg({ groups: GROUPS, showCorrelation: true, correlationMaxFeatures: 2 });
    const meters = runCorrelated(compute, config, 40)!;
    expect(meters.correlation!.ids.length).toBeLessThanOrEqual(2);
  });
});

/**
 * The circular-period map reaches the correlation matrix (#150 / #144).
 *
 * The unwrapping itself is unit-tested in `lab_correlation.test.ts` against synthetic
 * ids. This is the WIRING guard, and it is the one that matters: the matrix folds `raw`,
 * the period map is built from the catalog HERE, and a unit test of the folder stays
 * perfectly green if this module simply never passes it. So drive the two REAL catalog
 * ids — `hand.right.palm.roll` is `circular`, its neighbour `hand.right.palm.pitch` is
 * not — and make the assertion at the level a player experiences.
 */
describe('circular features reach the matrix unwrapped (#144 wiring)', () => {
  const ROLL = 'hand.right.palm.roll';
  const PITCH = 'hand.right.palm.pitch';
  const ORIENTATION = 'hand.palm.orientation';
  const wrapTo = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

  it('a wrapping palm roll does not invert its coupling with a linear neighbour', () => {
    const compute = createLabMeterComputer();
    const config = cfg({ groups: [ORIENTATION], showCorrelation: true });
    let out;
    const rs: number[] = [];
    for (let t = 0; t < 400; t++) {
      // A wrist rotating steadily, and a pitch that is an exact affine function of the
      // true (unwrapped) roll — so the honest answer is r = +1 at every frame.
      const trueRoll = t * 0.03;
      out = compute(config, undefined, { [ROLL]: wrapTo(trueRoll), [PITCH]: 0.3 * trueRoll }, 1 / 30)!;
      rs.push(out.correlation!.r[0]);
    }
    // Exactly two features present, so `r[0]` is that pair (catalog order: pitch, roll).
    expect(out!.correlation!.ids).toEqual([PITCH, ROLL]);
    for (let t = 60; t < rs.length; t++) expect(rs[t]).toBeGreaterThan(0.99);
  });

  it('leaves the DISPLAYED raw value inside its declared range', () => {
    // Unwrapping belongs to the statistics, never to the meter: `raw` is what the readout
    // shows and what the normalizer was already fed, so it must still be an angle in
    // [-pi, pi] rather than the ever-growing accumulated phase.
    const compute = createLabMeterComputer();
    const config = cfg({ groups: [ORIENTATION], showCorrelation: true });
    let out;
    for (let t = 0; t < 400; t++) {
      out = compute(config, undefined, { [ROLL]: wrapTo(t * 0.03), [PITCH]: 0.3 * t * 0.03 }, 1 / 30)!;
    }
    expect(Math.abs(out!.raw[ROLL])).toBeLessThanOrEqual(Math.PI);
    expect(out!.levels[ROLL]).toBeGreaterThanOrEqual(0);
    expect(out!.levels[ROLL]).toBeLessThanOrEqual(1);
  });
});
