/**
 * How many hands the hand model looks for (#325): the pure derivation over the composed
 * branches and the shell's hand readers (`src/instruments/hands.ts`), and the pin that the
 * default policy changes nothing a player of a shipped instrument would notice.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ALL_BRANCHES, branchIdsFor } from '@/app/graph';
import { branchClosureIds } from '@/instruments/compose';
import { ALL_HANDS, branchHands, deriveHandCount, HAND_COUNT_POLICY, parseHandsOverride, type HandCountContext, type HandCountPolicy } from '@/instruments/hands';
import { defaultFeatureLab } from '@/slices/lab/schema';
import { ensureSeeded, instruments, SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';
import type { DerivationSettings } from '@/instruments/derive';
import type { GraphBranch } from '@thoremin/sdk/instruments/branch';
// The open Lab claims its shown groups as a feature demand (#600 S16a): what the derivation reads.
import { labDemandGroups } from '@/slices/lab/app/labDemand';
import { CONDUCTOR } from './helpers/extensions';

const byId = new Map(ALL_BRANCHES.map((b) => [b.id, b]));
/** The composed branches (trunk and requirements included) a settings object implies. */
const composed = (settings: DerivationSettings): GraphBranch[] =>
  branchClosureIds(['trunk', ...branchIdsFor(settings)], ALL_BRANCHES).map((id) => byId.get(id)!);

/** The two calls of #168 D13 as recommended: one hand for a one-hand reader, the skeleton draws what is tracked. */
/** The behaviour before D13 was answered (#325): the policy to set to go back to it. */
const BEFORE_D13: HandCountPolicy = { oneHandReaders: ALL_HANDS, skeletonSeesAllHands: true };
const HIDDEN: HandCountContext = { skeletonShown: false };

/** A field instrument with its hand voices silenced (what the air and ASL seeds do). */
const SILENT = { handMap: { maxGain: 0 } };

describe('branchHands', () => {
  it('reads a declaration, else infers both hands from an edge out of the hand stream', () => {
    // The conductor slice's branch declares its one beating hand (#600 S18b: there while it is listed).
    if (CONDUCTOR) expect(branchHands(byId.get('conductor')!)).toBe(1);
    expect(branchHands(byId.get('field-voices')!)).toBe(2);
    expect(branchHands(byId.get('face-source')!)).toBe(0);
    expect(branchHands(byId.get('trunk')!)).toBe(0); // the shell's readers come through the context
  });

  it('counts every branch that reads the hands as reading at least one', () => {
    // A branch with an edge out of the hand stream and a declared 0 would let the model miss
    // the hand it plays: no branch may say that.
    for (const b of ALL_BRANCHES) {
      if (b.id === 'trunk') continue;
      const reads = b.edges.some((e) => ['cam', 'dwelled', 'feat', 'handVec', 'gesture'].includes(e.from.node));
      if (reads) expect(branchHands(b), b.id).toBeGreaterThan(0);
    }
  });
});

describe("the trunk's own hand readers", () => {
  it('are only the ones the shell context covers (features, the Lab vector, gestures, the overlay)', () => {
    // `branchHands` counts the trunk as reading no hand because each of its readers is
    // covered by `HandCountContext`; a new trunk node reading the hands must be added there.
    const trunk = byId.get('trunk')!;
    const readers = new Set(trunk.edges.filter((e) => ['cam', 'feat', 'handVec', 'gesture'].includes(e.from.node)).map((e) => e.to.node));
    expect([...readers].sort()).toEqual(['dwelled', 'feat', 'gesture', 'handVec', 'overlay']);
  });
});

describe('deriveHandCount', () => {
  it('looks for both hands when a composed branch plays both', () => {
    expect(deriveHandCount(composed({}), HIDDEN)).toBe(2);
  });

  it('looks for one hand when nothing reads the hands and nothing draws them', () => {
    const faceOnly = composed({ ...SILENT, faceMapping: 'chord' });
    expect(deriveHandCount(faceOnly, HIDDEN)).toBe(1);
    expect(deriveHandCount(faceOnly, HIDDEN)).toBe(1);
  });

  it.runIf(CONDUCTOR)('gives a one-hand reader one hand (D13 a, #480), and every hand under the policy before it', () => {
    const conducting = composed({ ...SILENT, conductor: { enabled: true } });
    expect(HAND_COUNT_POLICY.oneHandReaders).toBe(1);
    expect(deriveHandCount(conducting, HIDDEN)).toBe(1);
    expect(deriveHandCount(conducting, HIDDEN, BEFORE_D13)).toBe(2);
  });

  it('lets the skeleton draw only what is tracked (D13 b, #480), every hand under the policy before it', () => {
    const faceOnly = composed({ ...SILENT, faceMapping: 'chord' });
    expect(HAND_COUNT_POLICY.skeletonSeesAllHands).toBe(false);
    expect(deriveHandCount(faceOnly, { skeletonShown: true })).toBe(1);
    expect(deriveHandCount(faceOnly, { skeletonShown: true }, BEFORE_D13)).toBe(2);
  });

  it('keeps every hand for a hand tool: the Lab on a hand group, a hand claim, gestures', () => {
    const faceOnly = composed({ ...SILENT, faceMapping: 'chord' });
    const lab = { ...defaultFeatureLab(), show: true, groups: ['hand.position.raw'] };
    expect(deriveHandCount(faceOnly, { ...HIDDEN, demanded: new Set(labDemandGroups(lab)) })).toBe(2);
    expect(deriveHandCount(faceOnly, { ...HIDDEN, demanded: new Set(labDemandGroups({ ...lab, show: false })) })).toBe(1);
    expect(deriveHandCount(faceOnly, { ...HIDDEN, demanded: new Set(['hand.position.raw']) })).toBe(2);
    expect(deriveHandCount(faceOnly, { ...HIDDEN, demanded: new Set(['face.mouth']) })).toBe(1);
    expect(deriveHandCount(faceOnly, { ...HIDDEN, gesturesEnabled: true })).toBe(2);
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

  // One shipped instrument reads one hand alone: Conduct the Chords (H9 of #613), whose only hand
  // reader is the conductor's beating hand (the chord chart reads none). D13 gives it one. The
  // other conducting ones are the field instruments with the conductor on (they play both hands),
  // and ASL reads one hand (the higher) but declares nothing, so it is inferred as two until its
  // branch says `hands: 1` (a thoremin-asl change).
  // Conduct the Chords (Body) too: the conductor branch declares one hand whatever its source,
  // though conducting with the body reads none (#793).
  // The listening games (#866) read the microphone, not the hands: the fewest the model looks for.
  const ONE_HAND = new Set(['Conduct the Chords', 'Conduct the Chords (Body)', 'Sing Along', 'Play Along Lessons', 'Match the Note']);
  it('all still look for every hand under D13 but the one-hand conductor, skeleton shown (its default)', () => {
    expect(settingsOf.size).toBe(SEED_INSTRUMENTS.length);
    for (const [name, settings] of settingsOf) {
      expect(deriveHandCount(composed(settings), { skeletonShown: true }), name).toBe(ONE_HAND.has(name) ? 1 : 2);
    }
  });

  it('the same with the skeleton hidden', () => {
    for (const [name, settings] of settingsOf) {
      expect(deriveHandCount(composed(settings), HIDDEN), name).toBe(ONE_HAND.has(name) ? 1 : 2);
    }
  });
});
