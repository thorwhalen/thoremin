# Harmonic layers: chord spaces, layouts, navigation and realization as composable parts

*Design record, 2026-10-19 (epic #613; the user's choices #614). The research behind it is [`docs/research/harmony-relations-and-realization.md`](../research/harmony-relations-and-realization.md) (cited here as R§n) and the earlier `docs/research/chord-layouts.md` (cited as CL§n). It fits the seams of the architecture epic #600 (S4: chord producers as a pool; S5: overlay elements as a contribution point) and does not fight them.*

## 0. TL;DR

The chord map (#609, `packages/ext-air/src/nodes/chord_map.ts`) is one instance of a family. Pur Pasteur's harmonic map lays out the seven chords of a key by three relations (moves by a fourth, a third and a second) and lets a hand point at one. Change the relations and you get a Tonnetz; change the layout and you get a circle of fifths or a "next chord" wheel centred on where you are; change the input and the face, a sign, a MIDI keyboard or a sung note chooses; change the realization and the same chord comes out as a voice-led pad, a strum or an arpeggio. Today each chord instrument in thoremin owns all of these at once.

This design separates them into seven parts, each a pure library contract in a new `@thoremin/sdk/harmony/` with one or more strategies behind it:

| # | Part | Question it answers | Today, buried in |
|---|---|---|---|
| 1 | **Chord** (vocabulary) | what a chord is, before any notes | `theory.ts` (`ChordQuality`, `diatonicChord`), `guitar.ts` (a second `ChordQuality`), tonal in `chord.ts` |
| 2 | **Space** (relations) | which chords there are and how they are related: a graph whose edges are named relations | implicit: "the seven degrees of a key", `moveText` in `chord_map.ts` |
| 3 | **State** | where the harmony is: key, current chord, its function, history, what is pending and when | a local `lastDegree` in each node |
| 4 | **Layout** | where each chord or move is on the screen, possibly as a function of the state | `layoutCells` in `ext-air/lib/chord_map.ts` |
| 5 | **Navigation** | how input features become a chosen chord or a move, and when the choice commits | `createCellTracker`, `yawToDegree`, the expression and category degree tables, `letterDegree`, the strum detector |
| 6 | **Realization** | how a chord becomes notes: coloration, reduction, bass, voicing, figuration | `voicing.ts` (`VOICINGS`, `RENDERINGS`), `chord_render.ts`, `guitar.ts`, `pose_chord.ts`'s brow seventh |
| 7 | **Rendering** | where notes and pictures go: synth voices, timed note events, MIDI, the orchestra, the overlay | each node's own output ports |

On the DAG these become a small number of generic nodes (a few **navigators**, one **harmonic-state**, one **chord-realizer**) fed by S4's pool, drawn through S5's contribution point, configured by data. The five chord nodes that exist today keep their types and their stored settings; they are refactored to call the shared libraries first (no graph change), and are re-expressed as compositions only where an instrument needs two navigators on one harmonic state.

The first three PRs touch only `packages/sdk/src/music` and the libraries under it, so they can run alongside #600's phase B: (H1) one chord model and the key's chords in the SDK; (H2) the realization pipeline with one seam per aspect and today's output byte for byte; (H3) the first two new realizations, a voice-led voicing (the video's common-tone voice leading, #602 choice 5) and a diatonic-seventh coloration.

## 1. The terms

The words follow `docs/design/component-model.md`: a **node** carries **roles**, a **port** carries a **kind**, a toggled function inside a node is an **element**, a swap point is a **slot**. This document adds:

- **Chord**: an abstract sonority: a root pitch class, a quality (an interval set above the root) and optionally a bass. No register, no notes.
- **Key context** (key): a tonic and a scale. A chord in a key also has a **function**: a degree (with an optional alteration), a Roman numeral, a Riemann function (T, S, D).
- **Relation**: a named, directed way to go from one chord to another ("a diatonic fourth up", "P", "the dominant of"). A relation is a function `chord, key -> chord`; some are involutions (P, L, R), some are cyclic (a diatonic step), some are partial.
- **Space**: a set of chords with the relations that connect them. Mathematically a labelled graph (a Cayley graph when the relations are group elements, as P/L/R are).
- **Target**: what a navigator can choose: a chord, a relation (a move from the current chord), a function, or a realization control.
- **Intent**: a navigator's committed choice, with a time: "choose Am at t", "apply R at t", "add the seventh while held".
- **Realization**: the pipeline from a chord in a key to notes in time. Five aspects, after the user's list: **coloration** (extensions and alterations), **reduction** (omissions and density), **bass** (inversion and bass note), **voicing** (vertical spacing and register, with voice-leading memory), **figuration** (temporal rendering: block, strum, arpeggio, broken patterns).

## 2. The parts and their contracts

Everything in this section is pure TypeScript in `packages/sdk/src/harmony/` (no DOM, no audio, no DAG), Node-safe and unit-testable, in the style of `packages/ictus`. Persisted shapes are Zod schemas; per-tick shapes are plain types.

### 2.1 Chord: one vocabulary

Today thoremin has two chord-quality vocabularies (`ChordQuality` in `theory.ts`, the `CHORD_QUALITIES` table in `ext-air/lib/guitar.ts`) and a third via tonal's `Chord.get` in `src/nodes/music/chord.ts`. The air guitar parses names, the chord map spells chords, the overlay classifies tones. One registry replaces the three:

```ts
// packages/sdk/src/harmony/chord.ts
export type PitchClass = number; // 0..11, C = 0

/** One quality: the SSOT row. Ids follow the Harte chord syntax shorthands where one exists
 *  (maj, min, dim, aug, maj7, 7, min7, hdim7, dim7, sus4, sus2, 6, min6, 9, ...), R§5.1. */
export const QUALITIES = {
  maj:   { intervals: [0, 4, 7],      suffix: '',     roles: ['1', '3', '5'] },
  min:   { intervals: [0, 3, 7],      suffix: 'm',    roles: ['1', 'b3', '5'] },
  dim:   { intervals: [0, 3, 6],      suffix: '°',    roles: ['1', 'b3', 'b5'] },
  aug:   { intervals: [0, 4, 8],      suffix: '+',    roles: ['1', '3', '#5'] },
  '7':   { intervals: [0, 4, 7, 10],  suffix: '7',    roles: ['1', '3', '5', 'b7'] },
  maj7:  { intervals: [0, 4, 7, 11],  suffix: 'maj7', roles: ['1', '3', '5', '7'] },
  // ... every quality any instrument uses today, and the sus / 6 / add9 the guitar parses
} as const satisfies Record<string, QualityDef>;
export type QualityId = keyof typeof QUALITIES;

export const ChordSchema = z.object({
  root: z.number().int().min(0).max(11),
  quality: z.enum(QUALITY_IDS),
  /** Bass pitch class when it is not the root (a slash chord); absent = root. */
  bass: z.number().int().min(0).max(11).optional(),
});
export type Chord = z.infer<typeof ChordSchema>;

/** "C:maj", "A:min7", "G:7/B": a stable string id (Harte-style), for maps, captions and tests. */
export function chordId(c: Chord): string;
export function parseChordId(id: string): Chord | null;
/** "Am7", "B°", "Bb": spelled in a key when one is given (the chord map's `spellOnLetter` rule). */
export function chordName(c: Chord, key?: Key): string;
export function pitchClasses(c: Chord): PitchClass[];
export function classify(midis: readonly number[]): Chord | null; // replaces theory.ts classifyChord

export const KeySchema = z.object({ tonic: z.number().int().min(0).max(11), scale: z.enum(SCALE_TYPE_IDS) });
export type Key = z.infer<typeof KeySchema>;

/** A chord's function in a key: what Roman numerals and Riemann letters say. */
export interface ChordFunction {
  degree: number;                  // 0..6 on the key's seven-note parent
  alter?: -1 | 1;                  // bVII, #iv
  of?: number;                     // applied: V/V has degree 4 of degree 4
  numeral: string;                 // "V7/V", "bVII", "iiø"
  riemann?: 'T' | 'S' | 'D';
}
export function diatonicChords(key: Key, size?: 3 | 4): Chord[];  // moved from ext-air/lib/chord_map.ts
export function functionOf(chord: Chord, key: Key): ChordFunction | null;
export function chordOfFunction(fn: Pick<ChordFunction, 'degree' | 'alter' | 'of'>, key: Key, size?: 3 | 4): Chord;
```

`theory.ts` keeps its exports (`diatonicChord`, `romanNumeral`, `letterDegree`, `classifyChord`, `chordName`) as facades over this module, so no caller changes in the PR that adds it. A five-note key is read through its seven-note parent everywhere, as today (`defaultChordSpecFor`).

Tonal (already a dependency, 6.4) supplies parsing and spelling where it is stronger (`Chord.get`, `ChordType`, `Chord.detect` for a set of MIDI notes); the registry above is thoremin's own because the qualities carry **roles** (`'1'`, `'b3'`, `'b7'`), which reduction and coloration need and tonal does not expose.

### 2.2 Space: chords and named relations

```ts
// packages/sdk/src/harmony/space.ts
export interface Relation {
  id: string;                         // 'dia+3', 'P', 'L', 'R', 'N', 'S', 'H', 'dom', 'rel', 'par', ...
  label: string;                      // "4th up", "parallel", "dominant of"
  family: RelationFamily;             // 'diatonic' | 'neo-riemannian' | 'functional' | 'chromatic-mediant' | 'corpus' | 'voice-leading' | 'custom'
  inverse?: string;                   // 'dia+3' <-> 'dia-3'; P, L, R are their own inverse
  /** The chord(s) this relation reaches from `from` in `key`; [] where it does not apply
   *  (P from a diminished triad). */
  apply(from: Chord, key: Key): Chord[];
}

export interface Edge { from: Chord; to: Chord; relation: string; weight?: number }

export interface HarmonicSpace {
  id: string;
  /** The chords of the space in this key (finite spaces only; a generated space may be lazy). */
  chords(key: Key): readonly Chord[];
  /** The moves out of a chord, in a stable order (the order a radial layout uses). */
  neighbours(from: Chord, key: Key): readonly Edge[];
  relations: readonly Relation[];
}
```

A space is built from relations by a few combinators, so new ones are data, not code:

| Combinator | What it makes | Example |
|---|---|---|
| `generated(relations, { seeds, within? })` | the closure of the seeds under the relations, optionally restricted to a predicate | PLR from C major: the 24 major and minor triads (R§2.2) |
| `diatonic(key, steps)` | the key's chords, related by scale steps | the video's map: steps +3, +2, -1 |
| `union(a, b)` / `restrict(space, pred)` | combination and filtering | diatonic triads plus secondary dominants; PLR restricted to one hexatonic system |
| `weighted(space, model)` | edge weights from a model | a transition prior, a voice-leading cost, Lerdahl's chord distance |
| `annotated(space, captions)` | text per edge (by relation, or by from-degree and to-degree) | interval captions, a player's own words, a caption set someone imports |

The relation catalogue (R§2 has the theory and the sources):

| Family | Relations | Notes |
|---|---|---|
| `diatonic` | `dia±1`, `dia±2`, `dia±3` (steps along the key's seven chords) | the video's three dimensions; a step of 2 keeps two common tones, of 3 one, of 1 none (CL§1, R§2.4) |
| `neo-riemannian` | `P`, `L`, `R`; compounds `N` (Nebenverwandt), `S` (Slide), `H` (hexatonic pole, LPL) | P/L/R keep two common tones and move one voice by one or two semitones; triads only; compounds are compositions, so they are generated, not hand-written (R§2.2) |
| `functional` | `dom` (dominant of: V/x), `sub`, `rel` (relative), `par` (parallel), `tritoneSub`, `mixture` (borrowed from the parallel mode: iv, bVI, bVII) | Riemann functions and the common tonal moves (R§2.1) |
| `chromatic-mediant` | major thirds and minor thirds between same-quality triads | the film-music vocabulary (R§6.3) |
| `voice-leading` | "any chord reachable with a total motion of at most k semitones" | Tymoczko's measure; parsimonious graphs are the k = 1 or 2 case (R§2.3) |
| `corpus` | "the next chord's probability given the last one(s)" | weights, not new edges; needs a dataset and its licence (§9, choice 3) |

Two facts from the research shape this catalogue. First, every triadic relation in the `neo-riemannian` and `chromatic-mediant` rows is a **uniform triadic transformation** (Hook): a sign (keep or flip the mode) and two transpositions mod 12 (one applied to major roots, one to minor roots); P, L and R are a subgroup of this family (R§2.2). So those relations are data (`utt({ flip, major, minor })`), not code, and a player-defined move is one more row. Second, adjacency on a lattice is not voice-leading distance: on the Tonnetz C to F is two steps and C to f three, although C to f moves less (Tymoczko; R§2.3). A layout says which moves are one step; a distance says how far apart chords sound. The design keeps them apart, and the `voice-leading` family uses the faithful measure (Cube Dance for triads, Power Towers for sevenths), not lattice hops.

Weights depend on style. In Beethoven's quartets progressions are directed (V to I is 14.7 % of all transitions, I to V 10.9 %; descending fifths 23.9 % against ascending 15.6 %), while in the rock corpus root motion is nearly symmetric (a fourth up 2,266 times, a fourth down 2,220) and IV is the commonest chord both before and after I (R§2.6). A `weighted` space therefore takes a named prior (`classical`, `rock`, `theory`), never one global table.

Distances are a separate small module (`harmony/distance.ts`): `commonTones(a, b)`, `voiceLeadingCost(a, b)` (minimal total semitone motion, octave-equivalent, computed by trying the assignments of three or four voices), `lerdahlDistance(a, b, key)` (the chord-distance rule of tonal pitch space, R§3.1), `spiralDistance` (Chew's spiral array, R§3.2). Layouts, weights and tension models read them; nothing else does.

### 2.3 State: where the harmony is

```ts
// packages/sdk/src/harmony/state.ts
export interface HarmonicState {
  key: Key;
  chord: Chord | null;              // null = silence (a release, or no chord chosen yet)
  fn: ChordFunction | null;         // the chord's function in the key, when it has one
  /** When the chord took (or will take) effect, engine seconds. A quantized or predicted
   *  commit is in the future, and the realizer starts it then. */
  at: number;
  /** The last chords, most recent first (bounded): voice leading, recentring layouts,
   *  "go back", and a transition prior read it. */
  history: readonly { chord: Chord; at: number }[];
  /** Live realization controls the navigators set (the brow's "add the seventh", a smile's
   *  brightness, a density from the mouth), merged by key; see §2.5. */
  controls: Readonly<Partial<RealizationControls>>;
  /** The choice a navigator is moving to but has not committed (drawn half-lit). */
  candidate: Chord | null;
}

export type Intent =
  | { kind: 'choose'; chord: Chord; at: number }                 // absolute: a cell, a degree, a sign, a MIDI chord
  | { kind: 'step'; relation: string; at: number }               // relative: apply a relation to the current chord
  | { kind: 'function'; fn: Pick<ChordFunction, 'degree' | 'alter' | 'of'>; at: number }
  | { kind: 'release'; at: number }
  | { kind: 'modulate'; key: Key; at: number }
  | { kind: 'controls'; controls: Partial<RealizationControls> } // continuous: no commit time
  | { kind: 'candidate'; chord: Chord | null };

/** The reducer: pure, deterministic, so a fixture replays exactly. */
export function applyIntents(state: HarmonicState, intents: readonly Intent[], space: HarmonicSpace): HarmonicState;
```

Intents from several navigators in one tick are applied in their pool priority order (the S4 rule), so "the hands choose and the face colours" is two navigators on one state with no special code. A `step` whose relation does not apply (P from a diminished chord) is a no-op that the state reports, so a navigator can show it.

### 2.4 Layout: where each target is, maybe depending on where we are

```ts
// packages/sdk/src/harmony/layout.ts
export interface Placement {
  target: Target;                   // a chord, or a relation (a move from the current chord)
  x: number; y: number; w: number; h: number;   // display fractions, the overlay's convention
  shape: 'hex' | 'rect' | 'tri' | 'wedge' | 'circle';
  label: string; sub: string;       // "Em", "iii"
  color: string;
}
export interface LayoutFrame { region: Region; aspect: number }
export interface Layout {
  id: string;
  /** Static layouts ignore `state`; dynamic ones depend on it (and must say so). */
  dynamic: boolean;
  place(space: HarmonicSpace, state: HarmonicState, frame: LayoutFrame): readonly Placement[];
  /** Edges or arrows to draw between placements (a graph layout), and captions on them. */
  links?(space: HarmonicSpace, state: HarmonicState, placed: readonly Placement[]): readonly Link[];
}
```

| Layout | Static or dynamic | What it is | Source |
|---|---|---|---|
| `lattice({ east, southEast })` | static, periodic | two relations as the basis of a hex (or square) lattice; the video's map is `lattice({ east: 'dia+3', southEast: 'dia+2' })`; the pitch Tonnetz is a lattice of pitches with triangles as targets | today's `layoutCells`, generalized from scale steps to relations |
| `strip(order)` | static | one row of full-height cells in a cycle's order (scale order, fifths) | today's `scale` and `fifths` layouts |
| `ring(cycle)` | static | angle = position in a cycle (circle of fifths, diatonic circle of thirds), radius = a second attribute (major outside, minor inside) | the chord-wheel family, CL§2.4 |
| `radial({ relations })` | dynamic (recentred) | the current chord in the middle, one wedge per relation at a FIXED angle (P always at the same place), so a direction always means the same move; at most eight wedges (expert marking-menu selection held for eight items, not twelve) | the video's chapter-2 graph; pie and marking menus (R§4.2) |
| `ranked({ k, by })` | dynamic | the k most likely or least tense next chords around the current one, sized by weight | Hooktheory-style "what comes next" (R§2.6) |
| `embedding(distance)` | static, computed once per space and key | positions from a 2-D embedding of a distance (MDS of voice-leading cost, Lerdahl's regional space, the spiral array projected) | R§3 |
| `recentre(layout, { anchor, easing })` | dynamic wrapper | translates any static layout so the current chord sits at the anchor, animated | the "map scrolls under you" variant |

**The one rule that ties layout to navigation.** A dynamic layout moves its targets when the chord changes. A hand that points at absolute positions on it would then be over a different target the moment its choice commits, and would choose again: a feedback loop. So a dynamic layout is navigated relatively (a displacement from a rest point, a direction, a gesture), and an absolute pointer gets a static layout. The navigator declares which it needs and the composer refuses the wrong pairing with an error that names both (§4.4). This is the design reason the video's map is periodic and static while its explainer graph is radial: one is for pointing, the other for moves.

### 2.5 Navigation: features to intents, and when they commit

A navigator is three small pieces, each a strategy:

```ts
// packages/sdk/src/harmony/navigate.ts
/** 1. Read: input features -> a navigational signal. */
export type NavSignal =
  | { kind: 'point'; x: number; y: number }                          // a hand's palm, a fingertip, the nose
  | { kind: 'vector'; dx: number; dy: number }                       // displacement from a rest centre (joystick)
  | { kind: 'category'; id: string | null; scores?: CategoryScores } // a face expression, a hand shape, a sign, a pose
  | { kind: 'scalar'; name: string; value: number }                  // head yaw, smile, mouth open, pitch height
  | { kind: 'trigger'; t: number; strength: number; predicted: boolean } // a strum, a pinch, a MIDI note-on, an onset
  | { kind: 'observed'; chord: Chord | null; confidence: number };   // MIDI notes held, audio chroma matched

/** 2. Select: signal -> a target (a chord, a relation, a function, a control). */
export type Selector =
  | { kind: 'hit'; layout: string }                      // which placement the point is over
  | { kind: 'direction'; layout: string; dead: number }  // which wedge the vector points into
  | { kind: 'table'; table: TargetTable }                // category id -> target (persisted, §5.4)
  | { kind: 'quantize'; targets: readonly Target[] }     // a scalar swept over n targets (yaw -> degree)
  | { kind: 'control'; control: keyof RealizationControls; curve: Curve } // a scalar -> a realization control
  | { kind: 'follow'; space: string };                   // an observed chord -> the nearest chord of the space

/** 3. Commit: when a selected target becomes an intent. */
export type CommitPolicy =
  | { kind: 'immediate' }
  | { kind: 'dwell'; frames: number; hysteresis?: number; releaseS?: number }  // today's cell tracker
  | { kind: 'gated'; by: 'trigger' }                    // choose with one input, commit on another (the Omnichord split)
  | { kind: 'quantized'; grid: 'beat' | 'bar' | 'half'; clock: 'musical-time'; push?: number } // launch quantization; `push` anticipates by a fraction of a beat (Band-in-a-Box's ^C)
  | { kind: 'predicted'; lead: 'output' };              // the strum's rule: committed ahead of the frame that shows it
```

`Target` is the union that matters for the face (§5.4):

```ts
export const TargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('degree'), degree: z.number().int().min(-1).max(6) }),     // -1 = silence, today's ints
  z.object({ kind: z.literal('chord'), chord: z.string() }),                              // a chord id: "A:min"
  z.object({ kind: z.literal('relation'), relation: z.string() }),                        // a move: 'P', 'dia+3'
  z.object({ kind: z.literal('function'), riemann: z.enum(['T', 'S', 'D']) }),           // a function; the space picks the chord
  z.object({ kind: z.literal('control'), control: z.string(), value: z.number() }),       // add the seventh, brighter
]);
```

The existing behaviours are all instances: the chord map is `point` + `hit` + `dwell(2, 0.12, 0.3)`; the pose chord is `scalar(headYaw)` + `quantize(7 degrees)` + `immediate`, gated by the mouth (`scalar(mouthOpen)` as a release threshold), with the brow as `control(addSeventh)`; the face chord is `category` + `table(expression -> degree)` + the categorizer's own hysteresis; the ASL chord is `category(letter)` + `table(letterDegree)`; the air guitar is `category(enrolled shape named "Em")` + `table(name -> chord)` + `gated(strum)` with `predicted`; the chord map's strum mode is `point` + `hit` + `gated(strum, predicted)`.

The **commit time** is part of the intent (`at`), and only the commit policy decides it. "Immediate" is the next tick; "quantized" is the next grid line of the musical clock (the conductor's or the song's `musical-time`, which exists); "predicted" is the impact predictor's time, as for the strum today (`ext-air/lib/strum.ts`). The realizer honours `at`; it never invents its own timing for a chord change. That keeps one rule for "when does a change take effect" across all instruments (R§4.4).

### 2.6 Realization: one seam per aspect

```ts
// packages/sdk/src/harmony/realize/index.ts
export interface Tone { pc: PitchClass; role: ToneRole }       // role: '1' | 'b3' | '3' | '5' | 'b7' | '9' | '#11' | ...

export interface RealizationControls {
  tension: number;      // 0..1: how many extensions coloration may add
  density: number;      // 0..1: how many notes reduction keeps
  register: number;     // octaves of shift (today's octaveShift)
  spread: number;       // 0..1: close to open
  brightness: number;   // a synth parameter passed through (the pose chord's smile)
  addSeventh: boolean;  // the pose chord's brow, kept as a named control
}

export interface Coloration { id: string; color(chord: Chord, key: Key, c: RealizationControls): Tone[] }
export interface Reduction  { id: string; reduce(tones: Tone[], c: RealizationControls): Tone[] }
export interface BassRule   { id: string; bass(tones: Tone[], chord: Chord, memory: VoicingMemory): PitchClass }
export interface Voicer     { id: string; voice(tones: Tone[], bass: PitchClass, c: RealizationControls, memory: VoicingMemory): number[] } // MIDI, ascending
export interface Figuration {
  id: string;
  /** Continuous voices (the webaudio synth's model) for this tick, and/or timed note events
   *  (pluck-out, MIDI, the orchestra's scheduler). */
  render(voiced: readonly number[], change: ChangeInfo, clock: FigurationClock, dt: number): { gains?: number[]; events?: NoteEvent[] };
}

export interface RealizationSpec {
  coloration: string; reduction: string; bass: string; voicing: string; figuration: string;
}
/** The pipeline: stateful only in its voicing memory and its figuration clock; deterministic given the ticks. */
export function createRealizer(spec: RealizationSpec, opts: { idBase: number; maxVoices: number; registry?: RealizationRegistry }): Realizer;
```

Why five seams and not one "voicing" setting: learned jazz voicing works better split into colouring and voicing than end to end (Chen et al.), and the tools players already use keep chord memory, voicing, inversion and arpeggio pattern as separate settings (Cthulhu, Scaler, Logic's Chord Trigger, Ableton's arpeggiator; R§5.2, R§5.5). The bass is its own seam because it is expressive on its own: a major triad's rated valence rises from root position to first to second inversion (R§5.4).

Each aspect is a registry of named strategies (a keyed map, the #600 combination rule), so an extension can add one. Today's defaults and the first real alternatives:

| Aspect | Default today (no new dependency) | First real alternatives | Later |
|---|---|---|---|
| **Coloration** | `asIs`: the chord's own tones (triads stay triads) | `diatonicSeventh` (the pose chord's brow rule, moved here: degree + 6 on the scale); `byTension` (adds the chord-scale's available tensions in a fixed order, 9 then 11 or 13, avoiding the avoid notes, as many as `tension` allows; R§5.2) | altered dominants; a player's own colour per degree |
| **Reduction** | `none` | `byPriority(density)`: drop in the order 5, then 1 when the bass has it, keep 3 and 7 (guide tones) last; `shell` (1-3-7) | rootless voicings for a separate bass voice |
| **Bass** | `root` (today: every voicing has the root in the bass) | `smooth`: the chord tone nearest the previous bass (a walking line by step); `inversion(k)`; `pedal(degree)` | a figured-bass table per function |
| **Voicing** | `idiom(spread | bassTriad | close | shell | power)`: today's `voiceTriad`, unchanged | `voiceLed`: the voicing of the upper tones nearest the previous one, common tones held. Between chords of the same size a minimal voice leading with no crossed voices always exists, so it is found by sorting both chords and trying the n rotations with octave offsets, no general assignment solver needed (Tymoczko; R§5.3); a change of size (a seventh added) falls back to trying the few doublings and omissions; `fretboard(tuning)`: the air guitar's open-chord rule (`guitarVoicing`), moved from ext-air | tonal's `Voicing` dictionaries (`lefthand`, `triads`) with its `topNoteDiff` |
| **Figuration** | `gains(sustained | strum | arpUp | arpDown | arpUpDown | pulse | alberti)`: today's `renderGains` on the node's own BPM | `strumEvents`: timed note events with a spread per string (the air guitar's `strumNotes`); clock = `musical-time` (the conductor's or song's beat) instead of a private BPM | `pattern(steps)`: broken-chord patterns as data (a step grid of voice index and velocity, like `drum_patterns.ts`), a zodal collection |

**Voice-leading memory** (`VoicingMemory`: the last voicing, the last bass, the time) is the only state the voicer keeps, and it is reset on a long silence (a parameter), so the first chord after a rest is voiced from the register window rather than from a voicing heard a minute ago. Memory lives in the realizer instance, not in the harmonic state, because two realizers on one state (a pad and a strum) voice independently.

**Today's ids stay valid.** `faceChord.voicing` and `faceChord.rendering` are stored in every instrument. Their values remain ids of the voicing and figuration registries, so nothing stored changes. `shell` and `power` are, strictly, a reduction plus a voicing; they stay voicing ids (each one's recipe is a fixed reduction followed by a fixed spacing inside the strategy), because renaming stored values buys nothing.

### 2.7 Rendering: where notes and pictures go

Two note currencies already exist and both stay: continuous **voices** (`synth-params`: stable voice ids that the webaudio synth glides and releases by presence) and timed **note events** (`note-events`: the air instruments' and the strum's, sounded on the audio clock by `pluck-out`). The realizer emits either or both, as the chord map does today. MIDI out reads the merged voices (it does now); a realizer's note events can feed it too once `midi-out` takes `note-events` (a small additive port). The conductor's orchestra stays a separate realizer of fully written notes (§6.6).

The screen gets one data shape per layout, the existing `cell-grid` kind (`packages/sdk/src/nodes/cell_grid.ts`), extended additively with the shapes `tri`, `wedge`, `circle` and with `links` (lines between cells, for a graph layout). The chord name, numeral, function letter and the lit keyboard notes come from the harmonic state through the chord pool (S4) to the overlay's chord elements, so every instrument shows its chord the same way.

## 3. What each part needs from the others (the dependency rule)

```
chord  <-  space  <-  state  <-  layout  <-  navigation
  ^          ^                                   |
  |          +----------- realization <----------+  (intents -> state -> realizer)
  +--------------------------------------------- rendering
```

`chord` imports nothing but Zod and the scale table. `space` imports `chord`. `state` imports `space` (to apply a relation). `layout` imports `space` and `state`. `navigate` imports `layout` (for hit tests) and `state` (for intents). `realize` imports `chord` only: it never knows how a chord was chosen. A test in the style of `test/packages_purity.test.ts` keeps this order.

## 4. On the DAG

### 4.1 What stays a library and what becomes a node

Libraries (pure, in the SDK): every strategy above, the reducer, the cell tracker (moved from `ext-air/lib/chord_map.ts` to `harmony/navigate.ts`), the strum detector (to `harmony/trigger.ts`, it is the `predicted` commit policy for any instrument). Libraries are where reuse happens; most of the value of this design is reached with no new node at all (§8, steps H1 to H4).

Nodes (in a new `harmony` slice, §4.3), few and generic, configured by data:

| Node | Roles | Inputs (kinds) | Outputs (kinds) |
|---|---|---|---|
| `point-nav` | `feature`, `mapping` | `hands-frame` (or `body-frame`, `face-frame`), `harmonic-state` (**delayed**), `harmony-config` | `harmonic-intents`, `cell-grid` |
| `category-nav` | `mapping` | `category-scores` or `face-expression`, `harmonic-state` (delayed), `target-table` | `harmonic-intents` |
| `scalar-nav` | `mapping` | `face-controls` / `feature-vector`, `harmony-config` | `harmonic-intents` |
| `chord-in` | `source`, `feature` | `midi-events` or `chroma` | `harmonic-intents` (kind `choose` from `observed`) |
| `harmonic-state` | `music` | `intents1..N` (`harmonic-intents`, a pool), `scale-spec` (the key), `harmony-config` | `harmonic-state`, `chord` (`number[]`, for the S4 chord pool) |
| `chord-realizer` | `music` | `harmonic-state`, `chord-config` (the shared Chord sound settings), `musical-time` (optional clock), `octaveShift` | `synth-params`, `note-events`, `number[]` (voiced) |

The navigators read the harmonic state on a **delayed** edge (`EdgeSpec.delayed`, one tick old): a layout that recentres, a relative move, and the hysteresis around the sounding chord all need the state the navigator's own intent will change, which would otherwise be a cycle. One tick is below a camera frame, so it is invisible.

### 4.2 Port kinds (new)

`harmonic-intents` (an array of `Intent`), `harmonic-state`, `harmony-config` (the slice's dial), `target-table` (a category-to-target table), `midi-events` (incoming Web MIDI messages, timestamped), `chroma` (a 12-bin pitch-class profile with a confidence). Each gets a Zod `PortSpec.schema` so `runHeadless` checks it. `cell-grid`, `note-events`, `synth-params`, `musical-time`, `category-scores`, `face-expression`, `scale-spec`, `chord-config` exist.

### 4.3 Where the code lives

- `@thoremin/sdk/harmony/*`: the seven parts' contracts and their default strategies (layer L2 of #600's target, "shared domain libraries"). `@thoremin/sdk/music/{theory,voicing,chord_render}.ts` become facades that re-export from it.
- A **harmony slice** (`packages/ext-harmony`, or `src/slices/harmony` if #600 puts built-in slices in-tree): the nodes above, the `harmony` dial, the branches and instruments of §6, its overlay element for links and wedges (S5), its commands (`harmony/key.next`, `harmony/space.set`, S7). The chord map moves here from `ext-air` once the slice exists (it is a harmony instrument that happens to use hands; ext-air keeps the guitar, bass, drum and flute). Choice 1 in §9.
- The face, categorizer, pose and ASL chord nodes stay where they are, calling the SDK libraries.

### 4.4 Swaps and the "two real implementations" rule

A role earns a settings dropdown only with two real implementations a player would choose between (`component-model.md`). Applied:

| Seam | Implementations at the end of H3 | Dropdown? |
|---|---|---|
| layout | lattice, strip (scale, fifths) | yes (exists: `chordMap.layout`) |
| voicing | five idioms + `voiceLed` (+ `fretboard`) | yes (exists: `faceChord.voicing`) |
| figuration | seven gain patterns (+ `strumEvents`) | yes (exists: `faceChord.rendering`) |
| coloration | `asIs`, `diatonicSeventh` | yes, once `byTension` lands; before it, a "Sevenths" toggle |
| bass | `root` (+ `smooth` in H3) | a toggle "Smooth bass" until a third rule exists |
| reduction | `none` | no: a seam with one strategy and no control |
| space | `diatonic` (+ `plr` in H5) | yes from H5 |
| commit | `dwell`, `gated`, (`quantized` in H9) | not a dropdown: it is part of what an instrument is (hold vs strum) |

The composer checks two pairings and refuses a graph that breaks them, naming both parts: a `dynamic` layout with a `hit` selector (§2.4), and a `quantized` commit with no `musical-time` source composed.

## 5. The existing pieces, mapped and moved

### 5.1 The inventory

| Today | Navigation (signal, selector, commit) | State | Realization | Moves to |
|---|---|---|---|---|
| `expression-chord` (`src/nodes/music/expression_chord.ts`) | category(expression or a personal category), table(`DEFAULT_EXPRESSION_TO_DEGREE` or `categoryDegrees`), the classifier's own hysteresis | none (stateless per tick) | `createChordRenderer`: idiom voicing, gain figuration | node stays; table lookup to `harmony/navigate` (`tableTarget`), rendering to `createRealizer` |
| `categorizer-chord` (`packages/ext-faces/src/nodes/categorizer_chord.ts`) | category(a saved hand/pose categorizer), table(`categorizerChords.degrees`, Auto by position) | none | same renderer | same as above |
| `pose-chord` (`src/nodes/music/pose_chord.ts`) | scalar(yaw) quantized to degrees; scalar(mouthOpen) gate; scalar(pitch) to register; scalar(brow) to `addSeventh`; scalar(smile) to brightness | none | its own copy of voicing + gains (it predates the shared renderer) | node stays; quantize and gates to `harmony/navigate`; the seventh to coloration `diatonicSeventh`; rendering to `createRealizer` (removes the last duplicate of the renderer) |
| `sign-chord` (`thoremin-asl`, external) | category(letter), table(`letterDegree`), `holdChord` | last chord held | its own copy of voicing + gains | a `thoremin-asl` PR after H2 to call `createRealizer`; `letterDegree` stays in the SDK |
| `chord-map` (`packages/ext-air/src/nodes/chord_map.ts`) | point(palm or fingertip), hit on `layoutCells`, `createCellTracker` (dwell 2 frames, hysteresis 0.12, release 0.3 s); strum mode: gated(predicted strum) | `lastDegree` | renderer (hold); `strumNotes` + `guitarVoicing` (strum) | layouts to `harmony/layout` (`lattice`, `strip`), tracker to `harmony/navigate`, `diatonicChords` to `harmony/chord`, strum to `harmony/trigger`, guitar voicing to the `fretboard` voicer; the node becomes `point-nav` + `harmonic-state` + `chord-realizer` in the harmony slice (H5) |
| melody ladder (inside `chord-map`) | point(height) over the current chord's tones | reads the chord | one continuous voice | stays an element of the chord map: a layout of the chord's tones (a `strip` over `pitchClasses(chord)` in a register), not of chords |
| `air-guitar` (`ext-air`) | category(an enrolled shape whose NAME is a chord), gated(predicted strum) | the latched chord | `strumNotes` over `guitarVoicing` | names parse with `harmony/chord` (`parseChordId` and tonal), voicing is the `fretboard` voicer, the strum is `harmony/trigger`; the node stays in ext-air |
| `chord` + `progression` (`src/nodes/music/`) | progression: scalar(position) over a fixed list | none | `voiceChord`: close stacking | composed by no branch today (only the catalog lists them); keep, and re-express `progression` as `scalar-nav` over a `path` space when a branch wants one; deprecate `chord` after H2 |
| `chord-select` (`src/nodes/mapping/chord_select.ts`) | none | picks the first non-empty chord for the overlay | none | becomes S4's pool (`chord1..N` by priority); later the pool carries `harmonic-state` (H5) so the overlay shows the function and the history too |
| `score` + `orchestra` + `scheduler` (`src/score/`, `src/nodes/output/orchestra*.ts`, `packages/ictus/src/scheduler.ts`) | the conductor's beat advances a written score | the score cursor | already-realized notes, GM sections, CC dynamics | stays; contributes (a) its clock (`musical-time`) to quantized commits and beat-domain figuration, (b) its scheduler's commit-late-never-move rule to figuration events in beats, (c) a chord analysis of the sounding notes (`classify`) to the harmonic state for display (§6.6) |
| the expression confusion optimizer (`optimalExpressionToDegree` in `expression.ts`) | an assignment of categories to degrees so confusable expressions land on chords that share notes | | | generalizes to `assignTargets(confusion, targets, distance)` in `harmony/navigate`, usable for any categorizer and any space distance |

### 5.2 Five copies of one renderer become one

`expression-chord`, `categorizer-chord` and `chord-map` already share `createChordRenderer`; `pose-chord` and ASL's `sign-chord` still inline `voiceTriad` + `renderGains`. H2 replaces the shared renderer's inside with the pipeline and H4 moves `pose-chord` onto it, so every chord thoremin plays goes through `createRealizer`, and a new voicing (H3) reaches every instrument at once (#602 choice 5 asked for exactly this).

### 5.3 What moves out of ext-air

`diatonicChords`, `sharedTones`, `DEGREE_COLORS` (a per-degree colour SSOT, already used across layouts) and `moveText` go to `harmony/chord` and `harmony/space`; `layoutCells`, `cellAt`, `neighbourCaptions` to `harmony/layout`; `createCellTracker` to `harmony/navigate`; `strum.ts` to `harmony/trigger`; `guitarVoicing` and `parseChordName` to `harmony/realize/fretboard` and `harmony/chord`. `ext-air` re-exports for one release, then imports from the SDK. `test/extensions_boundary.test.ts`'s `SDK_SURFACE` list grows by these modules.

### 5.4 The face as harmonic expression

Today a face expression is a **degree**: happy plays I, sad vi, angry V (`DEFAULT_EXPRESSION_TO_DEGREE`). That is one row of a larger table. With `Target` (§2.5), a category can stand for any of four things, and the four can be mixed in one table:

| Target kind | What the expression does | Example table | Fits |
|---|---|---|---|
| `degree` / `chord` | chooses a chord (today) | happy -> I, sad -> vi | a face-only instrument; stored tables keep working |
| `function` | chooses a function; the space picks the chord (the nearest by voice leading among those with that function, so repeated "D" alternates V and vii°) | happy -> T, surprised -> D, sad -> S (minor iv by mixture) | functional harmony without degrees |
| `relation` | applies a move to whatever chord the hands chose | sad -> P (major to minor: the major/minor valence association, R§6.1), surprised -> a chromatic mediant (the film-music "wonder" move, R§6.3), happy -> R back | the face colours a progression the hands drive |
| `control` | sets a realization control while held | brow raise -> `addSeventh` (the pose chord's rule, already shipped), smile -> brightness, mouth open -> density and spread, frown -> mixture (borrowed chords) | the face as expression on an instrument, the usual meaning of "expression" |

And two continuous readings, which need no categories at all, mapped where the evidence puts them (R§6.5):

- **Valence** (smile minus frown blendshapes) to **harmony**: chord quality and **mode brightness** (a key-context change along Lydian, Ionian, Mixolydian, Dorian, Aeolian, Phrygian, the modes by the circle of fifths, which listeners' happiness ratings follow except that Lydian rates below Ionian, R§6.2). Changing to the parallel mode is the main valence rule of Livingstone's rule system; in AffectMachine lower valence makes tenser chords likelier; the major/minor link registers within about 200 ms even in untrained listeners (R§6.1, R§6.5).
- **Arousal** (mouth, brows, head motion) to **figuration and register**, not to chord choice: in AffectMachine "arousal had no influence on the chord progression selected" and drove tempo, note density and loudness; in cadence ratings, average pitch height was the main driver of arousal (R§6.5, R§6.1). So arousal sets the arpeggio rate, the density control and the register; a tension-seeking navigator (choose the neighbour whose Lerdahl distance best matches a target, R§3) is an option, not the default.

Both are `scalar-nav` with `control` selectors, so they compose with any chord-choosing navigator. The one face-to-harmony instrument found elsewhere, the Sympathetic Synthesizer, maps smile to major and frown to minor (R§6.5); thoremin's version differs in keeping the choice of chord with the hands. MediaPipe's left and right blendshapes refer to the subject's face, so a mirrored image swaps them; any sided face control reads them through the existing handedness rule (R§6.5).

The persisted tables (`faceCategorizer.degrees`, `categorizerChords.degrees`, both maps of slot to an int with `-2` = Auto and `-1` = silence) widen additively: an int keeps meaning a degree target; a new optional sibling map `targets` holds `TargetSchema` values and wins where present. Expand (read both), migrate (a panel writes `targets` only when a non-degree target is chosen), contract never needed, since an int is a valid shorthand forever. This touches stored player data, so the PR gets an independent review (§8, H6).

The video's emotion labels (one per move from each chord, CL§1) are a caption set on edges: `annotated(space, captions)` keyed by from-degree and to-degree. The design supports them without shipping them: they are the creator's and unsourced (CL§2.5, #602 choice 2). What ships is interval captions, plus a player-editable caption set (a zodal collection, `harmony.captions`).

## 6. Instruments composed from the parts

Each is a branch (or two) in the harmony slice, written as a composition. "Realization" lists the five aspects in order: coloration, reduction, bass, voicing, figuration.

### 6.1 Harmonic Map (the video's tool)

- Space: `diatonic(key, steps [+3, +2, -1])`, annotated with interval captions.
- Layout: `lattice({ east: 'dia+3', southEast: 'dia+2' })`, static, the tonic in the middle, 0.2 frame heights per hex.
- Navigation: left hand `point(palm)` + `hit` + `dwell(2 frames, 0.12, 0.3 s)`; right hand `point(height)` over the chord-tone ladder (the melody).
- Realization: `asIs`, `none`, `root`, **`voiceLed`** (the video's chapter 2: "chord degrees with common-tone voice leading"), `gains(sustained)`.
- This is today's Chord Map with one change (the voicing), and its golden graph is the test that the refactor kept it.

### 6.2 Next-chord wheel (the video's radial explainer, as an instrument)

- Space: `union(diatonic(key, sevenths), functional({ dom: 'secondary', mixture: true }))`, `weighted` by a transition prior (theory-derived first: dominant progressions by descending fifth, then the others, R§2.1; corpus later, choice 3).
- Layout: `ranked({ k: 6, by: weight })` recentred on the current chord, the most likely move on top, with the history drawn as a fading trail.
- Navigation: chord hand as a joystick, `vector` (displacement from its own rest centre, calibrated when the hand first holds still) + `direction` (a wedge per move, a dead zone in the middle), **`gated`** by the other hand's pinch or strum, so aiming makes no sound and the change commits on the trigger (the marking-menu pattern, R§4.2). With a musical clock running, `quantized('beat')`.
- Realization: `diatonicSeventh`, `byPriority(density 0.75)`, `smooth`, `voiceLed`, `gains(pulse)` on `musical-time`.
- A surprise control: a scalar (the other hand's height, or arousal from the face) re-ranks the wheel between the most probable moves and the least probable ones. The nearest prior art, Manaris's Harmonic Navigator, steered "predictability versus surprise" in real time from a Kinect over corpus statistics (R§4.1), and listeners' pleasure peaks where surprise and uncertainty trade off (Cheung et al., R§6.4), which is a reason to give the player the knob rather than fix it.

### 6.3 Tonnetz walker

- Space: `generated([P, L, R, N, S, H], { seeds: [C:maj] })`: the 24 major and minor triads.
- Layout: `radial({ relations: [P, L, R, N, S, H] })` with fixed angles (each move always in the same direction), plus a small static pitch-Tonnetz map in a corner with the path walked so far (orientation without pointing at it).
- Navigation: relative moves. Either the hand as a joystick (`vector` + `direction` + `dwell`), or discrete inputs as moves: a categorizer's categories (hand shapes, poses) in a `table` of `relation` targets, or head tilts as three `scalar` thresholds. A `release` on a fist.
- Realization: `asIs`, `none`, `root`, `voiceLed` (P, L and R move one voice by one or two semitones, R§2.2, so this instrument is audibly smooth by construction), `gains(arpUpDown)`.
- Why it matters: it leaves the key. Every chord-choosing instrument so far is diatonic; this one moves by voice leading through all 24 triads, which is the neo-Riemannian point.
- Why radial and not a raw Tonnetz to point at: in a study of 88 people reading a Tonnetz at first sight, reading it needed music-theory skill (R§4.1). The egocentric wheel asks only "which direction"; the global map is there to look at, not to aim at.

### 6.4 Face harmony (expression as harmony, not as degree)

Two variants, both from §5.4:

- **Face colours, hands choose**: the Harmonic Map (6.1) or the Tonnetz walker (6.3) for the choice, and a second navigator on the same harmonic state: the face, `scalar-nav` with `control` selectors (brow -> `addSeventh`, smile -> brightness, mouth -> density and spread) and a `category-nav` whose table holds `relation` targets (sad -> P while held, released back on neutral). Two navigators, one state, pool priority hands > face.
- **Face only, by function**: `category-nav` with a table of `function` targets (T, S, D) and `relation` targets, the space `diatonic(key) ∪ mixture`, and valence to mode brightness as a slow key-context control (a mode change commits only on a beat, or after a 1 s dwell, so a passing smile does not modulate).

### 6.5 Play along: MIDI or audio chooses, the camera performs

- Navigation: `chord-in`. From MIDI: a Web MIDI input (the `webmidi` package is already a dependency, used by `midi-out`; Safari has no Web MIDI, as for output) gives held notes, tonal's `Chord.detect` or `classify` gives the chord, a short dwell drops passing tones. From audio: a microphone `AnalyserNode` gives a spectrum, folded into a 12-bin chroma and matched against chord templates (R§4.3) with a confidence and hysteresis; no new dependency.
- Layout: the Harmonic Map or a ring, as a display of where the music is (it teaches the map).
- The camera then realizes it: the hand strums or arpeggiates the chord the keyboard or the guitar holds (`gated(strum)` figuration), or the face colours it (6.4). A guitarist's open strings and a singer's hum become the harmony; thoremin performs and decorates it.

### 6.6 Conduct a chord chart

- Space: a `path` space (a progression as a chain: a lead sheet, or a `ScoreDoc` reduced to its chords by `classify` over each beat's sounding notes).
- Navigation: the conductor's `musical-time` advances the cursor (a `scalar` of beats into `quantize` over the chart, commit `quantized('beat')`).
- Realization: `byTension` from the conductor's dynamics, `voiceLed`, figuration patterns in **beats**, scheduled by the ictus scheduler's commit-late-never-move rule (`packages/ictus/src/scheduler.ts`), so the accompaniment follows the conductor's tempo the way the orchestra does.

## 7. Tests that protect the refactor

- **Golden voices**: before H2, record every chord node's `synth-params` over the existing replays (the face fixture for `expression-chord`, the categorizer replays, a scripted yaw sweep for `pose-chord`, the chord-map fixture or synthetic hands for `chord-map`), for each of the five voicings and seven renderings. After H2 they must be equal sample for sample. This is the guard that "today's output byte for byte" means something.
- **Golden graphs**: `test/fixtures/graph/` and the persisted-state goldens from #605 must not change in H1 to H4. H5 changes graphs only for new instruments.
- **Property tests** in the SDK: `parseChordId(chordId(c)) = c`; `classify(notes(c))` recovers `c` for every quality; P, L, R are involutions and keep two common tones; `dia+k` then `dia-k` is the identity; `voiceLed` never moves the sum of voices more than an idiom would from the same previous voicing; every space's `neighbours` edges satisfy their relation.
- **Navigation replays**: the chord map's cell tracker keeps its tests when it moves; a `direction` selector gets a scripted-vector test; the `gated` and `predicted` commits keep the strum's lead tests (`test/air/`).
- **Reachability** (the shipping rule): every new instrument gets a shell test that opens it from a cold load and counts the clicks.
- **The pairing check**: a composer test that a dynamic layout with a `hit` selector is refused with both names in the error.

## 8. Migration plan

Ranked; each a PR. "Review" means an independent adversarial review before merge, required where a player hears a timing or voicing change or stored data changes.

| Step | Scope | Depends on | Tests that protect it | Stored data | Review |
|---|---|---|---|---|---|
| **H1. One chord model** | `packages/sdk/src/harmony/chord.ts` (Chord, `QUALITIES` with roles, Key, `chordId`, `functionOf`, `diatonicChords` moved from ext-air, `classify`); `theory.ts` and `guitar.ts` delegate to it | none (runs beside #600 phase B) | property tests; all existing tests unchanged | none | no |
| **H2. The realization pipeline** | `harmony/realize/` with the five registries and today's strategies; `createChordRenderer` becomes a facade over `createRealizer`; `voicing.ts` re-exports | H1 | golden voices (§7), recorded first in the same PR's first commit | none (ids unchanged) | yes, light: every chord instrument's sound goes through it, guarded by the goldens |
| **H3. Voice-led voicing, smooth bass, diatonic seventh** | `voiceLed` voicer with memory, `smooth` bass, `diatonicSeventh` coloration; `voiceLed` added to the `faceChord.voicing` enum (additive); the Harmonic Map instrument defaults to it | H2 | unit (motion bounds, common tones held), a replay of the chord map's C-F-G-C walk, a listening note in #146 | an additive enum value: every saved instrument stays valid; a build older than H3 opening an instrument saved with `voiceLed` (an exported file) would flag it on the dials validation surface rather than play it; the persisted goldens (#605) gain the value | yes: what the player hears changes for the map |
| **H4. Space, layout and navigation libraries** | `harmony/space.ts` (relations: diatonic, PLR and compounds, functional; combinators), `distance.ts`, `layout.ts` (lattice, strip, ring, radial, recentre), `navigate.ts` (selectors, commit policies, the cell tracker, `assignTargets`), `trigger.ts` (the strum); `chord_map` and `pose_chord` call them | H1, H2 | chord-map tests unchanged; golden graphs unchanged; new property tests | none | no |
| **S4, S5 of #600** | chord producers as a pool; overlay elements as a contribution point | (#600) | (#600) | none | S5 yes (#600) |
| **H5. The harmony slice and the generic nodes** | `harmonic-state`, `point-nav`, `category-nav`, `scalar-nav`, `chord-realizer`; port kinds; the slice package; the chord map moves in; new instruments Next-chord wheel (6.2) and Tonnetz walker (6.3) | H4, S4, S5 | golden graph of Chord Map equal by role (the S4 method); scripted-hands replays for the new instruments; reachability tests; the pairing check | a new `harmony` dial slice (new key, no migration) | yes for the delayed-edge state loop (a per-tick path) |
| **H6. Targets beyond degrees** | `TargetSchema`; `targets` sibling maps in `faceCategorizer` and `categorizerChords`; the editor's per-category picker gains "move" and "function"; Face harmony (6.4) | H5 | persisted goldens (#605) for every version; a replay where a stored int table plays exactly as before | yes: expand (read both) then migrate (write `targets` only for new kinds) | **yes** (stored player data) |
| **H7. Valence and arousal as controls** | `scalar-nav` presets for the face; mode brightness; `byTension` coloration | H6 | face fixture replay with known smiles; mode-change dwell test | none | yes (a modulation a player hears) |
| **H8. MIDI and audio in** | `midi-in` source (webmidi), `mic-chroma` source (AnalyserNode), `chord-in` navigator; Play along (6.5) | H5 | a recorded MIDI fixture; a synthesized-audio chroma fixture (sine chords) and one real recording; capability gating test (no Web MIDI) | none | no |
| **H9. Figuration on musical time** | `musical-time` clock for figuration; `quantized` commits; `pattern(steps)` collection; Conduct a chord chart (6.6) | H5, the conductor slice (S18) if it lands first | conductor goldens untouched; a quantization test on a scripted beat | a new collection | yes (timing a player hears) |
| **H10. Weighted spaces and tension** | a transition prior (theory first), Lerdahl distance and the spiral-array tension; `ranked` layout uses them | H4 | numeric tests against published examples (R§3) | none, unless a corpus file ships (licence, choice 3) | no |

The first three steps are H1, H2 and H3. They are SDK-only, do not touch `extensions.json`, `canvas_overlay.ts` or the composer, and so do not collide with #600's S1 to S5. H4 can follow at once; H5 waits for S4 and S5.

## 9. Choices that belong to the user

1. **Where the harmony slice lives.** A new package `@thoremin/ext-harmony` (the chord map moves there from ext-air), or the chord map stays in ext-air and only the libraries move to the SDK. *Recommendation: a slice of its own. Harmony is a feature with its own settings, branches and overlay, and ext-air is about air instruments; it is also what #600's slice model asks for.*
2. **The video's emotion labels.** Ship them as a caption set, or only interval captions and a player-written set. *Recommendation: interval captions plus the editable set (unchanged from #602 choice 2); the framework can load any caption set, so a user who wants the video's words can type them.*
3. **Where transition statistics come from.** A theory-derived prior (no data, no licence question), Hooktheory's API (terms of use, network), or an open corpus (McGill Billboard, Chordonomicon; licence to check, R§2.6). *Recommendation: the theory prior first (H10), an open corpus only after its licence is confirmed, never a network call in the tick.*
4. **What the face does by default in a combined instrument.** Colour (controls and relations) or choose (degrees, as today). *Recommendation: existing face instruments keep choosing (their stored tables are untouched); new combined instruments default to colour, because a hand chooses a chord more reliably than an expression does (CL§5) and expression is what a face is good at.*
5. **Old chord nodes: wrappers or compositions.** Keep `expression-chord`, `categorizer-chord`, `pose-chord`, `sign-chord` as nodes over the shared libraries, or re-express each as `navigator + harmonic-state + chord-realizer`. *Recommendation: wrappers; re-express one only when an instrument needs a second navigator on its state. A graph change costs golden updates and review for no audible gain.*
6. **When a held chord changes with a clock running.** At once (today) or on the next beat. *Recommendation: at once by default, `quantized('beat')` as a per-instrument option, on by default only for instruments that are about rhythm (the wheel, the chart).*
7. **Voice-led voicing as the default.** For the Harmonic Map only, or for every chord instrument. *Recommendation: the Harmonic Map and new instruments only; existing instruments keep `spread` (their saved settings say so, and a player who chose `spread` should keep hearing it).*
8. **MIDI and audio input.** Web MIDI is absent in Safari; microphone chroma is noisy on a laptop. *Recommendation: build both (H8), gate on capability as `midi-out` does, and say plainly in the panel when an input is unavailable.*

## 10. What this design does not do

- It does not change the synth, the merge or the voice-id blocks: each realizer still owns a block of ids (`idBase`), as every chord node does today.
- It does not make the overlay generic beyond `cell-grid`'s additive shapes and links; S5 owns that.
- It does not ship emotion labels, a corpus file, or a learned model.
- It does not touch the legacy app (frozen).

## Fleet search (what exists elsewhere)

Searched with `ir search packages` and `ir discover packages` (chord relationships, tonnetz, voice leading, harmony, pitch class set, music theory, midi, arpeggio) and by reading the candidates. Nothing in the fleet implements a Tonnetz, neo-Riemannian moves or minimal voice leading. Reusable as ideas: `thorwhalen/atonal` (pitch-class sets as 12-bit masks, transposition and inversion classes, relation graphs as edge tables with a pluggable link predicate; its own `voice_leading_distance` matches sorted voices and is not minimal, so it is not to be ported); `accompy` (rhythmic skeletons kept apart from pitch patterns; Roman and Nashville parsing), which supports the `pattern(steps)` figuration; `tetrachord` (inversion and open/close spacing for triads in TS, and a note that Web MIDI is missing on Safari); `songleaf` (key estimation and chord function from symbols). Tonal (already a thoremin dependency) covers spelling, `Chord.detect`, voicing dictionaries and a top-note voice-leading rule. The missing component (relations, Tonnetz, minimal voice leading) is what `@thoremin/sdk/harmony` adds; a Python sibling in atonal is a separate, optional follow-up.

## References

The research note ([`harmony-relations-and-realization.md`](../research/harmony-relations-and-realization.md)) has the full reference list; R§ numbers above point into it. CL§ numbers point into `docs/research/chord-layouts.md`.
