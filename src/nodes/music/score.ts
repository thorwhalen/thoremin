/**
 * `score` node — an immutable piece (notes with musical timing). Given the
 * current `beat` (from the conductor) and a `velocityScale` (the conductor's
 * dynamics), it emits the notes sounding right now as {@link SynthParams} voices,
 * so a fixed piece is *performed* live, its tempo and dynamics directed by gesture
 * (conductor mode, #187). Pure + deterministic.
 *
 * The piece comes from one of two places: a {@link ScoreDoc} on the live `doc` input
 * (what the score pipeline loads — a MIDI or MusicXML file, or a shipped demo — and
 * the store hands to the graph through `store-controls`), or, when none is loaded,
 * the `notes` param (the built-in demo scale). A loaded document plays once through;
 * the param notes loop over `loopBeats`.
 *
 * Voices. Each note maps to a stable voice id ({@link SCORE_VOICE_ID_BASE} + its index
 * in the flattened piece), so the synth manages each note's voice across ticks. The
 * synth releases a voice only when it sees it with `present: false`; a voice that
 * merely vanishes from the list rings on forever. So the node emits the notes sounding
 * NOW plus, for one tick, the notes that were sounding last tick and stopped — never
 * the whole piece: a symphony movement is thousands of notes, and the synth iterates
 * every voice it is handed on every tick. The sounding set is found by a binary search
 * over the piece sorted by onset, bounded by the longest note, so a tick costs
 * O(log n + sounding). The id base keeps the ids clear of the hand voices (0, 1), the
 * emotion chord (2..5) and the pose chord (6..10) it is merged with in the default
 * graph — the synth keys voices by id, and a collision would let a score note steal a
 * hand's voice.
 *
 * `enabled` (#187): the score is wired into the default graph behind the conductor,
 * whose `beat` is frozen while conducting is off — and a frozen beat would otherwise
 * hold whatever note sits at that position forever. With `enabled` false every
 * sounding voice is released and nothing new starts, so the merge passes the hand
 * voices through untouched. A jump backwards in the beat (the conductor re-enabled
 * from the top) releases everything that was sounding.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import { midiToFreq } from '@/music/theory';
import { SoundSchema } from '@/music/sounds';
import { MAX_POSE_VOICES, POSE_VOICE_ID_BASE } from './pose_chord';
import { flattenNotes, ScoreDocSchema, type ScoreDoc, type ScoreNote } from '@/score/schema';
import type { SynthParams, VoiceParams } from '../domain';

const Note = z.object({
  midi: z.number(),
  /** Start time in beats (from the loop start). */
  start: z.number(),
  /** Duration in beats. */
  duration: z.number(),
  /** 0..1. */
  velocity: z.number().min(0).max(1).default(1),
});

const Params = z.object({
  /** The built-in piece, played (looping) when no document is loaded. */
  notes: z.array(Note).default([]),
  /** Loop length in beats for the built-in piece; the beat position wraps modulo this.
   *  0 = no loop. A loaded document never loops. */
  loopBeats: z.number().min(0).default(8),
  /** Base output gain multiplier. */
  baseGain: z.number().min(0).max(1).default(0.4),
  sound: SoundSchema.default('triangle'),
  /** Which parts of a loaded document to play (ids); empty = all. */
  parts: z.array(z.string()).default([]),
});
type Params = z.infer<typeof Params>;

/** First voice id of the score's voices: right after the pose chord's block, derived so
 *  a change to either chord's voice count cannot silently reintroduce a collision. */
export const SCORE_VOICE_ID_BASE = POSE_VOICE_ID_BASE + MAX_POSE_VOICES;

/** The built-in demo piece: one octave of a C major scale, one note per beat over an
 *  eight-beat loop — the same piece `scripts/gen_conductor_demo.ts` renders, so a
 *  conductor with no score loaded still hears the scale follow the hand. */
export const DEMO_SCALE_NOTES = [60, 62, 64, 65, 67, 69, 71, 72].map((midi, i) => ({ midi, start: i, duration: 0.9, velocity: 1 }));

/** A piece prepared for playback: notes sorted by onset, plus the longest duration
 *  (the look-back bound of the sounding-window search). */
interface Piece {
  notes: ScoreNote[];
  maxDuration: number;
  loopBeats: number;
}

function preparePiece(notes: readonly ScoreNote[], loopBeats: number): Piece {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
  let maxDuration = 0;
  for (const n of sorted) maxDuration = Math.max(maxDuration, n.duration);
  return { notes: sorted, maxDuration, loopBeats };
}

/** Index of the first note whose onset is >= `beat` (binary search). */
function lowerBound(notes: readonly ScoreNote[], beat: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].start < beat) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The indices of the notes sounding at `pos`: onset in (pos − maxDuration, pos] and
 *  still held. */
function soundingAt(piece: Piece, pos: number, out: number[]): void {
  out.length = 0;
  const from = lowerBound(piece.notes, pos - piece.maxDuration);
  for (let i = from; i < piece.notes.length; i++) {
    const n = piece.notes[i];
    if (n.start > pos) break;
    if (pos < n.start + n.duration) out.push(i);
  }
}

export const scoreNode = defineNode<Params>({
  type: 'score',
  roles: ['music'],
  title: 'Score',
  description:
    'An immutable piece performed live: beat + velocityScale → the sounding synth voices. Plays a loaded ScoreDoc (MIDI / MusicXML) or the built-in demo scale.',
  inputs: [
    { name: 'beat', kind: 'number', default: 0 },
    { name: 'velocityScale', kind: 'number', default: 1 },
    { name: 'enabled', kind: 'boolean', default: true },
    { name: 'doc', kind: 'score-doc' },
  ],
  outputs: [{ name: 'params', kind: 'synth-params' }],
  params: Params,
  make(p) {
    const builtin = preparePiece(p.notes, p.loopBeats);
    let docRef: unknown = null;
    let docPiece: Piece | null = null;
    /** Voice ids (note indices) sounding on the previous tick. */
    let lastSounding = new Set<number>();
    let lastPos = -Infinity;
    const sounding: number[] = [];

    const pieceFor = (doc: unknown): Piece => {
      if (!doc || typeof doc !== 'object') {
        docRef = null;
        docPiece = null;
        return builtin;
      }
      if (doc !== docRef) {
        docRef = doc;
        const parsed = ScoreDocSchema.safeParse(doc);
        docPiece = parsed.success ? preparePiece(flattenNotes(parsed.data as ScoreDoc, p.parts), 0) : null;
      }
      return docPiece ?? builtin;
    };

    return {
      process(inputs) {
        const enabled = inputs.enabled !== false;
        const rawBeat = typeof inputs.beat === 'number' ? inputs.beat : 0;
        const vScale = typeof inputs.velocityScale === 'number' ? inputs.velocityScale : 1;
        const piece = pieceFor(inputs.doc);
        const pos = piece.loopBeats > 0 ? ((rawBeat % piece.loopBeats) + piece.loopBeats) % piece.loopBeats : rawBeat;

        const voices: VoiceParams[] = [];
        const now = new Set<number>();
        if (enabled) {
          // A jump backwards (re-enabled from the top, or the loop wrapping) must not
          // leave the previous notes ringing: they are released below like any other.
          soundingAt(piece, pos, sounding);
          for (const i of sounding) {
            const n = piece.notes[i];
            now.add(i);
            voices.push({
              id: SCORE_VOICE_ID_BASE + i,
              present: true,
              freq: midiToFreq(n.midi),
              gain: Math.max(0, Math.min(1, n.velocity * vScale)) * p.baseGain,
              sound: p.sound,
            });
          }
        }
        // Release what stopped (or everything, when disabled / the piece changed).
        for (const i of lastSounding) {
          if (now.has(i)) continue;
          const n = piece.notes[i];
          voices.push({ id: SCORE_VOICE_ID_BASE + i, present: false, freq: n ? midiToFreq(n.midi) : 440, gain: 0, sound: p.sound });
        }
        lastSounding = now;
        lastPos = pos;
        void lastPos;
        const out: SynthParams = { voices };
        return { params: out };
      },
    };
  },
});
