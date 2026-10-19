# Harmony as layers: chord relations, distances, layouts, navigation, realization and emotion

*Research note, 2026-10-19. It is the evidence for the design [`docs/design/harmonic-layers.md`](../design/harmonic-layers.md) (epic #613). It extends `docs/research/chord-layouts.md` (cited as CL§n), which covers chord-button instruments, isomorphic note layouts, circle-of-fifths wheels, learnability, pointing precision, dwell and latency; those are not repeated here. Each source is marked where it was read only through a search result, a secondary source, or an abstract.*

## 1. What the video's map encodes, and what is inferred

**Sources and limits.** The video [1] and its Short [2] could not be downloaded on the server (YouTube refuses it), and the transcript is not available. What was read: the description, the chapter list, YouTube's four published frames of the video and the frames of the creator's Shorts. Everything about how the tool behaves in time is inferred from stills (CL§1).

**The chapters**, from the page: motion capture chord control; chord degrees with common-tone voice leading; three dimensions of harmonic movement; a 3D map of diatonic chord progressions; a harmonic tension graph; the emotional correlates of the cycle of fourths, of thirds and of seconds; try it yourself.

**What the frames show.**

- The live tool is a hexagonal lattice of the seven diatonic triads of one key. Across a row each step is a fourth up, the down-right diagonal a third up, the down-left diagonal a second down, so the three axes are the three "dimensions of harmonic movement" of the chapter title: the diatonic cycles of fourths, thirds and seconds (scale steps 3, 2, 1 mod 7). Measured on the frame, CL§1.
- Each of the six edges around the selected chord carries an emotion label for the move across it. Around Em: towards Am "Sad resolution, Acceptance", towards G "Strength, Happy surprise", towards C "Soft return", towards F "Overcoming, Solace", towards B° "Unknown, Complexity", towards Dm "Faltering".
- A frame at about 50 % shows the two cycles as chains with a label on every step. Thirds: C to Em "Lost balance, Loneliness", Em to G "Strength, Happy surprise", G to B° "Thickening, Added tension", B° to Dm "Negative surprise", Dm to F "Help, sweetness", F to Am (a label read as "Hardship"). Fourths: C to F "Exploration, Warmth", F to B° "Drama, Tension, Alarm", B° to Em "Despair, Anger", Em to Am "Sad resolution, Acceptance", Am to Dm "Painful energy, Hope", Dm to G "Happy clarification".
- A frame at about 25 % shows a radial graph: Dmaj7 (I) in the centre with Bm7 (vi), A7 (V), Gmaj7 (IV) and F#m7 (iii) around it, over a piano keyboard. Sevenths, a centre and spokes: an explainer, possibly animated as the centre changes.

**Inferred, not seen.** (a) The "3D map" chapter most likely treats the three cycles as three axes of a space; the hex lattice is a 2-D projection in which the three diatonic step sizes are the three hex directions. (b) The "harmonic tension graph" is probably a per-chord or per-move tension value; no frame shows it, and no source is named. (c) The emotion labels are attached to moves (from-chord, to-chord), not to chords: the same target chord gets different words from different starting chords. That is a modelling choice worth keeping (an annotation on an edge of a relation graph). No study supporting the specific labels was found (CL§2.5 and §6 below).

**A property worth stating** (derived in CL§1): on this lattice every chord's six neighbours are the other six chords, so distance carries no information and direction carries all of it: which of the three cycles, and which way. Steps of 2 (thirds) keep two common tones, steps of 3 (fourths) one, steps of 1 (seconds) none, in a major key. The three cycles are therefore also three degrees of voice-leading smoothness.

## 2. Relations between chords

### 2.1 Functional harmony and root motion

- **Riemann's functions.** Every chord stands for one of three functions, tonic (T), subdominant (S) or dominant (D), possibly in a modified form on another degree; Riemann treated minor as the inversion of major [4] (secondary). In practice: a function is a class of chords, and a move between functions (S to D to T) is the unit of tonal syntax.
- **Root progressions (Meeus).** Meeus reduces tonal syntax to two classes of root motion [3]. *Dominant* progressions: a fifth down (the main one), and as substitutes a third down or a second up. *Subdominant* progressions: the reverse (a fifth up, a third up, a second down). A well-formed tonal phrase is "a series of dominant progressions of which at least one is substituted"; in Bach's chorale BWV 321, 23 of 25 progressions (92 %) are dominant and about 30 % are substitutions; subdominant progressions are "normally not found in immediate succession, unless for special effect" [3]. Meeus quotes Schoenberg's categories: "strong" (ascending) progressions, a fourth up or a third down, "can be used without restriction"; "descending" ones, a fourth down or a third up; "superstrong" ones by a second, which "often appear as deceptive" [3].
- **Hierarchy.** Rohrmeier's generative syntax models harmony as a tree in which chords prepare and prolong others [5]: a dominant prepares its target, which a Markov chain over adjacent chords cannot express.

**Reading for the design.** The video's three cycles are Meeus's root-motion classes restricted to one key: a fourth up (= a fifth down) is the main dominant progression, a third down and a second up are its substitutes; the other directions are subdominant progressions. So the lattice's six directions are exactly "dominant" (three of them) and "subdominant" (the other three). That gives a theory-derived edge weight with no data at all: dominant moves likely, subdominant moves less so, two subdominant moves in a row rare.

### 2.2 Neo-Riemannian relations

- **P, L, R.** P maps a major triad to its parallel minor (C to c), L lowers the root of a major triad by a semitone to give a minor triad (C to e), R maps a major triad to its relative minor (C to a); each is an involution, each keeps two common tones and moves one voice by a semitone (P, L) or a tone (R) [8]. On the Tonnetz, P flips a triangle across its fifth edge, R across its major-third edge, L across its minor-third edge [9] (secondary). The group they generate is dihedral of order 24 and dual, in Lewin's sense, to the transposition and inversion group [8][14]. Alternating R and L walks a regular path on the torus; its first 19 triads occur in order in the second movement of Beethoven's Ninth Symphony [8].
- **Compounds.** S (Slide, C to c#, sharing the third), H (hexatonic pole, LPL, C to ab, no common tone, every voice by a semitone) and N (Nebenverwandt, C to f) [9] (secondary).
- **Cycles and systems.** Alternating P and L gives a hexatonic cycle of six triads (Eb, eb, B, b, G, g); there are four such systems [7] (read through a search result). Weitzmann regions group an augmented triad with the six major and minor triads a semitone from it [12] (secondary). Douthett and Steinbach's "Cube Dance" joins major, minor and augmented triads related by a single semitone of voice leading, and "Power Towers" does the same for seventh chords [10] (search result); Visconti describes Cube Dance as a "unified model of triadic voice-leading space" containing the four hexatonic cycles and the four Weitzmann regions, and Power Towers as three octatonic towers and three Boretz regions [11]. Cohn's book develops these as the chromatic "second nature" of the triad [12] (search result). The field's introduction frames it as the analysis of music "triadic but not altogether tonally unified" [6] (search result).
- **Uniform triadic transformations.** Hook defines a UTT as "an ordered triple consisting of a sign" (keep or flip the mode) and "two integers mod 12" (the root transposition applied to major and to minor triads); Hyer's group of 144 transformations "is extended to a group of 288", and P, L, R sit inside it [13]. Design consequence: every named triadic move, and any move a player invents, is one data row.

### 2.3 Voice-leading geometry

- **Chords as points, voice leadings as paths.** Tymoczko models an n-note chord as a point in an orbifold (n-dimensional space quotiented by octave and order), voice leadings as line segments; in the three-note space, familiar chords "gather near the center", and efficient voice leading exists between chords that are nearly symmetrical [15] (read through a press release and a search result). Callender, Quinn and Tymoczko generalise this to five equivalences (octave, permutation, transposition, inversion, cardinality: "OPTIC"), giving a family of quotient spaces [16] (search result). The book develops the geometry and its use for functional harmony, macroharmony and jazz [17] (search result).
- **Lattice distance is not voice-leading distance.** "Larger distances in the space do not faithfully mirror voice-leading facts" on the Tonnetz: C to F is two steps and C to f three, although C to f needs less total motion; Cube Dance, Power Towers and Tymoczko's scale lattice are faithful (path length equals taxicab voice-leading size) [18]. Tymoczko also gives algorithms for maximally efficient voice leadings [19] (search result).
- **The diatonic circle of thirds.** The triads of a seven-note scale form a cycle of single-step voice leadings (I, vi, IV, ii, vii°, V, iii), each triad between its two smoothest neighbours (CL§2.2, a secondary source citing Tymoczko's book; the specific Tymoczko text was not located by this note either).

### 2.4 The diatonic relations as a family

Summarising §1 to §2.3 in one table (derived here from the sources above):

| Diatonic step | Common tones (major key) | Meeus class | Smoothness | The video's cycle |
|---|---|---|---|---|
| +3 (a fourth up) | 1 | dominant (main) | moderate | fourths |
| -3 (a fourth down) | 1 | subdominant | moderate | fourths, backwards |
| -2 (a third down) | 2 | dominant (substitute) | smoothest | thirds, backwards |
| +2 (a third up) | 2 | subdominant | smoothest | thirds |
| +1 (a second up) | 0 | dominant (substitute) | every voice moves | seconds |
| -1 (a second down) | 0 | subdominant | every voice moves | seconds, backwards |

So the video's three dimensions are, at once, three interval classes of root motion, three levels of common-tone retention, and a split into "forward" (dominant) and "backward" (subdominant) directions. Each of these is a candidate edge attribute (a weight, a colour, a caption).

### 2.5 Chord-scale theory (the bridge to coloration)

Russell's Lydian Chromatic Concept introduced "chord/scale unity": a chord implies a scale, and scales built on a chord's Lydian tonic are colours of increasing tension [32] (secondary). Berklee chord-scale theory states the working rule: a chord's available tensions are scale steps a whole step above a chord tone, and avoid notes are those that form a minor ninth with a chord tone (F over Cmaj7 in Ionian) [33] (secondary; the book's tables were not checked). For the design: a chord in a key implies a scale, and the scale implies which extensions can be added without a clash. That is enough for a `byTension` coloration that adds 9, 11 or 13 in a fixed order and skips avoid notes.

### 2.6 Corpus statistics and expectation

- **Pop and rock.** In de Clercq and Temperley's rock corpus, root shares are I .328, IV .226, V .163, bVII .081, VI .072; after I comes IV 1,052 times, V 710, bVII 470; before I comes IV 1,162 times, V 788; root motion is nearly symmetric (+P4 2,266, -P4 2,220) and frequency falls off regularly with circle-of-fifths distance; the commonest trigrams ending on I are IV-V-I, V-IV-I, bVII-IV-I, VI-IV-I, bVII-bVI-I [35]. The McGill Billboard set is more than 1,000 Hot 100 songs (1958 to 1991) transcribed by jazz musicians with extensions, meter and phrase [34] (search result); its release 2.0 is CC0 per the project page.
- **Classical.** The Annotated Beethoven Corpus is 70 quartet movements and 27,962 chord labels, CC BY-NC-SA [36]. In it, I to V is 10.9 % of all transitions and V to I 14.7% (directedness); authentic root motions are 41.6 % (descending fifth 23.9 %, descending third 7.5 %, ascending second 10.2 %), plagal ones 28.9 %; chord frequencies follow a Zipf-Mandelbrot law [37]. When in Rome gathers more than 2,000 Roman-numeral analyses of about 1,500 works in one format [38] (search result).
- **Very large.** Chordonomicon has 666,000 songs and about 52 million chords scraped from a tab site, in Harte syntax, with 749 distinct chords; a GPT-2 next-chord model reaches 60.13 % accuracy [39]. Its licence was not checked.
- **Hooktheory.** Trends computes next-chord probabilities by "a Markov Analysis using every song in the database" (40,000+ songs on its blog page; "75,000+" on the current page, CL§2.4); G follows C "31 % of the time"; in its UI "chords that are more likely to follow will be bigger"; an API returns next chords with probabilities for a path (`trends/nodes?cp=4,1`) [40].
- **Sequence models.** Chord sequences have been modelled as text with LSTMs, with a diversity parameter for the user [41] (search result).
- **Expectation.** Huron's ITPRA theory splits the response to a musical event into imagination, tension, prediction, reaction and appraisal [42] (search result). IDyOM models expectation with variable-order Markov models, long-term (corpus) and short-term (this piece), giving information content (surprise) and entropy (uncertainty) [43] (search result); a harmonic IDyOM predicted the surprisingness of 300 pop chord sequences better than sensory models [45] (search result). Over about 80,000 Billboard chords, pleasure was highest for low uncertainty with high surprise, or high uncertainty with low surprise [44].

**Reading for the design.** Transition statistics are style-specific (directed in Beethoven, symmetric in rock), so a weighted space needs a named prior, not one table. Licences differ (CC0, CC BY-NC-SA, unknown, an API's terms), so a corpus prior is a decision for the owner. And surprise is a control a player could hold, not only a statistic.

## 3. Distance and tension

### 3.1 Lerdahl's tonal pitch space

- **The chord distance rule** is δ(x to y) = i + j + k: i counts moves of the diatonic collection on the chromatic circle of fifths (a change of region), j moves of the chord root on the diatonic circle of fifths, k the non-common pitch classes in the "basic space" (root, fifth, triad, diatonic and chromatic levels) [20][21]. A mode change "arises not by a transformation but is a by-product" [21]. Quoted values: V to I = 5 [21]; within a key C to Dm = 8, C to G7 = 6, G to Em = 7 [22]. Within a key the chordal space is a torus (fifths one way, diatonic thirds the other), and so is the space of regions [21].
- **Tension.** Lerdahl and Krumhansl model tension from four components: prolongational structure, pitch-space distance, surface tension (non-harmonic tones, inversion, a melody note other than the root) and attraction (voice-by-voice pulls, strongest for V7 to I) [21]. Sequential tension is the distance from the previous event plus surface tension; hierarchical tension is the distance from the event that dominates it in the prolongational tree [21].
- **Code-ready statement.** de Haas, Wiering and Veltkamp restate the within-key rule as d = j + k with the levels and the circle-of-fifths rule spelled out, with worked values [22]. Lerdahl's book [20] was not read; its full wording (including pivot regions) is not checked here.

### 3.2 The spiral array and tension ribbons

- **Geometry.** Chew's spiral array places pitches on a helix by the line of fifths (a quarter turn per fifth, a rise per step), chords as weighted centroids of their pitches, keys as weighted centroids of their I, V and IV chords; the "center of effect" of any set of notes is its weighted centroid [23][24] (search results) [25] (secondary, opened).
- **Tension ribbons.** Herremans and Chew define three tension measures as distances in the spiral array: cloud diameter (the largest distance among the sounding notes), cloud momentum (the distance between successive centres of effect) and tensile strain (the distance from the centre of effect to the key) [26] (the paper refused a fetch; the definitions and constants were read in the partitura reference implementation [27]).
- **Other models.** Farbood's parametric model of tension combines harmony with pitch height, melodic expectation, dynamics, onset frequency, tempo and meter, with a moving window and "trend salience" [28] (search result). Krumhansl's probe-tone key profiles [29] and their multidimensional scaling onto a torus of keys [30] (search results), and Bharucha and Krumhansl's ratings of triad progressions in context [31] (search result), are the perceptual base for chord relatedness.

**Reading for the design.** Two tension models fit a browser instrument with no dependency: Lerdahl's integer distance (a table lookup per chord pair in a key) and the three spiral-array distances (a few Euclidean distances per tick). Either can drive a "harmonic tension graph" like the video's chapter title, a tension-seeking navigator, or a `tension` realization control.

## 4. Layouts and navigation (beyond CL§2 to §5)

### 4.1 Interfaces for harmonic spaces

- **Harmonic Navigator** (Manaris, Johnson, Vassilandonakis) is the closest prior art to a camera harmony instrument: a Kinect (plus MIDI or OSC controllers) navigates chord transitions whose probabilities come from MIDI corpora (14,000+ files), a genetic algorithm with a Zipf-based fitness proposes harmonic continuations, and the player steers between predictability and surprise in real time [46] (search result; the year is inferred).
- **ChordRipple** embeds chords with word2vec ("chord2vec"); major and minor chords form circle-of-fifths shapes in the learned space, and novices given substitutions "adopted more adventurous chords" [47]. A learned embedding is therefore a usable layout, and it recovers the circle of fifths unprompted.
- **PaperTonnetz** turns gestures drawn on a printed Tonnetz into replayable chord or melody paths [48] (search result).
- **The Tonnetz at first sight**: with 88 participants, reading a Tonnetz needed music-theory skill, and its geometry may bias how non-functional sequences are understood [49] (search result). A raw Tonnetz is a poor surface to aim at for a novice.
- **The House Harmonic Filler** is a 2-D chord-progression map for novices [50] (search result). Hooktheory Trends sizes each next chord by its probability [40]. Commercial tools (ChordSeqAI, a Transformer next-chord suggester [51]; Scaler, with next-chord suggestions, a circle-of-fifths substitution view, "voice grouping" and per-chord "performances" [52]) all present the next chord relative to the current one.

### 4.2 Direction instead of position: radial menus, marking menus, dwell

- Pie menus were about 15 % faster than linear menus with fewer errors, from shorter seek time and less drift [53] (search result).
- Marking menus: Kurtenbach and Buxton tested 4, 8 and 12 items; reliable expert selection held for 4-item menus up to four levels deep and 8-item menus up to two [54] (search result). A radial "next chord" wheel with six to eight directions is inside that limit; twelve is not.
- Dwell and the Midas touch problem (Jacob), the EyeHarp's separation of aiming from triggering, and the measured precision of freehand pointing are in CL§4 and CL§5. The combination used by marking menus (aim by direction from a centre, commit by a separate act, return to the centre) is the standard answer to transit for a relative layout.

### 4.3 Audio and MIDI as navigation inputs

- **Chroma and templates.** Fujishima's pitch class profile folds the spectrum into 12 bins and matches chord templates (27 chord types; about 80 % on an excerpt, 94 % with smoothing heuristics) [55] (search result). Sheh and Ellis put the same features in an EM-trained HMM (about 75 % frame accuracy on Beatles songs) [56] (search result). Müller's textbook and open notebooks are a reference implementation of templates plus HMM smoothing [57] (search result).
- **Key finding needs seconds.** Krumhansl-Schmuckler key finding correlates a pitch-class distribution with the 24 key profiles; Temperley's revision changes the profiles and the scoring; in one comparison accuracy was under 50 % in the first 3 s and 80 to 87 % within 15 s [58] (search result). So an audio-driven key context must change slowly, and a chord follower should take the key as a setting, not infer it per chord.
- **Pitch and beat.** YIN [59] and CREPE [60] estimate a sung or played fundamental (search results); BTrack tracks beats causally [61] (search result), which is what a quantized commit needs when the clock comes from audio.
- **A product that takes harmony from an instrument.** TC-Helicon's NaturalPlay harmonizer takes "chord data from your guitar or a MIDI keyboard"; a user reports audio chord detection failing on fast changes [62] (secondary). The latency and the dwell of a chord follower are design parameters, not details.
- **MIDI.** Held notes from a MIDI keyboard are already symbolic: a chord is a set of held pitch classes, identified by a template or by tonal's `Chord.detect` (thoremin's dependency); the only design question is how long a set must be held to count (passing tones, rolled chords).

### 4.4 When a change takes effect

- **Launch quantization.** Ableton separates a per-clip quantization grid from the global one; launch modes are Trigger, Gate ("up stops the clip"), Toggle and Repeat; Legato "takes over the play position from whatever clip was played in that track before", so a switch keeps sync [63]. Its arpeggiator's "Chord Trigger" mode repeats incoming notes as a block, a figuration applied after the chord [64] (search result).
- **Chord memory as a separate stage.** Logic's Chord Trigger stores a chord per key and passes other notes through (one hand chords, the other melody) [65] (search result); Cthulhu is a chord memorizer feeding a separate arpeggiator [66] (search result).
- **Anticipations as notation.** Band-in-a-Box writes a push into the chord symbol: `^C` an eighth-note push, `^^C` a sixteenth [67]. A commit can therefore be "quantized, then anticipated by a fraction of a beat", which is a parameter of the commit policy.
- **Per-part re-voicing.** Yamaha style files declare, per accompaniment part, how it transposes onto a new chord (root-transposed or root-fixed, with a table) and per-part key ranges [68] (community source). Figuration and voicing are per part, not per instrument.

## 5. Realization

### 5.1 Representing a chord

Harte, Sandler, Abdallah and Gómez proposed a text syntax for chord labels that is easy for musicians to read and simple to parse (`C:maj`, `A:min7`, `G:7/3`) [69] (search result; the PDF was not read); it is the syntax of the Billboard annotations and of Chordonomicon [34][39]. A chord id in that syntax is a stable key for tables, captions and tests.

### 5.2 Coloration and reduction

- **Two stages beat one.** Chen, Fukayama, Goto and Su "decompose chord jazzification into coloring and voicing. Coloring concerns the choice of color tones, while voicing concerns the configurations of chords"; the two-stage model beat end-to-end generation [72]. That is the strongest evidence found for keeping coloration and voicing as separate seams.
- **Chord-scale theory** gives the rule for which colour tones are available (R§2.5) [32][33].
- **Voicing with extensions and inversions.** Kitahara et al. model voicing ("extended notes and inversions") as a Bayesian network linked to the melody and to the previous and next voicings; 94.7 % of chords and 84.1 % of changes were judged at least acceptable [73]. Rule-based jazz voicing systems (Emura et al. [74]) suffer from rules that conflict without a priority, according to [73].
- **Reduction.** Omitting the fifth first and keeping the guide tones (third and seventh) is the common jazz practice behind shell voicings; no primary source was read for it here, so the design's default order (5, then 1 when a bass has it) is a convention, marked as such.

### 5.3 Voicing and voice leading

- **Crossing-free minimal voice leading.** Tymoczko: "it is always possible to find a minimal voice leading that has no voice crossings" for a wide range of size measures including the L1 ("smoothness") norm; so between two chords of the same size it suffices to sort both and try the n rotations (with octave offsets) instead of a general assignment [70]. Voice leading between chords of different sizes (doublings, omissions) "is more difficult" [70], which is where a general matcher or a dynamic program comes in. A three- or four-voice instrument can do the rotation search every chord change for free.
- **Constraints.** Pachet and Roy's survey: each note is a variable over its voice's range; vertical rules (ranges, no crossing), horizontal rules (motion within a voice) and rules between successive chords (parallels); adding chord variables "dramatically divide[s] the theoretical complexity", and four-voice harmonization is "practically in real time"; what remains open is musical interest, not feasibility [71].
- **Layered models.** GCT labels chords idiom-independently; its harmonization work used one HMM for chords and a second for the bass line [75] (search result). A separate bass stage is a recurring design.
- **Libraries.** Tonal (already a thoremin dependency) ships voicing dictionaries and a voice-leading rule that picks the voicing whose top note moves least (read in its type declarations in the repository's `node_modules`); thoremin's own `voiceTriad` holds five fixed idioms.

### 5.4 Bass and inversion

- Inversion changes what a chord expresses: in Lahdelma and Eerola's study the major triad's valence rose from root position (3.91) to first (4.22) and second inversion (4.32) [76]. The bass is an expressive control, not only a voice-leading consequence.
- The GCT bass-line HMM [75] and Kitahara's model [73] both treat the bass as its own choice.

### 5.5 Figuration

- Arpeggiator styles in a DAW: up, down, up-down, down-up, converge, diverge, "pinky up", "thumb up", play order, random [64] (search result). Chord memory feeding an arpeggiator [66], per-chord "performances" (rhythm, arpeggio, humanize, inversion) [52], and Band-in-a-Box's shots, holds and pushes [67] are the same separation: the chord, then its rendering in time.
- The fleet's `accompy` keeps rhythmic skeletons (durations) apart from pitch patterns (offsets from the chord root) (§8), the same split as a step pattern over voice indices.

## 6. Emotion and harmony

### 6.1 Single chords and major/minor

- **Single chords.** 269 listeners, 14 chords, piano and strings, nine scales: valence highest for the major triad (4.04 of 5) and lowest for diminished (2.09) and augmented (2.11); tension highest for augmented (3.99), diminished (3.79) and the dominant seventh (3.46), lowest for major (2.61); nostalgia highest for minor, maj7 and m7; tenderness for m7 and maj7; strings raised nostalgia and sadness, piano happiness; naive and expert listeners differed little [76].
- **Harmony is under-studied.** "Research on harmony has focused on the effects of consonance and dissonance, while there is practically nothing on how different kinds of chords ... may affect expression" (Gabrielsson and Lindström, as quoted in [76]) [77].
- **Major and minor.** The association of major with positive and minor with negative valence is robust; Parncutt compares six explanations (dissonance, markedness, uncertainty, speech, salience, familiarity) and finds evidence for and against each [78]. Lowering degrees 3 and 6 shrinks melodic intervals, a sad-speech cue [79] (search result). In an ERP study, a major chord paired with a happy face or a minor chord with a sad face reduced the N2 response, so the link registers within about 200 ms, in untrained listeners too [80] (search result).
- **Cadences.** Major cadences have far higher valence than minor ones; higher average pitch raises valence and is the main driver of arousal; plagal cadences, four-note chords and a minor final chord lower valence slightly; the last chord may dominate [84] (search result).

### 6.2 Modes

Temperley and Tan had non-musicians compare the same melody in different diatonic modes on a C tonic; happiness tended to rise as scale degrees were raised, except that Lydian was less happy than Ionian; one summary orders them Ionian, Mixolydian, Lydian, Dorian, Aeolian, Phrygian, and familiarity explains much but not all of it [89] (read through secondary summaries only; the journal page was not reached). Ordering the modes by their position on the circle of fifths (Lydian brightest, Locrian darkest) is the standard "brightness" scale; the listener data agree with it except at the Lydian end.

### 6.3 Moves with conventional meanings: chromatic mediants and film music

- Murphy: two major triads a tritone apart go with outer space across many films; the move has a total voice-leading of 6 semitones and ties for last among the 24 triadic relations, which reads as "far"; the association is a learned convention with Romantic precedents [85].
- Lehman links pantriadic chromaticism (third relations, chromatic mediants) with "wonder" in film scores, analysed with neo-Riemannian theory [86] (search result). Bribitzer-Stull traces chromatic major-third collections in the nineteenth century [87] (search result).
- These are meanings of specific progression classes in a genre, learned by exposure; they are usable as named moves for an instrument ("the space move", "the wonder move") but they are not general laws.

### 6.4 Expectation, tension and pleasure

- In C-X-C sequences, "the weaker the pitch commonality values, the greater the perceived tension" and "the larger the melodic interval in each voice, the greater the perceived tension"; Lerdahl's distance and Krumhansl's hierarchy each contributed; non-musicians were more influenced by voice motion, musicians also by function and roughness [83]. This is the best empirical handle on root motion: it predicts **tension** from shared tones and voice motion.
- Changing one chord of a Bach chorale from expected to very unexpected raised tension, emotionality and skin conductance [81] (search result). Pleasure is highest for surprise in a confident context or conformity in an uncertain one [44]. Juslin and Västfjäll's mechanisms (BRECVEMA) leave mainly expectancy under harmony's control [82] (search result); Huron's ITPRA is the expectation theory [42].

### 6.5 Valence, arousal, and faces as controllers

- **Systems.** Livingstone's CMERS changes emotion at score and performance level; its mode rule converts to the parallel mode, and it beat the KTH rule system mainly on valence [90]. AffectMachine-Classical splits valence into 10 regions with a progression matrix each (lower valence, tenser chords more likely); "arousal had no influence on the chord progression selected"; arousal drives tempo (60 to 200 bpm), density and velocity; voice range rises with valence [91]. Williams et al. review affect-driven generative and transformative systems [92] (search result). The Affective Remixer re-orders pre-composed segments toward a target listener state [93] (search result), and a closed-loop EEG system let five pilot users steer generated music by self-induced emotion [94] (search result).
- **Face instruments.** Lyons's mouth controller sends mouth shape as MIDI control [95] and InterFACE's face-tracking instruments control sound expressively [96] (search results); neither maps to harmony. The Sympathetic Synthesizer maps "smile for happy music, frown for sad music", major and minor, claiming "over 100 emotions mapped" each with a chord and mode [97] (a competition entry, not peer reviewed). It was the only face-to-harmony instrument found.
- **Faces and emotion.** Russell's circumplex places affect on valence and arousal [98] (the scan was not readable; search result); Ekman's basic emotions are adaptive, brief and automatically appraised, "more of a research agenda than a theory" [99] (search result); FACS action units describe muscle movement "without assigning any emotional meaning" [100] (secondary). MediaPipe's Face Landmarker gives 52 blendshape scores and 478 landmarks, and its left and right blendshapes refer to the subject's face, so a mirrored image swaps them [101]. A face-to-valence/arousal mapping is therefore a model thoremin supplies (it has one: the general expression model and the player's own categorizers), not something the tracker provides.

### 6.6 The video's emotion labels

No published source was found that assigns emotions to diatonic root movements by interval class (the cycles of fourths, thirds and seconds), and no experiment was found that manipulates root interval as such and measures emotion. The closest evidence predicts **tension** from shared tones and voice motion [83], valence from mode and the last chord [84][76], and meanings for specific chromatic progressions as learned genre conventions [85][86]. One reading consistent with that evidence: the video's thirds (two common tones) should sound least tense and its seconds (no common tone, every voice moving) most, and moves that end on a minor or diminished chord should read as less positive. That is a prediction, not a test of the labels; the labels remain the creator's.

## 7. What this means for the design (summary)

1. Relations are data: diatonic steps, P/L/R and every uniform triadic transformation, functional moves; a space is a graph generated from them (§2).
2. Adjacency (what a layout shows) and distance (how far apart chords sound) are different and should be different objects (§2.3, §3).
3. Edge weights are style-specific and licence-bound; a theory-derived prior (Meeus's dominant/subdominant classes) needs no data (§2.1, §2.6).
4. Two tension models are cheap enough for the browser: Lerdahl's integer distance and the spiral array's three distances (§3).
5. Relative layouts (recentred, radial) need directional navigation with a separate commit, within marking-menu limits of about eight directions (§4.1, §4.2).
6. Audio-driven harmony needs dwell and a slow key; MIDI needs only a hold time (§4.3).
7. Commit timing has standard forms: quantized per instrument or globally, legato, anticipated by a fraction of a beat (§4.4).
8. Coloration and voicing are separate stages; minimal voice leading between equal-size chords is a rotation search; the bass is its own choice and an expressive one (§5).
9. For the face: valence maps to mode and chord quality (well supported); arousal maps to tempo, density, register and loudness, not to chord choice (§6.5); specific chromatic moves carry learned genre meanings that can be offered as named moves (§6.3); the video's per-move labels are unsupported (§6.6).

## 8. What the fleet already has (search record)

Searched with `ir search packages` and `ir discover packages` for chord relationships, tonnetz, voice leading, chord progression graph, harmony, pitch class set, music theory, chord voicing, midi and arpeggio, then by reading the candidates. No fleet package implements a Tonnetz, neo-Riemannian moves or minimal voice leading; no skill covers harmony.

- `thorwhalen/atonal` (Python): pitch-class sets as 12-bit integers, transposition, inversion, prime forms, interval vectors, Forte names; relation graphs between sets as edge tables (subset, complement, transposition and inversion classes, Z-relation, sets sharing n-1 notes) with a pluggable link predicate (`compute_links(table, kind=...)`, a string or a callable); a voicing generator by interval stacks and a chord graph builder. Its `voice_leading_distance` matches sorted voices and says it is not Tymoczko's metric, so it is not to be ported; the bitmask set operations and the pluggable-relation idea are.
- `accompy` (Python, behind the chord_renderer app): chord-chart, Roman and Nashville parsers; rhythmic skeletons kept apart from root-offset pitch patterns; a `ChordResolver` protocol.
- `tetrachord` (TS): triad inversion and open/close spacing (`voicingOffsets`); a research note concluding that tonal is the one maintained TS theory library with thin voice-leading layers, and that Web MIDI is absent in Safari.
- `songleaf` (Python): key estimation from chord symbols and a chord's function in a key.
- The Python `tonal` package: chord and scale tables and a chord renderer registry; superseded in the browser by tonal.js.
- thoremin itself: `theory.ts`, `voicing.ts`, `chord_render.ts`, the chord map's layouts, the expression confusion optimizer; tonal 6.4 (with `chord-detect`, `voicing`, `voice-leading`, `voicing-dictionary`) and `webmidi` are already dependencies.

## REFERENCES

1. Pur Pasteur. All Diatonic Chords and their Emotional Signatures Controlled by Hand Movement (no theory required) [video]. YouTube. [youtu.be/95u70uQfofQ](https://youtu.be/95u70uQfofQ)
2. Pur Pasteur. Control Harmony With Your Bare Hands?? [YouTube Short]. [youtube.com/shorts/4avKOWkj34Y](https://www.youtube.com/shorts/4avKOWkj34Y)
3. Meeus N. Toward a post-Schoenbergian grammar of tonal and pre-tonal harmonic progressions. Music Theory Online. 2000;6(1). [mtosmt.org](https://www.mtosmt.org/issues/mto.00.6.1/mto.00.6.1.meeus.html)
4. Wikipedia. Function (music) (secondary; for Riemann H, Vereinfachte Harmonielehre, 1893). [Function (music)](https://en.wikipedia.org/wiki/Function_(music))
5. Rohrmeier M. Towards a generative syntax of tonal harmony. Journal of Mathematics and Music. 2011;5(1):35-53 (search result only). [musica.ed.ac.uk](https://www.musica.ed.ac.uk/?p=212)
6. Cohn R. Introduction to neo-Riemannian theory: a survey and a historical perspective. Journal of Music Theory. 1998;42(2):167-180 (search result only). [PDF](https://music.arts.uci.edu/abauer/3.1/notes/Cohn_Intro_nRT.pdf)
7. Cohn R. Maximally smooth cycles, hexatonic systems, and the analysis of late-Romantic triadic progressions. Music Analysis. 1996;15(1):9-40 (search result only). [PDF](https://music.arts.uci.edu/abauer/4.3/readings/Cohn_Hex_System.pdf)
8. Crans AS, Fiore TM, Satyendra R. Musical actions of dihedral groups. American Mathematical Monthly. 2009;116(6):479-495. [arXiv 0711.1873](https://arxiv.org/pdf/0711.1873)
9. Wikipedia. Neo-Riemannian theory (secondary). [Neo-Riemannian theory](https://en.wikipedia.org/wiki/Neo-Riemannian_theory)
10. Douthett J, Steinbach P. Parsimonious graphs: a study in parsimony, contextual transformations, and modes of limited transposition. Journal of Music Theory. 1998;42(2):241-263 (search result only). [sonicfield.org](https://labs.sonicfield.org/library/parsimonious-graphs-a-study-in-parsimony-contextual-transformations-and-modes-of-Douthett-1998)
11. Visconti C. Neo-Riemannian graphs beyond triads and seventh chords. MusMat. 2021;5(1):39-79. [PDF](https://musmat.org/wp-content/uploads/2021/06/06-V5n1-Visconti.pdf)
12. Cohn R. Audacious Euphony: Chromatic Harmony and the Triad's Second Nature. Oxford University Press; 2012 (search result only). [academic.oup.com](https://academic.oup.com/book/12064)
13. Hook J. Uniform triadic transformations. Journal of Music Theory. 2002;46(1-2):57-126 (dissertation abstract read). [mtosmt.org](https://www.mtosmt.org/classic/mto.02.8.3/dis.8.3.html)
14. Lewin D. Generalized Musical Intervals and Transformations. Yale University Press; 1987, reissued Oxford University Press; 2007 (search result only). [academic.oup.com](https://academic.oup.com/book/4583)
15. Tymoczko D. The geometry of musical chords. Science. 2006;313(5783):72-74 (search result and press release only). [collaborate.princeton.edu](https://collaborate.princeton.edu/en/publications/the-geometry-of-musical-chords/)
16. Callender C, Quinn I, Tymoczko D. Generalized voice-leading spaces. Science. 2008;320(5874):346-348 (search result only). [collaborate.princeton.edu](https://collaborate.princeton.edu/en/publications/generalized-voice-leading-spaces/)
17. Tymoczko D. A Geometry of Music: Harmony and Counterpoint in the Extended Common Practice. Oxford University Press; 2011 (search result only). [brahms.ircam.fr](https://brahms.ircam.fr/en/flora/a-geometry-of-music-48122)
18. Tymoczko D. Geometrical methods in recent music theory. Music Theory Online. 2010;16(1). [mtosmt.org](https://mtosmt.org/issues/mto.10.16.1/mto.10.16.1.tymoczko.html)
19. Tymoczko D. Scale theory, serial theory and voice leading. Music Analysis. 2008;27(1):1-49 (search result only). [collaborate.princeton.edu](https://collaborate.princeton.edu/en/publications/scale-theory-serial-theory-and-voice-leading/)
20. Lerdahl F. Tonal Pitch Space. Oxford University Press; 2001 (search result only; not read). [academic.oup.com](https://academic.oup.com/book/32497)
21. Lerdahl F, Krumhansl CL. Modeling tonal tension. Music Perception. 2007;24(4):329-366. [PDF](https://www.fredlerdahl.com/s/Modeling-Tonal-Tension.pdf)
22. de Haas WB, Wiering F, Veltkamp RC. A geometrical distance measure for determining the similarity of musical harmony. Technical report UU-CS-2011-015, Utrecht University; 2011. [PDF](https://ics-archive.science.uu.nl/research/techreps/repo/CS-2011/2011-015.pdf)
23. Chew E. Towards a mathematical model of tonality. PhD thesis, MIT; 2000 (search result only). [dspace.mit.edu](https://dspace.mit.edu/handle/1721.1/9139)
24. Chew E. Mathematical and Computational Modeling of Tonality: Theory and Applications. Springer; 2014 (search result only). [springer.com](https://www.springer.com/gp/book/9781461494744)
25. Wikipedia. Spiral array model (secondary). [Spiral array model](https://en.wikipedia.org/wiki/Spiral_array_model)
26. Herremans D, Chew E. Tension ribbons: quantifying and visualising tonal tension. Proc. TENOR 2016; vol 2:8-18 (fetch refused; definitions read in [27]). [PDF](https://www.dorienherremans.com/sites/default/files/paper_tenor_dh_preprint_small.pdf)
27. partitura. Tonal tension (reference implementation of [26]). [partitura.readthedocs.io](https://partitura.readthedocs.io/en/latest/_modules/partitura/musicanalysis/tonal_tension.html)
28. Farbood MM. A parametric, temporal model of musical tension. Music Perception. 2012;29(4):387-428 (search result only). [PDF](https://bpb-us-e1.wpmucdn.com/wp.nyu.edu/dist/f/11865/files/2020/08/Farbood_2012_Musical_Tension.pdf)
29. Krumhansl CL. Cognitive Foundations of Musical Pitch. Oxford University Press; 1990 (search result only). [academic.oup.com](https://academic.oup.com/book/40395)
30. Krumhansl CL, Kessler EJ. Tracing the dynamic changes in perceived tonal organization in a spatial representation of musical keys. Psychological Review. 1982;89(4):334-368 (search result only). [wikidp.org](https://wikidp.org/Q30463791)
31. Bharucha J, Krumhansl CL. The representation of harmonic structure in music: hierarchies of stability as a function of context. Cognition. 1983;13(1):63-102 (search result only). [philpapers.org](https://philpapers.org/rec/BHATRO)
32. Wikipedia. Lydian Chromatic Concept of Tonal Organization (secondary; for Russell G, 1953, 4th ed. 2001). [Wikipedia](https://en.wikipedia.org/wiki/Lydian_Chromatic_Concept_of_Tonal_Organization)
33. Nettles B, Graf R. The Chord Scale Theory and Jazz Harmony. Advance Music; 1997 (search result only; tables not checked). [forsyths.co.uk](https://www.forsyths.co.uk/music/300656-graf-nettles-the-chord-scale-theory-jazz-harmony-9790206302992.html)
34. Burgoyne JA, Wild J, Fujinaga I. An expert ground truth set for audio chord recognition and music analysis. Proc. ISMIR 2011:633-638 (search result only). [PDF](https://ismir2011.ismir.net/papers/OS8-1.pdf)
35. de Clercq T, Temperley D. A corpus analysis of rock harmony. Popular Music. 2011;30(1):47-70. [PDF](https://rockcorpus.midside.com/2011_paper/declercq_temperley_2011.pdf)
36. Neuwirth M, Harasim D, Moss FC, Rohrmeier M. The Annotated Beethoven Corpus (ABC). Frontiers in Digital Humanities. 2018;5:16. [frontiersin.org](https://www.frontiersin.org/articles/10.3389/fdigh.2018.00016/full)
37. Moss FC, Neuwirth M, Harasim D, Rohrmeier M. Statistical characteristics of tonal harmony: a corpus study of Beethoven's string quartets. PLoS ONE. 2019;14(6):e0217242. [journals.plos.org](https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0217242&type=printable)
38. Gotham M, Micchi G, Nápoles López N, Sailor M. When in Rome: a meta-corpus of functional harmony. Transactions of ISMIR. 2023;6(1):150-166 (search result only). [transactions.ismir.net](https://transactions.ismir.net/articles/165)
39. Kantarelis S, Thomas K, Lyberatos V, Dervakos E, Stamou G. CHORDONOMICON: a dataset of 666,000 songs and their chord progressions. arXiv 2410.22046; 2024. [arXiv](https://arxiv.org/html/2410.22046v3)
40. Hooktheory. Trends tool, Trends API, and chord progression search blog. [hooktheory.com/blog/trends-tool](https://www.hooktheory.com/blog/trends-tool/), [API docs](https://hooktheory.com/api/trends/docs)
41. Choi K, Fazekas G, Sandler M. Text-based LSTM networks for automatic music composition. arXiv 1604.05358; 2016 (search result only). [arXiv](https://arxiv.org/pdf/1604.05358)
42. Huron D. Sweet Anticipation: Music and the Psychology of Expectation. MIT Press; 2006 (search result only). [leonardo.info review](https://leonardo.info/reviews_archive/july2007/sweet_zilberg.html)
43. Pearce MT. Statistical learning and probabilistic prediction in music cognition: mechanisms of stylistic enculturation. Annals of the New York Academy of Sciences. 2018;1423(1):378-395 (search result only). [PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6849749/)
44. Cheung VKM, Harrison PMC, Meyer L, Pearce MT, Haynes JD, Koelsch S. Uncertainty and surprise jointly predict musical pleasure and amygdala, hippocampus, and auditory cortex activity. Current Biology. 2019;29(23):4084-4092. [cms.mus.cam.ac.uk](https://cms.mus.cam.ac.uk/publications/cheung-uncertainty-surprise/)
45. Harrison PMC, Pearce MT. Dissociating sensory and cognitive theories of harmony perception through computational modeling. ICMPC15/ESCOM10; 2018 (search result only). [cms.mus.cam.ac.uk](https://cms.mus.cam.ac.uk/publications/harrison-dissociating-sensory-cognitive-harmony/)
46. Manaris B, Johnson D, Vassilandonakis Y. Harmonic Navigator: a gesture-driven, corpus-based approach to music analysis, composition, and performance. Proc. AIIDE (AAAI); 2013 (search result only; year inferred). [ojs.aaai.org](https://ojs.aaai.org/index.php/AIIDE/article/view/12658)
47. Huang CZA, Duvenaud D, Gajos KZ. ChordRipple: recommending chords to help novice composers go beyond the ordinary. Proc. IUI 2016:241-250. [eecs.harvard.edu](https://www.eecs.harvard.edu/~kgajos/papers/2016/huang16chordripple.shtml)
48. Bigo L, Garcia J, Spicher A, Mackay WE. PaperTonnetz: music composition with interactive paper. Proc. SMC 2012 (search result only). [hal.archives-ouvertes.fr](https://hal.archives-ouvertes.fr/hal-00718334)
49. Besada JL, Bisesi E, Guichaoua C, Andreatta M. The Tonnetz at first sight: cognitive issues of human-computer interaction with pitch spaces. Music & Science. 2024;7 (search result only). [doaj.org](https://doaj.org/article/c53e0f516723435fb0fe8df2e5411ab5)
50. Faraldo Á, Jordà S, Herrera P. The House Harmonic Filler: interactive exploration of chord sequences by means of an intuitive representation. Proc. TENOR 2017:137-143 (search result only). [repositori.upf.edu](https://repositori.upf.edu/handle/10230/41698)
51. Ivan P. ChordSeqAI (repository; search result only). [github.com/PetrIvan/chord-seq-ai-app](https://github.com/PetrIvan/chord-seq-ai-app)
52. Plugin Boutique. Scaler 3 and Scaler 2 (vendor and catalogue listings; secondary). [pluginboutique.com](https://www.pluginboutique.com/products/14563-Scaler-3), [kvraudio.com](https://www.kvraudio.com/product/scaler-2-by-plugin-boutique)
53. Callahan J, Hopkins D, Weiser M, Shneiderman B. An empirical comparison of pie vs. linear menus. Proc. CHI 1988:95-100 (search result only). [umiacs.umd.edu](https://sites.umiacs.umd.edu/node/16962)
54. Kurtenbach G, Buxton W. The limits of expert performance using hierarchic marking menus. Proc. INTERCHI 1993:482-487 (search result only). [billbuxton.com](https://www.billbuxton.com/MMExpert.html)
55. Fujishima T. Realtime chord recognition of musical sound: a system using Common Lisp Music. Proc. ICMC 1999:464-467 (search result only). [ccrma.stanford.edu](https://ccrma.stanford.edu/~jos/mus423h/Real_Time_Chord_Recognition_Musical.html)
56. Sheh A, Ellis DPW. Chord segmentation and recognition using EM-trained hidden Markov models. Proc. ISMIR 2003 (search result only). [ir.webis.de](https://ir.webis.de/anthology/2003.ismir_conference-2003.18)
57. Müller M. Fundamentals of Music Processing, chapter 5: chord recognition (notebooks). Springer; 2015 (search result only). [audiolabs-erlangen.de](https://www.audiolabs-erlangen.de/resources/MIR/FMP/C5/C5.html)
58. Temperley D. What's key for key? The Krumhansl-Schmuckler key-finding algorithm reconsidered. Music Perception. 1999;17(1):65-100 (search result only; via an implementation). [partitura](https://partitura.readthedocs.io/en/latest/_modules/partitura/musicanalysis/key_identification.html)
59. de Cheveigné A, Kawahara H. YIN, a fundamental frequency estimator for speech and music. Journal of the Acoustical Society of America. 2002;111(4):1917-1930 (search result only). [PDF](https://cagnazzo.wp.imt.fr/files/2013/05/2002_JASA_YIN.pdf)
60. Kim JW, Salamon J, Li P, Bello JP. CREPE: a convolutional representation for pitch estimation. Proc. ICASSP 2018 (search result only). [arXiv 1802.06182](https://arxiv.org/abs/1802.06182)
61. Stark AM, Davies MEP, Plumbley MD. Real-time beat-synchronous analysis of musical audio. Proc. DAFx 2009 (search result only). [dafx.de](https://dafx.de/paper-archive/details/XiEJjIc0a2Hb_KTJon0SaA)
62. Sound On Sound. TC-Helicon VoiceLive Touch review (secondary; search result only). [soundonsound.com](https://www.soundonsound.com/reviews/tc-helicon-voicelive-touch)
63. Ableton. Live manual: Launching clips. [ableton.com](https://www.ableton.com/en/manual/launching-clips/)
64. Ableton. Live 12 manual: MIDI effect reference, Arpeggiator (search result only). [ableton.com](https://www.ableton.com/en/live-manual/12/live-midi-effect-reference/)
65. Apple. Logic Pro for iPad user guide: Chord Trigger MIDI plug-in (search result only). [support.apple.com](https://support.apple.com/guide/logicpro-ipad/lpipdcde4fee/ipados)
66. Xfer Records. Cthulhu (product page; search result only). [xferrecords.com](https://www.xferrecords.com/products/cthulhu)
67. PG Music. Band-in-a-Box manual, chapter 7. [pgmusic.com](https://www.pgmusic.com/manuals/bbw2023full/chapter7.htm)
68. PSR Tutorial forum. Yamaha SFF2 and CASM threads (community source; search result only). [psrtutorial.com](https://www.psrtutorial.com/forum/index.php/topic,59034.msg456975.html)
69. Harte C, Sandler M, Abdallah S, Gómez E. Symbolic representation of musical chords: a proposed syntax for text annotations. Proc. ISMIR 2005:66-71 (search result only). [zenodo.org](https://zenodo.org/record/1415114)
70. Tymoczko D. Voice leadings as generalized key signatures. Music Theory Online. 2005;11(4). [PDF](https://mtosmt.org/classic/mto.05.11.4/mto.05.11.4.tymoczko.pdf)
71. Pachet F, Roy P. Musical harmonization with constraints: a survey. Constraints. 2001;6(1):7-19. [PDF](https://www.francoispachet.fr/wp-content/uploads/2021/01/pachet-01-Musical_Harmonization_with_Constraints.pdf)
72. Chen T-P, Fukayama S, Goto M, Su L. Chord jazzification: learning jazz interpretations of chord symbols. Proc. ISMIR 2020. [PDF](https://program.ismir2020.net/static/final_papers/90.pdf)
73. Kitahara T, Katsura M, Katayose H, Nagata N. Computational model for automatic chord voicing based on Bayesian network. Proc. ICMPC10; 2008. [PDF](https://ist.ksc.kwansei.ac.jp/~nagata/data/2008_kitahara_ICMPC2008.pdf)
74. Emura N, Miura M, Yanagida M. A modular system generating jazz-style arrangement for a given set of a melody and its chord name sequence. Acoustical Science and Technology. 2008;29(1):51-57 (cited via [73]; not opened).
75. Kaliakatsos-Papakostas MA, Zacharakis AI, Tsougras C, Cambouropoulos E. Evaluating the General Chord Type representation in tonal music and organising GCT chord labels in functional chord categories. Proc. ISMIR 2015:427-433 (search result only). [ir.webis.de](https://ir.webis.de/anthology/2015.ismir_conference-2015.59)
76. Lahdelma I, Eerola T. Single chords convey distinct emotional qualities to both naïve and expert listeners. Psychology of Music. 2016;44(1):37-54. [jyx.jyu.fi](https://jyx.jyu.fi/handle/123456789/48313)
77. Gabrielsson A, Lindström E. The role of structure in the musical expression of emotions. In: Juslin PN, Sloboda JA, eds. Handbook of Music and Emotion. Oxford University Press; 2010 (quoted via [76]; not opened).
78. Parncutt R. The emotional connotations of major versus minor tonality: one or more origins? Musicae Scientiae. 2014;18(3):324-353. [PDF](https://static.uni-graz.at/fileadmin/_Persoenliche_Webseite/parncutt_richard/Pdfs/Parncutt2014EmotionalConnotations.pdf)
79. Huron D, Davis M. The harmonic minor scale provides an optimum way of reducing average melodic interval size, consistent with sad affect cues. Empirical Musicology Review. 2012;7(3-4):103-117 (search result only). [ojs.library.osu.edu](https://ojs.library.osu.edu/index.php/EMR/article/view/3732)
80. Bakker DR, Martin FH. Musical chords and emotion: major and minor triads are processed for emotion. Cognitive, Affective, & Behavioral Neuroscience. 2015;15:15-31 (search result only). [link.springer.com](https://link.springer.com/10.3758/s13415-014-0309-4)
81. Steinbeis N, Koelsch S, Sloboda JA. The role of harmonic expectancy violations in musical emotions: evidence from subjective, physiological, and neural responses. Journal of Cognitive Neuroscience. 2006 (search result only; volume and pages not verified). [PDF](https://stefan-koelsch.de/papers/Steinbeis%2BJOCN2006_inpress.pdf)
82. Juslin PN, Västfjäll D. Emotional responses to music: the need to consider underlying mechanisms. Behavioral and Brain Sciences. 2008;31(5):559-575 (search result only). [pubmed](https://pubmed.ncbi.nlm.nih.gov/18826699/)
83. Bigand E, Parncutt R, Lerdahl F. Perception of musical tension in short chord sequences: the influence of harmonic function, sensory dissonance, horizontal motion, and musical training. Perception & Psychophysics. 1996;58(1):125-141. [PDF](https://lead.ube.fr/wp-content/uploads/2023/09/000093-perception-of-musical-tension-in-short-chord-sequences-the-influence-of-harmonic-function-sensory-dissonance-horizontal-motion-and-musical-training.pdf)
84. Smit EA, Dobrowohl FA, Schaal NK, Milne AJ, Herff SA. Perceived emotions of harmonic cadences. Music & Science. 2020;3 (search result only). [journals.sagepub.com](https://journals.sagepub.com/doi/10.1177/2059204320938635)
85. Murphy S. The major tritone progression in recent Hollywood science fiction films. Music Theory Online. 2006;12(2). [mtosmt.org](https://mtosmt.org/issues/mto.06.12.2/mto.06.12.2.murphy.html)
86. Lehman F. Hollywood Harmony: Musical Wonder and the Sound of Cinema. Oxford University Press; 2018 (search result only). [academic.oup.com](https://academic.oup.com/book/3654)
87. Bribitzer-Stull M. The Ab-C-E complex: the origin and function of chromatic major third collections in nineteenth-century music. Music Theory Spectrum. 2006;28(2):167-190 (search result only). [academic.oup.com](https://academic.oup.com/mts/issue/28/2)
88. Wikipedia. Theory of musical equilibration (secondary; outside the mainstream; not used for any design decision). [Wikipedia](https://en.wikipedia.org/wiki/Theory_of_musical_equilibration)
89. Temperley D, Tan D. Emotional connotations of diatonic modes. Music Perception. 2013;30(3):237-257 (read through secondary summaries only). [sonicfield.org summary](https://labs.sonicfield.org/library/emotional-connotations-of-diatonic-modes)
90. Livingstone SR, Muhlberger R, Brown AR, Thompson WF. Changing musical emotion: a computational rule system for modifying score and performance. Computer Music Journal. 2010;34(1):41-64. [research.bond.edu.au](https://research.bond.edu.au/en/publications/changing-musical-emotion-a-computational-rule-system-for-modifyin/)
91. Agres KR, Dash A, Chua P. AffectMachine-Classical: a novel system for generating affective classical music. Frontiers in Psychology. 2023;14:1158172. [frontiersin.org](https://frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1158172/full)
92. Williams D, Kirke A, Miranda ER, Roesch E, Daly I, Nasuto S. Investigating affect in algorithmic composition systems. Psychology of Music. 2015;43(6):831-854 (search result only). [researchportal.plymouth.ac.uk](https://researchportal.plymouth.ac.uk/en/publications/investigating-affect-in-algorithmic-composition-systems/)
93. Chung J-W, Vercoe GS. The affective remixer: personalized music arranging. CHI 2006 Extended Abstracts (search result only). [PDF](https://www.media.mit.edu/speech/papers/2006/AffectRemix-FINAL.pdf)
94. Ehrlich SK, Agres KR, Guan C, Cheng G. A closed-loop, music-based brain-computer interface for emotion mediation. PLoS ONE. 2019;14(3):e0213516 (search result only). [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC6422328)
95. Lyons MJ, Haehnel M, Tetsutani N. Designing, playing, and performing with a vision-based mouth interface. Proc. NIME 2003:116-121 (search result only). [nime.org](https://nime.org/proc/nime2003_lyons/)
96. Chandran D, Wang G. InterFACE: new faces for musical expression. Proc. NIME 2018 (search result only). [nime.org](https://nime.org/proc/nime2018_chandran/)
97. Olenski Z. Sympathetic Synthesizer (MIDI Association Innovation Award entry; not peer reviewed). [midi.org](https://midi.org/innovation-award/sympathetic-synthesizer)
98. Russell JA. A circumplex model of affect. Journal of Personality and Social Psychology. 1980;39(6):1161-1178 (search result only). [PDF](https://pdodds.w3.uvm.edu/research/papers/others/1980/russell1980a.pdf)
99. Ekman P. An argument for basic emotions. Cognition and Emotion. 1992;6(3-4):169-200 (search result only). [PDF](https://sanlab.psych.ucla.edu/wp-content/uploads/sites/31/2016/03/Ekman-1992-An-argument-for-basic-emotions.pdf)
100. Noldus. Facial Action Coding System (secondary, for Ekman P, Friesen WV, 1978; revised 2002). [noldus.com](https://noldus.com/facereader/facs)
101. Google. MediaPipe Face Landmarker guide. [developers.google.com](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker)
