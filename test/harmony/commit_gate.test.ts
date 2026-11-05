/**
 * The commit gate (`@thoremin/sdk/util/commit_gate`): a reading commits after a dwell, or
 * sooner when the reader is sure of it (evidence: its margin over the reader's threshold, summed
 * over time); a different reading starts the timing over. The chord follower (Sign Map, MIDI and
 * audio in) and ASL's sign-chord commit through it.
 */
import { describe, expect, it } from 'vitest';
import { createCommitGate, labelMargin } from '@thoremin/sdk/util/commit_gate';
import { createChordFollower } from '@thoremin/sdk/harmony/chord_in';

const FPS = 30;
/** The first frame index at which a reading pushed with `margin` (30 fps) commits (-1: never in 30 frames). */
function firstCommit(gate: ReturnType<typeof createCommitGate<string>>, margin?: number): number {
  for (let i = 0; i < 30; i++) if (gate.push('C', i / FPS, margin)) return i;
  return -1;
}

describe('commit gate', () => {
  it('without evidence it is a dwell: k frames of a reading commit it, whatever the margin', () => {
    expect(firstCommit(createCommitGate<string>({ dwellS: 0.2, slackS: 1e-9 }), 0.5)).toBe(6);
    expect(firstCommit(createCommitGate<string>({ dwellS: 0.2, slackS: 1e-9 }), 0)).toBe(6);
    expect(firstCommit(createCommitGate<string>({ dwellS: 0 }), 0)).toBe(0);
  });

  it('the dwell is the strict comparison by default (MIDI and audio following unchanged)', () => {
    // 0.25 s at 60 Hz from tick 6: 21 / 60 - 6 / 60 is 0.24999999999999997 in floating point.
    const strict = createCommitGate<string>({ dwellS: 0.25 });
    const slack = createCommitGate<string>({ dwellS: 0.25, slackS: 1e-9 });
    strict.push('C', 6 / 60);
    slack.push('C', 6 / 60);
    expect(strict.push('C', 21 / 60)).toBe(false); // as the chord follower always did
    expect(slack.push('C', 21 / 60)).toBe(true);
  });

  it('with evidence, a sure reading commits sooner and a marginal one waits for the dwell', () => {
    const gate = () => createCommitGate<string>({ dwellS: 0.2, evidence: 0.02, slackS: 1e-9 });
    expect(firstCommit(gate(), 0.5)).toBe(2); // 0.0167 a frame
    expect(firstCommit(gate(), 0.2)).toBe(3); // 0.0067 a frame
    expect(firstCommit(gate(), 0.03)).toBe(6); // just over the threshold: the full 0.2 s
    expect(firstCommit(gate())).toBe(6); // no margin given: the dwell alone
  });

  it('a different reading, nothing read, or time going back starts or adds nothing', () => {
    const gate = createCommitGate<string>({ dwellS: 0.2, evidence: 0.02 });
    expect(gate.push('C', 0, 0.5)).toBe(false);
    expect(gate.push('C', 1 / FPS, 0.5)).toBe(false);
    expect(gate.push('E', 2 / FPS, 0.5)).toBe(false); // E: from zero
    expect(gate.push('E', 3 / FPS, 0.5)).toBe(false);
    expect(gate.push(null, 4 / FPS)).toBe(false);
    expect(gate.push('E', 5 / FPS, 0.5)).toBe(false); // after a gap: from zero again
    expect(gate.push('E', 4 / FPS, 0.5)).toBe(false); // a frame out of order adds nothing...
    expect(gate.push('E', 6 / FPS, 0.5)).toBe(false); // ...and is not counted twice after
    expect(gate.push('E', 7 / FPS, 0.5)).toBe(true);
    expect(gate.push('E', 8 / FPS, 0.5)).toBe(true); // and it stays committed
  });

  it("a reading's margin: the named class's score over the reader's threshold, none when kept or unknown", () => {
    const r = { label: 'B', labels: ['A', 'B'], scores: [0.1, 0.8], floor: 0.45 };
    expect(labelMargin(r)).toBeCloseTo(0.35);
    expect(labelMargin({ ...r, held: true })).toBe(0);
    expect(labelMargin({ ...r, floor: undefined })).toBe(0);
    expect(labelMargin({ ...r, label: null })).toBe(0);
    expect(labelMargin({ ...r, scores: [0.9, 0.3] })).toBe(0);
    expect(labelMargin(undefined)).toBe(0);
  });

  it('the chord follower commits a sure chord sooner, and holds it when nothing is read', () => {
    const C = { root: 0, quality: 'maj' } as const;
    const follower = createChordFollower({ dwellS: 0.2, evidence: 0.02 });
    const heard = [0, 1, 2, 3].map((i) => follower.pushChord(C, i / FPS, 0.5));
    expect(heard.map((h) => h?.root ?? null)).toEqual([null, null, 0, 0]);
    expect(follower.pushChord(null, 4 / FPS)?.root).toBe(0);
    // MIDI and audio give no margin and no `evidence`: the dwell alone.
    const plain = createChordFollower({ dwellS: 0.08 });
    expect([0, 1, 2, 3].map((i) => plain.pushChord(C, i / FPS)?.root ?? null)).toEqual([null, null, null, 0]);
  });
});
