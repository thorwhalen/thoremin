/**
 * The musical context from a score: the key signatures and chord symbols a ScoreDoc now carries
 * (MusicXML `<key>` and `<harmony>`, MIDI key-signature events), the score producer's timeline
 * (song seconds at the marked tempo, exact keys and bars, written or derived chords, the melody),
 * reading it at a time, and the content-keyed cache. On the generated modulating study
 * (`public/scores/modulation-study.musicxml`: C major, G major from bar 5, F major from bar 9, at
 * 96 bpm, so a bar is 2.5 s).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { musicxmlToScoreDoc } from '@thoremin/music-formats/musicxml';
import { measureOccurrences, chordOfHarmony } from '@thoremin/music-formats/musicxml_harmony';
import { midiToScoreDoc, scoreToMidi } from '@thoremin/music-formats/midi';
import { abcToScoreDoc } from '@thoremin/music-formats/abc';
import { keyPitchClasses, keySignatureAt, normalizeFifths, ScoreDocSchema, tonicOf, type ScoreDoc } from '@thoremin/sdk/score/schema';
import { barLines, contextFromScore, DERIVED_CHORD_CONFIDENCE, MIDI_KEY_CONFIDENCE, scoreClock } from '@thoremin/sdk/context/from_score';
import { beatOfSeconds, chordAt, expectations, keyAt, nextSpan, secondsOfBeat } from '@thoremin/sdk/context/cursor';
import { contentKey, memoryContextCache, produceCached, readCachedContext } from '@thoremin/sdk/context/cache';
import { scoreProducer } from '@thoremin/sdk/context/producer';
import { MusicalContextSchema } from '@thoremin/sdk/context/schema';

const STUDY = join(__dirname, '..', '..', 'public', 'scores', 'modulation-study.musicxml');
const study = (): ScoreDoc => musicxmlToScoreDoc(new Uint8Array(readFileSync(STUDY)));

/** A one-part MusicXML score from measures' inner XML (divisions 1, 4/4). */
function xml(parts: { id: string; attrs?: string; measures: string[] }[]): string {
  const list = parts.map((p) => `<score-part id="${p.id}"><part-name>${p.id}</part-name></score-part>`).join('');
  const body = parts
    .map((p) => `<part id="${p.id}">${p.measures.map((m, i) => `<measure number="${i + 1}">${i === 0 ? `<attributes><divisions>1</divisions>${p.attrs ?? ''}<time><beats>4</beats><beat-type>4</beat-type></time></attributes>` : ''}${m}</measure>`).join('')}</part>`)
    .join('');
  return `<?xml version="1.0"?><score-partwise version="4.0"><part-list>${list}</part-list>${body}</score-partwise>`;
}
const whole = (step: string, octave = 4) => `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>4</duration><type>whole</type></note>`;

describe('key signatures', () => {
  it('names the tonic and the scale of a signature in any mode', () => {
    expect(tonicOf({ fifths: 0, mode: 'major' })).toBe(0);
    expect(tonicOf({ fifths: 1, mode: 'major' })).toBe(7);
    expect(tonicOf({ fifths: -3, mode: 'minor' })).toBe(0); // C minor
    expect(tonicOf({ fifths: 0, mode: 'dorian' })).toBe(2);
    expect(keyPitchClasses({ fifths: 1, mode: 'major' })).toEqual([7, 9, 11, 0, 2, 4, 6]);
    expect(keyPitchClasses({ fifths: 0, mode: 'minor' })).toEqual([9, 11, 0, 2, 4, 5, 7]);
    expect(normalizeFifths(9)).toBe(-3);
    expect(normalizeFifths(-14)).toBe(-2);
  });

  it('a stored document without keys or harmony still parses, with none', () => {
    const doc = ScoreDocSchema.parse({ title: 't', source: 'midi', parts: [], lengthBeats: 0 });
    expect(doc.keys).toEqual([]);
    expect(doc.harmony).toEqual([]);
    expect(keySignatureAt(doc, 3)).toBeNull();
  });
});

describe('MusicXML keys and chord symbols', () => {
  it('reads the study: the written key changes on their bar lines, and every chord symbol', () => {
    const doc = study();
    expect(doc.title).toBe('Modulation study');
    expect(doc.keys).toEqual([
      { beat: 0, fifths: 0, mode: 'major' },
      { beat: 16, fifths: 1, mode: 'major' },
      { beat: 32, fifths: -1, mode: 'major' },
    ]);
    expect(doc.harmony.map((h) => h.beat)).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44]);
    expect(doc.harmony[2]).toEqual({ beat: 8, chord: { root: 7, quality: '7' }, text: '7' });
    expect(doc.harmony[9].chord).toEqual({ root: 10, quality: 'maj' }); // B-flat
    expect(keySignatureAt(doc, 15.99)?.fifths).toBe(0);
    expect(keySignatureAt(doc, 16)?.fifths).toBe(1);
  });

  it('reads keys in concert pitch: the first part that does not transpose, else the first undone', () => {
    const clarinet = { id: 'Cl', attrs: '<key><fifths>2</fifths></key><transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>', measures: [whole('E')] };
    const violin = { id: 'Vn', attrs: '<key><fifths>0</fifths></key>', measures: [whole('C')] };
    expect(musicxmlToScoreDoc(xml([clarinet, violin])).keys).toEqual([{ beat: 0, fifths: 0, mode: 'major' }]);
    expect(musicxmlToScoreDoc(xml([clarinet])).keys).toEqual([{ beat: 0, fifths: 0, mode: 'major' }]);
  });

  it('places a key change written inside a bar at its offset, and a mode', () => {
    const half = (s: string) => `<note><pitch><step>${s}</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>`;
    const doc = musicxmlToScoreDoc(xml([{ id: 'P', attrs: '<key><fifths>0</fifths><mode>minor</mode></key>', measures: [`${half('A')}<attributes><key><fifths>1</fifths><mode>major</mode></key></attributes>${half('G')}`] }]));
    expect(doc.keys).toEqual([
      { beat: 0, fifths: 0, mode: 'minor' },
      { beat: 2, fifths: 1, mode: 'major' },
    ]);
  });

  it('plays a repeated section with its own key again, the key in force by written order', () => {
    // |: C major bar | G major bar :| then the same two bars again.
    const measures = [`<barline location="left"><repeat direction="forward"/></barline>${whole('C')}`, `<attributes><key><fifths>1</fifths></key></attributes>${whole('G')}<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>`];
    const doc = musicxmlToScoreDoc(xml([{ id: 'P', attrs: '<key><fifths>0</fifths></key>', measures }]));
    expect(doc.lengthBeats).toBe(16);
    expect(doc.keys.map((k) => [k.beat, k.fifths])).toEqual([
      [0, 0],
      [4, 1],
      [8, 0],
      [12, 1],
    ]);
  });

  it('matches a breakpoint run to the next written measure, or back to the nearest of its number', () => {
    const measures = [{ number: '1' }, { number: '2' }, { number: '1' }, { number: '2' }];
    const bp = (q: number, n: string) => ({ midiSec: q, quarterPos: q, measureNumber: n, beatInMeasure: 0 });
    // Movement one twice (a repeat), then movement two, whose numbers restart.
    expect(measureOccurrences([bp(0, '1'), bp(4, '2'), bp(8, '1'), bp(12, '2'), bp(16, '1'), bp(20, '2')], measures)).toEqual([
      { index: 0, start: 0 },
      { index: 1, start: 4 },
      { index: 2, start: 8 },
      { index: 3, start: 12 },
      { index: 2, start: 16 },
      { index: 3, start: 20 },
    ]);
  });

  it('maps chord kinds onto the qualities, a slash bass, and no chord for N.C.', () => {
    const h = (kind: string, extra: object = {}) => ({ _id: 'h', type: 'harmony' as const, root: { rootStep: 'D' }, kind, ...extra });
    expect(chordOfHarmony(h('minor-seventh'))).toEqual({ root: 2, quality: 'min7' });
    expect(chordOfHarmony(h('major', { bass: { bassStep: 'F', bassAlter: 1 } }))).toEqual({ root: 2, quality: 'maj', bass: 6 });
    expect(chordOfHarmony(h('none'))).toBeNull();
  });

  it('reads an ABC tune key into the same keys', () => {
    const doc = abcToScoreDoc('X:1\nT:Tune\nM:4/4\nL:1/4\nK:G\nGABc|d4|]\n');
    expect(doc.keys[0]).toMatchObject({ beat: 0, fifths: 1 });
  });
});

describe('MIDI key signatures', () => {
  it('round-trips a score written as MIDI, key changes included (a mode as its major or minor)', () => {
    const doc = study();
    const withMinor: ScoreDoc = { ...doc, keys: [...doc.keys, { beat: 40, fifths: -3, mode: 'minor' }, { beat: 44, fifths: 0, mode: 'dorian' }] };
    const back = midiToScoreDoc(scoreToMidi(withMinor));
    expect(back.keys).toEqual([
      { beat: 0, fifths: 0, mode: 'major' },
      { beat: 16, fifths: 1, mode: 'major' },
      { beat: 32, fifths: -1, mode: 'major' },
      { beat: 40, fifths: -3, mode: 'minor' },
      { beat: 44, fifths: 0, mode: 'major' },
    ]);
  });
});

describe('the score producer', () => {
  it('puts the study on song seconds: keys, bars, chords and the melody, exact', () => {
    const ctx = contextFromScore(study(), { contentKey: 'k' });
    expect(MusicalContextSchema.parse(ctx)).toEqual(ctx);
    expect(ctx.source).toBe('score');
    expect(ctx.contentKey).toBe('k');
    expect(ctx.durationS).toBeCloseTo(30, 9);
    expect(ctx.beats).toHaveLength(49);
    expect(ctx.beats[4].t).toBeCloseTo(2.5, 9);
    expect(ctx.downbeats).toHaveLength(12);
    expect(ctx.downbeats[4]).toBeCloseTo(10, 9);
    expect(ctx.keys.map((k) => [k.start, k.end, k.tonic, k.mode, k.confidence])).toEqual([
      [0, 10, 0, 'major', 1],
      [10, 20, 7, 'major', 1],
      [20, 30, 5, 'major', 1],
    ]);
    expect(ctx.keys[2].scalePcs).toContain(10); // B-flat in F major
    expect(ctx.chords).toHaveLength(12);
    expect(ctx.chords.every((c) => c.confidence === 1)).toBe(true);
    expect(ctx.analyzers).toEqual([{ name: 'score', version: '1', weightsLicence: 'none' }]);
    expect(ctx.melody).toHaveLength(48);
    expect(ctx.melody[0]).toMatchObject({ start: 0, end: 0.625, midi: 72 });
    expect(ctx.tempo).toEqual([{ t: 0, bpm: 96, confidence: 1 }]);
    expect(ctx.meter).toEqual([{ t: 0, numerator: 4, denominator: 4, confidence: 1 }]);
  });

  it('derives the chords from the notes when the score writes none, at a lower confidence', () => {
    const doc = { ...study(), harmony: [] };
    const ctx = contextFromScore(doc);
    expect(ctx.analyzers.map((a) => a.name)).toEqual(['score', 'chord-chart']);
    expect(ctx.chords.every((c) => c.confidence === DERIVED_CHORD_CONFIDENCE)).toBe(true);
    // The block chords spell C, F, G7 (no fifth: still read as G7) ...
    expect(chordAt(ctx, 0.1)?.chord).toMatchObject({ root: 0, quality: 'maj' });
    expect(chordAt(ctx, 2.6)?.chord).toMatchObject({ root: 5, quality: 'maj' });
    expect(ctx.chords.length).toBeGreaterThanOrEqual(12);
  });

  it('trusts a MIDI file\'s key less than a written one', () => {
    const ctx = contextFromScore({ ...study(), source: 'midi' });
    expect(ctx.keys.every((k) => k.confidence === MIDI_KEY_CONFIDENCE)).toBe(true);
  });

  it('reads tempo marks piecewise and bar lines across a pickup and a meter change', () => {
    const clock = scoreClock({ tempoMap: [{ beat: 0, bpm: 60 }, { beat: 4, bpm: 120 }] });
    expect(clock(4)).toBeCloseTo(4, 9);
    expect(clock(6)).toBeCloseTo(5, 9);
    expect(scoreClock({ tempoMap: [] })(2)).toBeCloseTo(1, 9);
    const doc = ScoreDocSchema.parse({
      title: 't',
      source: 'musicxml',
      parts: [],
      timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }, { beat: 9, numerator: 3, denominator: 4 }],
      pickup: 1,
      lengthBeats: 15,
    });
    // The pickup's beat is no bar line; the 3/4 at beat 9 starts one wherever the 4/4 bar would end.
    expect(barLines(doc)).toEqual([1, 5, 9, 12]);
  });
});

describe('reading the timeline', () => {
  const ctx = contextFromScore(study());

  it('maps the ruler both ways, extrapolating past its ends', () => {
    expect(secondsOfBeat(ctx, 16)).toBeCloseTo(10, 9);
    expect(secondsOfBeat(ctx, 50)).toBeCloseTo(31.25, 9);
    expect(beatOfSeconds(ctx, 10)).toBeCloseTo(16, 9);
    expect(beatOfSeconds(ctx, secondsOfBeat(ctx, 23.37))).toBeCloseTo(23.37, 9);
    expect(secondsOfBeat({ beats: [] }, 1)).toBeNaN();
  });

  it('holds the first key before the piece and the last after it; a chord only inside', () => {
    expect(keyAt(ctx, -1)?.tonic).toBe(0);
    expect(keyAt(ctx, 9.999)?.tonic).toBe(0);
    expect(keyAt(ctx, 10)?.tonic).toBe(7);
    expect(keyAt(ctx, 99)?.tonic).toBe(5);
    expect(chordAt(ctx, 31)).toBeNull();
    expect(nextSpan(ctx.keys, 3)?.start).toBe(10);
    expect(nextSpan(ctx.keys, 25)).toBeNull();
  });

  it('lists what comes within a horizon: the bar line, then its key and chord, then the note', () => {
    const next = expectations(ctx, 9.5, 0.5);
    expect(next.map((e) => e.kind)).toEqual(['bar', 'key', 'chord', 'note']);
    expect(next.every((e) => e.t === 10)).toBe(true);
    expect(expectations(ctx, 10, 0.1)).toEqual([]);
  });
});

describe('the device cache', () => {
  it('keys content by its SHA-256 and runs the producer once', async () => {
    const doc = study();
    const key = await contentKey(JSON.stringify(doc));
    expect(key).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await contentKey(JSON.stringify(doc))).toBe(key);
    let runs = 0;
    const base = scoreProducer();
    const counted = { ...base, produce: (d: ScoreDoc, o?: { contentKey?: string }) => (runs++, base.produce(d, o)) };
    const cache = memoryContextCache();
    const a = await produceCached(counted, doc, key, cache);
    const b = await produceCached(counted, doc, key, cache);
    expect(runs).toBe(1);
    expect(b).toEqual(a);
    expect(a.contentKey).toBe(key);
  });

  it('treats an entry of another version, or a cache that throws, as a miss', async () => {
    expect(readCachedContext({ v: 2, source: 'score', durationS: 1 })).toBeNull();
    expect(readCachedContext(null)).toBeNull();
    const broken = { get: async () => Promise.reject(new Error('quota')), set: async () => Promise.reject(new Error('quota')) };
    const ctx = await produceCached(scoreProducer(), study(), 'k', broken);
    expect(ctx.keys).toHaveLength(3);
  });
});
