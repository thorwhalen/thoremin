/**
 * `preparePiece` and `readScoreDoc` (#392 item 4): the one derivation both players of a
 * piece (the `score` node and the orchestra) play from, and the memoised read of the
 * `score-doc` port. Run against the shipped demo scores (real MIDI and MusicXML), not
 * only a hand-made document, because the equivalence with `flattenNotes` is about order
 * under ties, which real files are full of.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_SCORES, fetchDemo, type ScoreDoc } from '@/score';
import { flattenNotes } from '@thoremin/sdk/score/schema';
import { pieceFromNotes, preparePiece, readScoreDoc } from '@thoremin/sdk/score/prepare';
import { DEMO_LOOP_BEATS, DEMO_SCALE_NOTES } from '@/nodes';

const PUBLIC = join(__dirname, '..', 'public');
const readPublic = async (path: string) => new Uint8Array(readFileSync(join(PUBLIC, path)));
const docs = async (): Promise<ScoreDoc[]> => Promise.all(DEMO_SCORES.map((d) => fetchDemo(d, readPublic)));

describe('preparePiece', () => {
  it('under the written dynamics, its notes are exactly flattenNotes (all parts, and a selection)', async () => {
    for (const doc of await docs()) {
      expect(preparePiece(doc, [], { dynamics: 'written' }).notes).toEqual(flattenNotes(doc));
      const some = doc.parts.slice(0, 2).map((p) => p.id);
      expect(preparePiece(doc, some, { dynamics: 'written' }).notes).toEqual(flattenNotes(doc, some));
    }
  });

  it('per part: written is that part flattened, raw is the source notes in their own order', async () => {
    for (const doc of await docs()) {
      const written = preparePiece(doc, [], { dynamics: 'written' });
      const raw = preparePiece(doc, [], { dynamics: 'raw' });
      expect(written.parts.map((p) => p.part)).toEqual(doc.parts);
      doc.parts.forEach((part, i) => {
        expect(written.parts[i].notes).toEqual(flattenNotes(doc, [part.id]));
        expect(raw.parts[i].notes).toEqual(part.notes);
      });
      expect(raw.loopBeats).toBe(0);
      expect(raw.maxDuration).toBe(Math.max(0, ...raw.notes.map((n) => n.duration)));
    }
  });

  it('pieceFromNotes: the demo scale, sorted, looped over DEMO_LOOP_BEATS', () => {
    const demo = pieceFromNotes([...DEMO_SCALE_NOTES].reverse(), DEMO_LOOP_BEATS);
    expect(demo.notes).toEqual(DEMO_SCALE_NOTES);
    expect(demo.loopBeats).toBe(DEMO_LOOP_BEATS);
    expect(demo.parts).toEqual([]);
    expect(demo.maxDuration).toBe(0.9);
  });
});

describe('readScoreDoc', () => {
  it('parses a document once: every reader of the same object gets the same parsed document', async () => {
    const [doc] = await docs();
    const raw = JSON.parse(JSON.stringify(doc));
    const a = readScoreDoc(raw);
    expect(a).not.toBeNull();
    expect(readScoreDoc(raw)).toBe(a);
    // A new object is a new document.
    expect(readScoreDoc(JSON.parse(JSON.stringify(doc)))).not.toBe(a);
  });

  it('none, a non-object, or an invalid document reads as null', () => {
    expect(readScoreDoc(undefined)).toBeNull();
    expect(readScoreDoc(null)).toBeNull();
    expect(readScoreDoc(42)).toBeNull();
    const bad = { parts: 'no' };
    expect(readScoreDoc(bad)).toBeNull();
    expect(readScoreDoc(bad)).toBeNull();
  });
});
