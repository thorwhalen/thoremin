/**
 * How many hands the hand model looks for (#325): the pure derivation over the composed
 * branches and the shell's hand readers (`src/instruments/hands.ts`), and the pin that the
 * default policy changes nothing a player of a shipped instrument would notice.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ALL_BRANCHES, branchIdsFor } from '@/app/graph';
import { branchClosureIds } from '@/instruments/compose';
import { ALL_HANDS, branchHands, deriveHandCount, HAND_COUNT_POLICY, parseHandsOverride, type HandCountContext, type HandCountPolicy } from '@/instruments/hands';
import { defaultFeatureLab } from '@/features/labConfig';
import { ensureSeeded, instruments, SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';
import type { DerivationSettings } from '@/instruments/derive';
import type { GraphBranch } from '@thoremin/sdk/instruments/branch';

const byId = new Map(ALL_BRANCHES.map((b) => [b.id, b]));
/** The composed branches (trunk and requirements included) a settings object implies. */
const composed = (settings: DerivationSettings): GraphBranch[] =>
  branchClosureIds(['trunk', ...branchIdsFor(settings)], ALL_BRANCHES).map((id) => byId.get(id)!);

/** The two calls of #168 D13 as recommended: one hand for a one-hand reader, the skeleton draws what is tracked. */
const RECOMMENDED: HandCountPolicy = { oneHandReaders: 1, skeletonSeesAllHands: false };
const HIDDEN: HandCountContext = { skeletonShown: false };

/** A field instrument with its hand voices silenced (what the air and ASL seeds do). */
const SILENT = { handMap: { maxGain: 0 } };

describe('branchHands', () => {
  it('reads a declaration, else infers both hands from an edge out of the hand stream', () => {
    expect(branchHands(byId.get('conductor')!)).toBe(1);
    expect(branchHands(byId.get('field-voices')!)).toBe(2);
    expect(branchHands(byId.get('face-source')!)).toBe(0);
    expect(branchHands(byId.get('trunk')!)).toBe(0); // the shell's readers come through the context
  });

  it('counts every branch that reads the hands as reading at least one', () => {
    // A branch with an edge out of the hand stream and a declared 0 would let the model miss
    // the hand it plays: no branch may say that.
    for (const b of ALL_BRANCHES) {
      if (b.id === 'trunk') continue;
      const reads = b.edges.some((e) => ['cam', 'feat', 'handVec', 'gesture'].includes(e.from.node));
      if (reads) expect(branchHands(b), b.id).toBeGreaterThan(0);
    }
  });
});

describe('deriveHandCount', () => {
  it('looks for both hands when a composed branch plays both', () => {
    expect(deriveHandCount(composed({}), HIDDEN, RECOMMENDED)).toBe(2);
  });

  it('looks for one hand when nothing reads the hands and nothing draws them', () => {
    const faceOnly = composed({ ...SILENT, faceMapping: 'chord' });
    expect(deriveHandCount(faceOnly, HIDDEN)).toBe(1);
    expect(deriveHandCount(faceOnly, HIDDEN, RECOMMENDED)).toBe(1);
  });

  it('gives a one-hand reader what the policy says (today: every hand)', () => {
    const conducting = composed({ ...SILENT, conductor: { enabled: true } });
    expect(HAND_COUNT_POLICY.oneHandReaders).toBe(ALL_HANDS);
    expect(deriveHandCount(conducting, HIDDEN)).toBe(2);
    expect(deriveHandCount(conducting, HIDDEN, RECOMMENDED)).toBe(1);
  });

  it('keeps every hand while the skeleton shows, unless the policy lets it draw only what is tracked', () => {
    const faceOnly = composed({ ...SILENT, faceMapping: 'chord' });
    expect(deriveHandCount(faceOnly, { skeletonShown: true })).toBe(2);
    expect(deriveHandCount(faceOnly, { skeletonShown: true }, RECOMMENDED)).toBe(1);
  });

  it('keeps every hand for a hand tool: the Lab on a hand group, a hand claim, gestures', () => {
    const faceOnly = composed({ ...SILENT, faceMapping: 'chord' });
    const lab = { ...defaultFeatureLab(), show: true, groups: ['hand.position.raw'] };
    expect(deriveHandCount(faceOnly, { ...HIDDEN, featureLab: lab }, RECOMMENDED)).toBe(2);
    expect(deriveHandCount(faceOnly, { ...HIDDEN, featureLab: { ...lab, show: false } }, RECOMMENDED)).toBe(1);
    expect(deriveHandCount(faceOnly, { ...HIDDEN, demanded: new Set(['hand.position.raw']) }, RECOMMENDED)).toBe(2);
    expect(deriveHandCount(faceOnly, { ...HIDDEN, demanded: new Set(['face.mouth']) }, RECOMMENDED)).toBe(1);
    expect(deriveHandCount(faceOnly, { ...HIDDEN, gesturesEnabled: true }, RECOMMENDED)).toBe(2);
  });
});

describe('parseHandsOverride', () => {
  it('reads ?hands=1 and ?hands=2, and nothing else', () => {
    expect(parseHandsOverride('?hands=1')).toBe(1);
    expect(parseHandsOverride('?slot.source=webcam-hands&hands=2')).toBe(2);
    expect(parseHandsOverride('?hands=auto')).toBeNull();
    expect(parseHandsOverride('?hands=3')).toBeNull();
    expect(parseHandsOverride('')).toBeNull();
  });
});

describe('the shipped instruments', () => {
  const settingsOf = new Map<string, DerivationSettings>();
  beforeAll(async () => {
    await ensureSeeded();
    for (const { name } of SEED_INSTRUMENTS) {
      const layer = await instruments.load(name);
      if (layer) settingsOf.set(name, { ...settingsFromLayer(layer) } as DerivationSettings);
    }
  });

  it('all still look for every hand under today\'s policy, skeleton shown (its default)', () => {
    expect(settingsOf.size).toBe(SEED_INSTRUMENTS.length);
    for (const [name, settings] of settingsOf) {
      expect(deriveHandCount(composed(settings), { skeletonShown: true }), name).toBe(2);
    }
  });

  it('all still look for every hand under today\'s policy even with the skeleton hidden', () => {
    for (const [name, settings] of settingsOf) {
      expect(deriveHandCount(composed(settings), HIDDEN), name).toBe(2);
    }
  });
});
