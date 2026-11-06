/**
 * Which hand is which, on the player's own takes (#995): the hand model's label is the player's
 * TRUE hand on the live camera's frames, so no instrument swaps it by default, and the Physical
 * Theremin plays pitch with the right hand and volume with the left.
 *
 * Ground truth: in the ASL Chords take the player says "the right hand" (2.1 s) and "the left
 * hand" (65.5 s) before fingerspelling with it; the dataset's `asl-letter` events carry that hand.
 * Every hand instrument used to default `mirrorHandedness: true` (the selfie assumption) and so
 * read the opposite hand; the owner heard the theremin's roles inverted.
 *
 * The landmarks are the player's body, in the private `thoremin-recordings` dataset, read at run
 * time; this test is skipped without a checkout (`test/helpers/recordings.ts`).
 */
import { describe, expect, it } from 'vitest';
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';
import { DEFAULT_MIRROR_HANDEDNESS, labelFor } from '@thoremin/sdk/nodes/player_hands';
import { physicalThereminNode, type PhysicalThereminStatus } from '@/slices/theremin/nodes/physical_theremin';
import { DEFAULT_PHYSICAL_THEREMIN } from '@/slices/theremin/schema';
import { THEREMIN } from '../helpers/extensions';
import { HAS_RECORDINGS, recordingEvents, recordingIds, recordingMeta, recordingStream } from '../helpers/recordings';

const ASL_TAKE = '2026-11-05T12-51-15';

describe.runIf(HAS_RECORDINGS)("which hand is which, on the player's own takes (#995)", () => {
  // Read on first use: the describe body runs at collection even when it is skipped.
  let cached: { t: number; value: HandsFrame }[] | null = null;
  const frames = () => (cached ??= recordingStream(ASL_TAKE, 'hands') as unknown as { t: number; value: HandsFrame }[]);
  const passes = (hand: 'left' | 'right') => recordingEvents(ASL_TAKE, 'asl-letter').filter((e) => (e as { hand?: string }).hand === hand);
  const during = (hand: 'left' | 'right') => frames().filter((f) => passes(hand).some((e) => f.t >= e.start && f.t < e.end));

  it('the live label is the hand the player names, so the default does not swap it', () => {
    for (const hand of ['right', 'left'] as const) {
      const labels = during(hand).flatMap((f) => (f.value.hands.length === 1 ? [f.value.hands[0]!.handedness] : []));
      expect(labels.length).toBeGreaterThan(500);
      expect(labels.filter((l) => l === labelFor(hand, false)).length / labels.length).toBeGreaterThan(0.99);
    }
    expect(DEFAULT_MIRROR_HANDEDNESS).toBe(false);
    expect(labelFor('right', DEFAULT_MIRROR_HANDEDNESS)).toBe('Right');
  });

  it("the Right-labelled hand is on the camera image's left, where a facing player's right hand is, in every live take", () => {
    let agree = 0;
    let total = 0;
    // A take whose hands were re-extracted from the recorder's overlay video (a MIRROR image) has
    // the opposite labels: only the live camera's own frames say what the live path does.
    const live = recordingIds().filter((id) => !JSON.stringify(recordingMeta(id).streams?.hands ?? {}).includes('overlay'));
    for (const id of live) {
      for (const r of recordingStream(id, 'hands') as unknown as { value: HandsFrame }[]) {
        const hs = r.value.hands;
        const right = hs.find((h) => h.handedness === 'Right');
        const left = hs.find((h) => h.handedness === 'Left');
        if (hs.length !== 2 || !right || !left) continue;
        total++;
        if (right.keypoints[0]!.x < left.keypoints[0]!.x) agree++;
      }
    }
    expect(live.length).toBeGreaterThanOrEqual(11);
    expect(total).toBeGreaterThan(5000);
    expect(agree / total).toBeGreaterThan(0.99);
  });

  it.runIf(THEREMIN)('the Physical Theremin plays pitch with the right hand and volume with the left', () => {
    const play = (hand: 'left' | 'right') => {
      const node = physicalThereminNode.make(physicalThereminNode.params.parse({}));
      const config = { ...DEFAULT_PHYSICAL_THEREMIN, enabled: true };
      return during(hand).map((f, i) => (node.process({ hands: f.value, config }, { time: f.t, tick: i, dt: 1 / 30, resources: {} } as never) as { status: PhysicalThereminStatus }).status);
    };
    const right = play('right');
    const left = play('left');
    const share = (xs: PhysicalThereminStatus[], p: (s: PhysicalThereminStatus) => boolean) => xs.filter(p).length / xs.length;
    expect(share(right, (s) => s.pitchHand)).toBeGreaterThan(0.95);
    expect(share(right, (s) => s.volumeHand)).toBeLessThan(0.05);
    expect(share(left, (s) => s.volumeHand)).toBeGreaterThan(0.95);
    expect(share(left, (s) => s.pitchHand)).toBeLessThan(0.05);
  });
});
