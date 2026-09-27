# Fingering-chart priors and scripted sequence training for the air winds

Issue #263. This note is the design record for three things that landed together: the fingering charts as data (`src/music/fingerings.ts`), the fingering prior over the enrolled vocabulary (`src/air/fingering_prior.ts`), and the scripted sequence runner (`src/enroll/sequence.ts`). It says what the charts can and cannot tell a webcam, how a chart becomes a Bayesian prior that the player's own enrolment tunes, and why a training sequence is a sibling of the trainer's routines rather than a routine. The UI (the guide, the sequence trainer in the instrument's settings, the link from each instrument's panel) is the next PR on the same issue.

## 0. The short version

- The air flute's enrolment works but is slow: one note at a time, typed, held. The maintainer asked for a scripted sequence (the next target visible, a countdown per target, a lead-in), a guide showing how to finger each note, and a prior so the instrument already knows roughly what each note looks like and training only tunes it, catching a wrong note on the way.
- A **fingering chart** is a table of which fingers are down per note. Seven are encoded (Boehm flute, baroque and German soprano recorder, Bb clarinet, alto saxophone, oboe, D whistle) against the sources in the references, in one notation (`T123|12-4`), with named auxiliary keys and the flute's common alternates.
- To a camera a chart says one thing per finger: down or up. On an air instrument that is a curled or a straight finger (the air flute reads *large lifts*, because a real key press is under the tracker's noise [1]). So the prior is an expected value per finger on the finger's **flexion** features (its curl, and the joint angles the curl is the sum of) and nothing else.
- The prior is **conjugate**: each class centroid is a Gaussian mean with a prior at the chart's expectation worth `strength` pseudo-samples (10 by default), so with no enrolment the chart plays alone and after one two-second hold the player's own shape outvotes it four to one. The anchors (how curled is "down", how straight is "up") are read from whatever is enrolled, thumbs apart, so one enrolled note calibrates the chart for every other note.
- Every class is scored on the **same features**, the flexion features the anchors cover. Scoring an enrolled class on the whole hand vector and a chart-only class on the curls is not one distance, and the review of the first version measured the consequence: at twice the test jitter an enrolled G read as A, F or G# in 29 frames of 30.
- What the hand cannot see is handled honestly: notes that share fingers on different keys are one class (the flute's low C, C# and Eb; Bb with the thumb key and B), separated by an alternate fingering where one exists (the "one and one" Bb), and the guide draws the fingering the prior listens for. Octaves are one shape; the class is named by the note in the preferred octave.
- A **sequence** is a list of targets with a lead-in, a per-target countdown, a settle and a hold, run on a caller-driven clock like the cue runner, with an injected check per hold. It is not a cue: a cue never names what to produce, a sequence is nothing but targets.
- Verified on a synthetic flautist: the chart alone names every playable note of a player who lifts and curls as the defaults expect; two enrolled notes recalibrate the anchors for a player who curls less and the unseen notes read at least as well as before; an enrolled G keeps winning against its chart-only neighbours when the hand is noisier or drifts; a G held when A was asked is reported as a mismatch.

## 1. What was asked, in the maintainer's words

"I do like that mode where I have to specify a tag (example, a note), and then show it, but it's pretty inefficient that way. I think being able to do things in a sequence would be easier. [...] I see at least what the next note is going to be, I see how many seconds I have left on one note, and possibly a short lead up to the next one. [...] In a particular case of the flute, it would even be nice if I could have an image that would show me how to actually play that note. [...] Even better would be to be able to have a prior already on it. Something that would allow you to already detect if I am seriously doing the wrong thing, the wrong note. Something that could act a bit like a Bayesian prior as well, so that sometimes training is not even needed, and my training were just tuned to my particular case. [...] As far as I know, it's pretty much the same ones for other wind instruments, like saxophones, or oboes, etc."

Four requirements, then: a sequence with the next target, a countdown and a lead-in; a guide per note; a prior from published charts; the prior tuned, not replaced, by enrolment, and used to catch a wrong note. And a claim to verify: that the fingerings are shared across the winds.

## 2. Where this sits in the trainer

The trainer (#160, #163, `docs/research/trainer-mode.md`) learns a player's own categories from a guided take: cues ask for movements or leave the choice to the player, still-points are clustered, and the categories are carved afterwards. Its load-bearing rule is that a cue never shows a target to imitate, because for faces a prescribed expression is the failure mode the whole feature exists to escape [2].

The air instruments are the opposite case. Their vocabularies (`src/air/vocabulary.ts`, #249) are supervised: the player names each shape ("D5", "G chord") and holds it, and the classifier is one category per name, closed-set, in the player's own hold jitter. The research behind that choice is the guitar result: a shared model scored 24% across players and two seconds of a player's own hand per chord 90 to 98% [1]. The label is known before the take, and the target is the point.

So a scripted sequence is a sibling of a routine, sharing the runner's conventions (a caller-driven clock, `say` strings drawn from a finite set, events), and none of the cue machinery. It produces vocabulary entries (label, samples), which is exactly what the enrolment UI's Learn button produces today, and it consumes the same live shape tap. Nothing in the trainer core changed.

## 3. The charts

### 3.1 What is encoded

Seven charts, in `src/music/fingerings.ts`. Each row is a note (scientific pitch, `parseNoteName`'s spelling), the fingers that are down, the named keys those fingers work, and common alternates. The finger names are `LT`, `L1..L4`, `R1..R4`; the right thumb is not a finger here, because on every instrument in the file it holds the instrument and presses nothing.

| chart | range | rows | distinct shapes | sources |
|---|---|---|---|---|
| Boehm flute, C foot | C4 to C7 | 37 | 24 | [3], [4], [5], [6] |
| soprano recorder, baroque | C5 to B6 | 22 | 11 | [7], [8], [9] |
| soprano recorder, German | C5 to B6 | 22 | 11 | [8], [9], [10] |
| Bb clarinet, Boehm (written) | E3 to C6 | 33 | 9 | [11], [12], [13] |
| alto saxophone (written) | Bb3 to F6 | 32 | 25 | [14], [15] |
| oboe, conservatoire | Bb3 to C6 | 27 | 15 | [16], [17] |
| tin whistle in D | D5 to C#7 | 14 | 7 | [18] |

The "distinct shapes" column is the number of finger patterns a hand could tell apart, and it is the number that matters for a prior: the clarinet's 33 notes are 9 shapes, because the throat tones are the open tube with a side key and the clarion is the chalumeau's fingers with the register key, both invisible to a camera.

The flute's first two octaves are the ones a flautist would check line by line, and they were checked against three charts [3], [4], [5]; the third octave is less standardised (charts show two to four alternates per note, using auxiliary keys as vents [3]) and is encoded as the commonly taught set, with the prior's default range stopping below it. The recorders leave out C6 and C#6, on which charts disagree. The oboe's octave keys and half-hole, the sax's palm keys and pinky table, and the clarinet's side keys are carried as named keys, not fingers.

The independent review of the first version corrected three tables against the Woodwind Fingering Guide, which is a measure of how far a chart written from memory can be trusted: the sax's low Bb and B are left little-finger keys (with the right little finger on low C), the oboe's right hand was shifted by one finger from C4 to F#4 (its F is `R1` with the F key, or the fork `R1 R3`), and the baroque recorder's F is the fork `R1 R3 R4` with F# on `R2 R3`, Eb and G# half-holing `R3`, the systems differing at G# as well as F and F#, and a second octave that is not simply the first pinched: D and Eb open the thumb, and F, F#, G#, Bb and B are forks of their own. A second pass corrected the oboe's Eb5 (half-hole, no octave key), E5 (no half-hole) and F (`R1 R2` with the F key). The clarinet, whistle and the flute's first two octaves stood. What the tests can hold a chart to is its internal structure (the octave repeats, the twelfth, the two recorder systems differing only at F and F#, the shared six-finger scale); a wrong row that keeps the structure is caught only by a reader.

### 3.2 Is the claim true, that winds share fingerings?

Largely, for the six-finger main line, and not at all for the register mechanism. Lifting `R3, R2, R1, L3, L2, L1` in turn from a fully closed low D gives the D major scale on flute, oboe, sax, recorder and whistle alike: the penny-whistle scale is the flute's scale, and `test/air/fingerings.test.ts` checks the sax and the whistle degree for degree. It breaks at F and its forks (the flute's F is long, `R1` only; the oboe's and the baroque recorder's are forked; the German recorder was invented to remove that fork [10]), at F# (the flute's `R3` against the sax's `R2`, which is also the flute's own alternate), and above all at the clarinet, whose cylindrical bore overblows at the twelfth, so its second register is never "the same fingers, more air" [19], [20]. The auxiliary mechanisms (the sax's four-key pinky table, the oboe's two octave keys and half-hole, the clarinet's register key and side keys, the flute's foot joint) are instrument-specific and do not transfer.

For the prior this says: one shared hand-shape feature (which of the six main fingers is down) is a strong, transferable predictor of scale degree across these instruments; the register and auxiliary state is per instrument and must not be folded into the same prior. That is why the charts carry keys as names and the prior reads only the fingers.

### 3.3 Machine-readable sources

There is no open dataset mapping note to keys-down for woodwinds. LilyPond's `\woodwind-diagram` markup ships a per-instrument key vocabulary (`scm/define-woodwind-diagrams.scm`, introspectable with `print-keys-verbose`) with open, covered, ring, partial and trill states per key, but it is a diagram format, not a chart: a score supplies the fingering per note [6]. The Woodwind Fingering Guide is the most complete note-indexed source, as HTML and images with a regular URL scheme [3], [7], [11], [14], [16], [18]. MusicXML's `<fingering>` is a single label per note, not a key state [21]. So the charts here are hand-encoded, and the tests hold them to the facts a player would check (the second octave repeats the first from E; D and D# lift the left index; the clarion is the chalumeau a twelfth below plus the register key; the two recorder systems differ only at F and F#).

## 4. From a chart to a hand vector

### 4.1 What a chart can say about the vector

The air flute's live vector is both hands' chord-shape vectors, forty features per hand, prefixed by the player's hand (`fingeringVector`): per-finger joint angles and curls, adjacent spreads, thumb opposition, pinch distances, openness, reach. A chart knows one bit per finger. On an air instrument, where the player makes each key press a deliberate lift, that bit is flexion: down is curled, up is straight. So the prior speaks on the four flexion features of each of nine fingers (the curl, and the three joint angles it is the sum of: `l.index.curl`, `l.index.mcpAngle`, ...) and on nothing else. The spreads, pinches and reach are left alone.

Only the curl has default anchors. A joint angle joins the metric once the enrolment has calibrated it, because a guessed per-joint prior (an even bend per joint, say) would add noise to what the curl already says: MediaPipe's curls concentrate in the middle joint.

### 4.2 The anchors

What a down finger's curl is, and an up one's, are the two numbers that turn the chart into a vector, and they are the player's, not the chart's. The defaults (`DEFAULT_ANCHORS`: up 0.5, down 2.4, in the catalog's curl units, radians summed over three joints; the thumb 0.4 and 1.2) describe a deliberate air-flute lift. `calibrateAnchors` replaces them, per feature family, with the mean value of the fingers the expected fingering has down and of those it has up, over every enrolled entry whose label the chart knows, thumbs pooled apart; a family whose thumb states have no evidence keeps its thumb features out of the metric rather than guessing them. The fingering an entry is read against is the one the guide showed for it (`expectedFingering`), not the chart's standard row: a Bb enrolled "one and one" has its right index down, and reading it against the thumb-Bb row would pool forty curled samples into the up anchor. One enrolled note carries both states for several fingers, so one note calibrates the chart for all the others. This is what the maintainer meant by training that only tunes to the player.

### 4.3 The conjugate update

Each class centroid is a Gaussian mean with a prior at the chart's expectation worth `strength` pseudo-samples. With `n` enrolled samples averaging `x`, the posterior mean is `(strength * chart + n * x) / (strength + n)` per feature [22]. `trainModel` computes exactly this when the chart's centroid is added to the class `strength` times, so the fused model is an ordinary `TrainedModel`, classified by the node's existing tracker, with no new model format. The default strength is 10: the vocabulary keeps at most 40 samples per entry, so an enrolled note is four parts player to one part chart.

Two details decide whether this works at all, and both were found by measurement rather than by design.

**One metric for every class.** The first version scored an enrolled class on the whole hand vector and a chart-only class on the nine curls, the rest of its centroid left blank. Two failures follow, one each way. Filling the blanks with the enrolment's grand mean (the empirical-Bayes reflex) lets an enrolled note steal its neighbours: a hand one finger away from an enrolled G matches G on seventy features and the chart's G# on nine, and the synthetic lazy player's unseen notes fell to 74%. Leaving the blanks blank (skipped by the distance) turns it round: the enrolled note pays its own jitter on seventy features that its chart-only neighbours never pay, and the reviewer measured an enrolled G reading as A, F or G# in 29 frames of 30 at twice the test jitter, with the wrong-note check then disputing a correct G. A distance over different feature sets is not one distance. So every class is scored on the same features: the flexion features the anchors cover, nine curls before any enrolment and up to thirty-six with the joint angles once the enrolment has calibrated them. For the air flute this costs nothing a note is made of; a note is which fingers are lifted, and the spreads and pinches are the nuisance the flexion features are invariant to. Both regressions are now tests: the lazy player's unseen notes above 90% after calibration, and an enrolled G read as G in at least 28 frames of 30 at twice the jitter, under a drift, and for the lazy player with both.

**Units.** Distances are in the player's own hold jitter where the enrolment gives one (`jitterWeights`), and until it does, in quarters of the anchors' up-to-down gap per feature, so a finger halfway between the two states is two units from either.

At `strength` 0 the chart only names the classes: a chart-only class keeps one copy of its expectation, and an enrolled class is its enrolment alone.

### 4.4 What the hand cannot see

Two notes whose fingerings use the same fingers on different keys are one shape to a camera: the flute's C4, C#4 and Eb4 (the little finger on the C, C# or Eb key), Bb with the thumb key and B, the clarinet's throat tones, the whole clarion against the chalumeau. `priorClasses` groups a chart's notes by shape, and when a shape holds different pitch classes it moves each one that has an alternate with a free shape onto that alternate, all its octaves together: the flute's Bb is shown "one and one" (`L1` and `R1`), which a camera can tell from B. What cannot be separated stays one class labelled by every note in it, and the class's `notes` say so, which is what a guide should tell the player. The octave is invisible too, so E4 and E5 are one class named by the note in the preferred octave (5 for the flute); an enrolment under either name attaches to it and renames it in the player's word.

`expectedFingering` returns, for a note, the shape the prior listens for (standard or the alternate it chose) with its keys, so what the guide draws and what the prior expects can never disagree. This is the one rule the UI PR must keep. Labels join their class by pitch, so an entry the player spelled "Bb5" is the class the chart spells A#5, and takes the player's spelling as its name.

Where a shape serves several pitch classes and no alternate separates them (the flute's low C, C# and Eb; the clarinet's D4, throat Bb and clarion C6, all `LT L1`), the class is named by the lowest note when none sits in the preferred octave. A clarinet sequence would therefore ask for "D4" where it means the throat Bb; that is the honest name of a shape the camera cannot split, and a clarinet guide should say all three.

### 4.5 Catching a wrong note

`checkTake` judges a hold as a whole: for every sample, the distance to the target's class and to the nearest other, their difference as a fraction of the distance between those two centroids, and the median over the hold against a margin of 0.5 (halfway between the two). The fraction is scale-free, so the threshold means the same thing before and after enrolment changes the metric. A label the model has no class for is `unknown`, not wrong: a chord name in a flute sequence is simply learned.

## 5. The sequence

`SequenceSpecSchema` is the SSOT (zodal rule, affordances first): targets (a label, an optional hold length of its own), a lead-in before the first target, a countdown before every target, a settle at the start of every hold that is not captured (the enrolment UI's lesson: the hand is still moving into the shape), the hold, and loops. `sequenceOf(labels)` makes one from plain labels; a chart's notes in a range make a scale; a chord list makes a guitar sequence. It persists as a named collection like cues and routines.

`createSequenceRunner` walks it on the caller's clock (`push(vector, t)` and `tick(t)`, as the cue runner), reporting the current and the next target, the seconds left, whether it is capturing, the results so far, and events with `say` strings from a finite set plus the labels ("Next: D5.", "Hold D5.", "Good.", "That looked like G5."), so the trainer's voice can cache a clip per phrase. `skip`, `redo` (from the countdown, dropping the previous result of that target) and `stop` are the player's controls. The check is injected: `checkTake` for the flute, "does it look like the enrolled entry of that name" for a guitar, none for a label nobody knows. A mismatch does not stop the sequence; it is reported and the host may redo.

Defaults: lead-in 3 s, countdown 3 s, settle 0.3 s, hold 2.3 s (two seconds captured, the chord enrolment's measured enough), one loop. A twelve-note scale is one minute.

## 6. Verification on a synthetic flautist

`test/air/fingering_prior.test.ts` builds two hands from the synthetic kinematic hand of the air tests (`test/air/synthetic_hand.ts`; self-made data, safe to commit), with each finger's bend set by the chart's down/up for a note and jittered per frame, and runs them through the real `fingeringVector`. The catalog's curl on that chain is about 2.2 times the per-joint bend after foreshortening, which is why the "textbook" player bends 1.1 rad per joint to land on the default anchors.

| case | result |
|---|---|
| chart alone, textbook player, 26 notes in 24 shapes, nine curl features | above 95% of frames named by their class |
| lazy player (down 0.7, up 0.35 per joint), chart alone, 22 unseen notes | the baseline |
| same player after enrolling G5 and Bb5 ("one and one") | anchors recalibrated (down between 1.2 and 2.4, up between 0.5 and 1.1), the joint angles now anchored too; Bb5 joined the A#5 class under the player's spelling; unseen notes at least as good as the baseline and above 90% |
| G5 enrolled, then fresh G5 takes at twice the jitter; under a 0.08 rad drift; the lazy player with both | at least 28 frames of 30 read G5 each time, the check says ok, and A5, F5, G#5 still read as themselves above 90% |
| conjugate mean | `l.index.curl` of G5 equals `(10 * anchor + n * mean) / (10 + n)`; at strength 0 it is the enrolment's mean and A5's is the anchor |
| G5 held when A5 was asked | mismatch, read G5, margin above 0.5; A5 held when A5 asked, ok; Bb5 held when Bb5 asked, ok; Eb4 held when C4 asked, ok (one shape) |
| a fist enrolled as "fist" | its own class, no prior, recognised; the chart's notes still read as themselves |

The sequence runner (`test/enroll_sequence.test.ts`) is driven deterministically through lead-in, countdown, settle, capture, verdicts, loops, skip, redo and stop, with every timing read from `state()` as a panel would show it.

What this does not verify: a real hand. The synthetic hand has no self-occlusion and the same spreads for every note, its "textbook" player is defined as the default anchors (so the chart-alone number is a check of the plumbing, not of the defaults), and the defaults are a guess at a real lift until a webcam says otherwise. The live entry for #146 comes with the UI PR.

## 7. What the UI PR must do (and the rules it inherits)

1. A `FingeringGuide` that draws two schematic hands from `expectedFingering`, down fingers filled, with the keys as a caption and the class's other notes as a note ("also plays G4"). It draws the prior's shape, never the chart's standard one when they differ.
2. The sequence trainer inside the air flute's (and guitar's) enrolment section: the list, the next target large, the countdown, a lead-in, the guide for the current target, the verdict per hold, redo, and Learn all on completion. Every hold that came back ok is enrolled under its label through the existing `enrol`; a mismatch asks first.
3. A `prior` dial on the air flute (`chart`, `strength`, `range`) so the fused model is what the node classifies against, published from the vocabulary store where `trainVocabulary` is called today; the node itself does not change.
4. Saved sequences as a zodal collection, with a starter set: the flute's first-octave scale, the second, a chromatic run.
5. The link from each instrument's parameter panel, once the instrument spec design (round 4, thoremin-arch) says where an instrument's affordances are declared; until then the trainer lives in the flute's own settings.
6. Clicks from a cold load written in the PR, and a `test/app_shell`-style reachability test.

## 8. Open questions for the maintainer

- The default anchors are a guess at a deliberate lift. Once a real take exists, the calibrated anchors of one player are a better default than these; it may be worth shipping them.
- The thumb is the weakest finger for a camera (it bends less and sits behind the hand); the chart-only prior can tell C5 from B4 only by it. Enrolment fixes this per player, but a guide could also say "lift the thumb clearly".
- Should a sequence loop by default? Two loops double the samples per note and give the player a second chance at a mismatch without a redo.

## REFERENCES

[1] thoremin, [Air instruments: prior art, a footage pipeline, and a first model](air-instruments.md), §6.3 to 6.4 (guitar chords across players) and §7.2 (flute fingering under the tracker's noise; the air flute as large lifts).

[2] thoremin, [Research: trainer mode](trainer-mode.md), §10 (guided enrolment) and `src/enroll/cue.ts` (the two wording rules every cue obeys).

[3] The Woodwind Fingering Guide, [Flute and Piccolo Fingering Charts](https://www.wfg.woodwind.org/flute/).

[4] Yamaha Corporation, Musical Instrument Guide, [How to Play the Flute: fingering diagrams](https://www.yamaha.com/en/musical_instrument_guide/flute/play/play002.html).

[5] flutetunes.com, [Basic Flute Fingerings](https://www.flutetunes.com/fingerings/basic-fingerings.php).

[6] LilyPond Notation Reference, [Woodwinds](https://lilypond.org/doc/v2.25/Documentation/notation/woodwinds) and [Woodwind diagrams key lists](https://lilypond.org/doc/v2.25/Documentation/snippets/wind-instruments-_002d-woodwind-diagrams-key-lists).

[7] The Woodwind Fingering Guide, [Recorder Fingering Charts](https://www.wfg.woodwind.org/recorder/).

[8] Yamaha Corporation, [Soprano Recorder (Baroque) Fingering Chart](https://www.yamaha.com/en/musical_instrument_guide/common/images/recorder/fingering_baroque.pdf).

[9] Folkstrings, [Recorder Fingering Chart: Baroque and German](https://folkstrings.com/recorder-fingering-chart/).

[10] Yamaha Corporation, Musical Instrument Guide, [Learn the fingering to use with instruments](https://www.yamaha.com/en/musical_instrument_guide/feature/fingering/) (baroque against German recorder fingering).

[11] The Woodwind Fingering Guide, [Chalumeau and Clarion Register Fingering Charts for Boehm-System Clarinet](https://www.wfg.woodwind.org/clarinet/cl_bas_1.html).

[12] Yamaha Corporation, Musical Instrument Guide, [How to Play the Clarinet: fingering diagram](https://www.yamaha.com/en/musical_instrument_guide/clarinet/play/play002.html).

[13] Wikipedia, [Boehm system (clarinet)](https://en.wikipedia.org/wiki/Boehm_system_(clarinet)).

[14] The Woodwind Fingering Guide, [Saxophone Fingering Charts](https://www.wfg.woodwind.org/sax/).

[15] Yamaha Corporation, Musical Instrument Guide, [How to Play the Saxophone: saxophone fingering](https://www.yamaha.com/en/musical_instrument_guide/saxophone/play/play002.html).

[16] The Woodwind Fingering Guide, [Oboe Fingering Charts](https://www.wfg.woodwind.org/oboe/).

[17] Oboehelp, [Technique](https://oboehelp.com/technique/) (octave keys and the half-hole).

[18] The Woodwind Fingering Guide, [Tin Whistle and Fife Fingering Charts](https://www.wfg.woodwind.org/tinwhistle/).

[19] Wikipedia, [Overblowing](https://en.wikipedia.org/wiki/Overblowing).

[20] Wikipedia, [Register key](https://en.wikipedia.org/wiki/Register_key).

[21] MusicXML 4.1, [The fingering element](https://w3c.github.io/musicxml/musicxml-reference/examples/fingering-element-frame/).

[22] Murphy KP. [Conjugate Bayesian analysis of the Gaussian distribution](https://www.cs.ubc.ca/~murphyk/Papers/bayesGauss.pdf). Technical note, University of British Columbia; 2007. (The posterior mean of a Gaussian mean with a known variance and a conjugate prior is the pseudo-count-weighted average of the prior mean and the sample mean.)
