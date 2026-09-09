/**
 * The `score` node with a loaded document (#187 PR 3): it plays a real piece (the
 * shipped Beethoven 5 MIDI) from the `doc` input, emits only the notes sounding now
 * plus one-tick releases for the notes that just stopped (the synth releases a voice
 * only when it sees `present: false`; a voice that merely vanishes rings forever), keeps
 * the voice-id base clear of the other producers, honours the parts filter, releases
 * everything on disable and on a jump back to the top, and falls back to the built-in
 * looping scale with no document.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayNode } from '@/dag';
import { scoreNode, SCORE_VOICE_ID_BASE, DEMO_SCALE_NOTES, type SynthParams } from '@/nodes';
import { DEMO_SCORES, fetchDemo, flattenNotes, type ScoreDoc } from '@/score';

const PUBLIC = join(__dirname, '..', 'public');
const readPublic = async (path: string) => new Uint8Array(readFileSync(join(PUBLIC, path)));

let doc: ScoreDoc;
const load = async () => (doc ??= await fetchDemo(DEMO_SCORES[0], readPublic));

const present = (p: SynthParams) => p.voices.filter((v) => v.present);
const released = (p: SynthParams) => p.voices.filter((v) => !v.present);

describe('score node with a loaded ScoreDoc', () => {
  it('plays the piece from the doc input: sounding notes only, ids from the base, no note held past its end', async () => {
    await load();
    const h = scoreNode.make(scoreNode.params.parse({}));
    // 12 beats at a quarter-beat per tick.
    const beats = Array.from({ length: 49 }, (_, i) => i / 4);
    const outs = (await replayNode(h, { beat: beats, doc: beats.map(() => doc) })).map((o) => o.params as SynthParams);
    const all = flattenNotes(doc);
    for (let k = 0; k < outs.length; k++) {
      const pos = beats[k];
      const expected = all.filter((n) => pos >= n.start && pos < n.start + n.duration).length;
      expect(present(outs[k]).length).toBe(expected);
      for (const v of present(outs[k])) expect(v.id).toBeGreaterThanOrEqual(SCORE_VOICE_ID_BASE);
      // Never the whole piece: the movement has thousands of notes.
      expect(outs[k].voices.length).toBeLessThan(200);
    }
    // Every note that stopped was released exactly once, on the tick it stopped.
    const seenPresent = new Set<number>();
    const seenReleased = new Set<number>();
    for (const o of outs) {
      const now = new Set(present(o).map((v) => v.id));
      for (const v of released(o)) {
        expect(seenPresent.has(v.id)).toBe(true);
        expect(now.has(v.id)).toBe(false);
        expect(seenReleased.has(v.id)).toBe(false);
        seenReleased.add(v.id);
      }
      for (const id of now) seenPresent.add(id);
    }
    expect(seenPresent.size).toBeGreaterThan(20);
  });

  it('the parts filter plays only the selected part', async () => {
    await load();
    const partId = doc.parts[0].id;
    const h = scoreNode.make(scoreNode.params.parse({ parts: [partId] }));
    const beats = Array.from({ length: 33 }, (_, i) => i / 4);
    const outs = (await replayNode(h, { beat: beats, doc: beats.map(() => doc) })).map((o) => o.params as SynthParams);
    const only = flattenNotes(doc, [partId]);
    for (let k = 0; k < outs.length; k++) {
      const pos = beats[k];
      expect(present(outs[k]).length).toBe(only.filter((n) => pos >= n.start && pos < n.start + n.duration).length);
    }
  });

  it('disabling releases every sounding note and starts nothing', async () => {
    await load();
    const h = scoreNode.make(scoreNode.params.parse({}));
    const beats = [0.5, 0.75, 1, 1.25, 1.5];
    const enabled = [true, true, false, false, true];
    const outs = (await replayNode(h, { beat: beats, doc: beats.map(() => doc), enabled })).map((o) => o.params as SynthParams);
    expect(present(outs[1]).length).toBeGreaterThan(0);
    expect(present(outs[2]).length).toBe(0);
    expect(released(outs[2]).length).toBe(present(outs[1]).length);
    expect(outs[3].voices.length).toBe(0);
    expect(present(outs[4]).length).toBeGreaterThan(0);
  });

  it('a jump back to the top releases what was sounding', async () => {
    await load();
    const h = scoreNode.make(scoreNode.params.parse({}));
    const beats = [4, 4.5, 0];
    const outs = (await replayNode(h, { beat: beats, doc: beats.map(() => doc) })).map((o) => o.params as SynthParams);
    const before = present(outs[1]).map((v) => v.id);
    const releasedIds = released(outs[2]).map((v) => v.id);
    for (const id of before) if (!present(outs[2]).some((v) => v.id === id)) expect(releasedIds).toContain(id);
  });

  it('with no document, the built-in scale loops over loopBeats', async () => {
    const h = scoreNode.make(scoreNode.params.parse({ notes: DEMO_SCALE_NOTES, loopBeats: 8 }));
    const outs = (await replayNode(h, { beat: [0, 1, 7.5, 8.0, 9.95] })).map((o) => o.params as SynthParams);
    expect(present(outs[0]).length).toBe(1);
    expect(present(outs[3])[0].id).toBe(present(outs[0])[0].id); // beat 8 wraps to note 0
    expect(present(outs[4]).length).toBe(0); // 1.95 in the loop: note 1 ended at 1.9, note 2 starts at 2
    expect(released(outs[4]).length).toBe(1);
  });
});
