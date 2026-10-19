# Chord layouts: grids, lattices and wheels, and what is known about playing them

*Research note, October 2026. The question behind it: an instrument for thoremin like Pur Pasteur's "Motion Capture Harmonic Map" [1][2]. This note is the prior art and the evidence (§1 to §5), then the instrument thoremin built from it (§6). Related notes: [`air-instruments.md`](air-instruments.md) (camera instruments, the per-player enrolment result), [`latency-budget-and-browser-realtime.md`](latency-budget-and-browser-realtime.md) (the measured camera-to-speaker budget) and [`subframe-impact-prediction.md`](subframe-impact-prediction.md) (onsets under a frame period).*

## 1. What the video's tool is

**Sources.** The video [1] could not be downloaded, so this section rests on what could be read: the page's description and chapter list, YouTube's four published frames of the video, and the frames of a related Short that shows the same tool [2]. The tool is a web app that only channel members can use, so it could not be tried. The geometry below was measured on one frame and is an inference from a still image, not from the app's code.

**What it is.** A webcam app with hand skeletons drawn on both hands. The left three quarters of the screen are labelled "LEFT - HARMONY" and the right strip "RIGHT - MELODY". A piano keyboard along the bottom (C2 to C7) lights the sounding notes.

- **Harmony (left hand).** A hexagonal lattice of the seven diatonic triads of one key (C, Dm, Em, F, G, Am, B° in the frames). Each hex shows a chord name, a Roman numeral and a colour per degree. The lattice repeats and fills the panel. Whichever hex is under the palm sounds, voiced with common-tone voice leading (the video's second chapter).
- **The three axes.** Along a row, each step right is a diatonic fourth up (G C F B° Em Am Dm). The down-right diagonal is a third up (C to Em). The down-left diagonal is a second down (C to B°). In scale steps that is +3, +2 and -1 (mod 7). These are the video's "three dimensions of harmonic movement": the cycles of fourths, thirds and seconds.
- **Emotion labels.** The six directions around the selected hex carry short labels for moving that way (around Em: "Sad resolution, Acceptance" towards Am, "Strength, Happy surprise" towards G, "Faltering" towards Dm). They are the same labels as the video's cycle-of-fourths and cycle-of-thirds charts. They are the creator's own, and no source is given for them (see §2.5).
- **Melody (right hand).** A vertical ladder of note bands holding the current chord's tones over about two octaves (E4 to B5 when Em is selected). The hand's height picks a band. A mode label reads "ARPEGGIO".
- **Restrictions.** One key; diatonic triads only, with no sevenths, secondary dominants or borrowed chords seen in the frames; a chord sounds when the hand enters its hex, with no separate control for when it sounds; melody limited to chord tones.

**A property of this lattice (derived here, not stated in the video).** The six neighbours of any hex are at scale-step offsets ±1, ±2 and ±3, which are all six non-zero residues mod 7. So every hex touches one copy of each of the other six chords, and the ring of labels around each chord names every possible next chord exactly once. The plane is a seven-colouring of the hexagonal tiling, a 7-cell torus unrolled. Distance on this map carries no information: every diatonic chord is one step from every other. What the layout encodes is the *direction* of a move, i.e. which interval class the roots move by. This is the main difference from the families below, where distance means harmonic remoteness.

**How it relates to the families below.** It is a chord-button instrument (§2.1) whose buttons are arranged like an isomorphic note lattice (§2.2), restricted to one key the way in-key pad modes are (§2.1), with a functional-harmony annotation (§2.4). The closest relative is the Tonnetz family: the harmonic table puts fifths and thirds on its axes [17], and the diatonic circle of thirds connects each triad to its smoothest voice-leading neighbours [25]. The video's map uses those same intervals, but between chord *roots* inside one scale, not between pitches.

## 2. The families of layouts

### 2.1 Chord-button grids: one control per chord

These instruments all split a chord into **which** (a button) and **when** (a strum, a pad or a key), and most of them lay out the "which" by the circle of fifths.

- **Omnichord / Q-Chord (Suzuki, 1981 on).** A grid of chord buttons plus the "Sonic Strings" strum plate. Holding a button and sliding a finger along the plate plays that chord's tones as an arpeggio over about four octaves [3]. Button counts by model: OM-27, 27 chords; OM-36, 36; OM-84, 84 chord shapes; the 2024 OM-108 has 38 buttons and 108 chords, its extra qualities (sus4, add9 and others) made by pressing one to three buttons together [3][5]. The rows are chord qualities: major on top, minor in the middle, seventh at the bottom, with combinations giving other qualities (major + minor = diminished; major + seventh = major seventh) [4]. That last point comes from an emulator's documentation [4]; no Suzuki manual was found. The claim that the columns follow the circle of fifths appears only in a reseller listing, so it is not verified here.
- **Stradella bass (accordion, settled by about 1900).** On a 120-bass accordion there are 20 columns ordered by the circle of fifths, so a key's I, IV and V are three adjacent columns [7]. Each column holds, in order, a counterbass (a major third above the root), the root, then major, minor, dominant-seventh and diminished-seventh chord buttons. Each chord button sounds three pitches; modern instruments drop the fifth from the seventh and diminished chords [7]. Players find their place by touch: a marked C button, plus other marked roots four columns away [7]. Diatonic triads in C span six columns (F to B) and three chord rows, so the chords of a key are a compact block, and the same block works in every key.
- **Autoharp chord bars.** Each bar damps every string outside its chord, and the player strums across all the strings. Bars can be rearranged. Lindsay Haisley's "Chromatic Standard" 21-bar layout puts dominant sevenths in the middle row and adds diminished-seventh bars. He chose it so that "the reach from C to E7 should be the same as the reach from G to B7, or from F to A7", and he names the Stradella bass as its model [8]. He also warns that "re-learning how to use your fingers ... on a new layout can be expensive in terms of time and effort" [8].
- **Ableton Push (note mode).** An 8x8 pad grid. By default "every note on the grid is in the key of C major"; moving right goes to the next scale note, and moving up goes a fourth higher. Other layouts put a third, rather than a fourth, on the vertical, or place the scale in order. "In Key" shows only the key's notes; "Chromatic" shows all notes and unlights the ones outside the key [9]. One consequence (derived here): with In Key and the third layout, any three pads in a column are a diatonic triad, so all seven triads share one shape and the key supplies each chord's quality, as on the video's map.
- **Novation Launchpad Pro [MK3], Chord Mode.** The orange pads hold "triads from the scale in ascending order", for progressions such as ii-V-I or I-V-vi-IV, and they change with the selected scale. They are coloured by quality (blue major, purple minor), and two white columns store the player's own chords [10]. The official guide refused a direct fetch, so this rests on search excerpts of it.
- **InstaChord.** A guitar-shaped body. The player sets the key, and the diatonic chords are assigned to buttons numbered 1 to 9: ii-V-I is buttons 2, 5, 1. Modifier buttons swap major and minor, flatten a chord, or add a 7th, sus4 or aug, and six rubber pads are strummed. Its designer, by his own account not an instrumentalist, built it so that people with no training could play; "the assigned chords are fixed and cannot be customized by player" [11].
- **Telepathic Instruments Orchid (co-created by Kevin Parker).** A one-octave keyboard picks the root, and chord-type buttons held with it pick the quality (minor, minor plus m7 gives a minor seventh). With the key lock on, "any key you press will give you something diatonic to that key". It has strum, "slop" (loose timing) and arpeggiator modes [6].
- **HiChord.** A pocket synth sold as playing "chords with 1 button, using our unique interface (based on the Nashville Number System)", with a "chord modifying joystick" [12]. Only retailer listings were found. The button count and the joystick mapping are not verified.
- **Diatonic chord apps.** In GarageBand's Smart Guitar the player strums across the strings of a chord strip, taps the top of the strip for the full chord, or lets Autoplay run a pattern [13]. A tutorial reports eight strips, all chords that fit the song's key, with the key chord fifth from the left [14]. Apps of this kind (the brief's "Capo"-style apps) are the software form of InstaChord: the key is a setting, and the buttons are degrees.

### 2.2 Isomorphic note layouts: one control per note, same shape in every key

An isomorphic layout is a two-dimensional grid of notes where every interval has the same geometric shape everywhere. A chord or scale fingered once can be moved to any key unchanged ("transpositional invariance") [15][16]. Here the unit is the note, and a chord is a shape.

- **Wicki-Hayden.** Kaspar Wicki patented it for the bandoneon in 1896; Brian Hayden reached it independently and patented it for the concertina in 1986 [15]. In Maupin's notation it is a whole tone horizontally and an octave vertically; on the hexagonal grid the two upward diagonals are then a fifth and a fourth. One description is "two rows of six whole steps each ... where the second row commences a perfect fifth above the first" [18][19]. Major scales fall as stacked rows of three and four notes [15]. It is used on Hayden duet concertinas, the Thummer/Jammer, the HexBoard and Striso, and as a mode on the LinnStrument [15].
- **Harmonic table.** A perfect fifth up each vertical column, a major third up one diagonal and a minor third up the other [17][20]. A root-position major triad is a right-facing triangle of three adjacent keys, and a minor triad is a left-facing triangle [20]. "Any major triad and minor triad, in root position, can be played with a single finger" [17]. Peter Davies proposed it in 1983 as the "Melodic Table", and C-Thru Music renamed it on the AXiS controllers [17]. It is "topologically equivalent" to Euler's Tonnetz by a shear [17][18]. The 280-key Lumatone uses a hexagonal isomorphic matrix whose mapping the user sets [21].
- **Jankó keyboard (1882).** Six rows of keys. Within a row, notes rise by whole tones; adjacent rows are a semitone apart and offset by half a key, so each chord and scale has one shape in every key [22]. "Music educators were skeptical and performers were reluctant to learn the new fingerings" [22].
- **Tonnetz (Euler 1739; Oettingen, Riemann; neo-Riemannian theory).** A lattice of pitches with one axis per consonant interval (fifth, major third, minor third), in which "every shared vertex between a pair of triangles is a shared pitch between chords" [23]. Major and minor triads are triangles tiling the plane. Neo-Riemannian theory names the three moves across a triangle's edges: P (parallel: C major to C minor, the third moves a semitone), R (relative: C major to A minor, the fifth moves a tone) and L (C major to E minor, the root moves a semitone) [24]. Each keeps two common tones. With enharmonic equivalence the plane wraps onto a torus of 12 pitches and 24 triads [23][24]. Its dual, with triads as vertices joined when they share two tones, is the graph Douthett and Steinbach drew and Waller studied on the torus [25][26]. That hexagonal "chicken-wire" picture is the one closest in form to the video's map, but its vertices are all 24 triads, not one key's seven.
- **Diatonic restrictions.** Tymoczko models a chord as a point in an orbifold, with voice leadings as paths between points [27]. In one key, the seven triads form the "diatonic circle of thirds" (I, vi, IV, ii, vii°, V, iii), where each triad sits between the two it moves to most smoothly, and the shortest voice leading between any two triads of the key is a few steps around that circle. The roots' "diatonic circle of fifths" (vii°, iii, vi, ii, V, I, IV) is the other standard ring [28]. Source [28] is a secondary summary of Tymoczko's *A Geometry of Music* (2011, §6.3.2); the book itself was not read. The video's lattice puts both rings on axes at once, plus the step ring.

### 2.3 Isomorphic layouts compared in theory

Maupin, Gerhard and Park enumerated every isomorphic layout on square and hexagonal tessellations and judged each one for melody and for harmony [18]. For the harmonic table: "major and minor triads are formed by making small triangular clusters ... with only one finger", "all the immediate surrounding notes are consonant", which suits "jammers", but "harmonically complex chords are difficult to perform as all of the notes are clustered close together" [18]. They state plainly that "the analyses ... are at this point theoretical" and that controlled trials were future work [18].

### 2.4 Circle-of-fifths wheels and functional-harmony maps

- **Chord wheels.** Steinberg's Chord Assistant (Cubase/Nuendo) shows the twelve major chords around an outer circle of fifths and their parallel minors on an inner circle. It puts the current key's tonic at the centre and marks the key's chords with Roman numerals; the player clicks to audition and assign [29]. This is the Stradella logic made circular: harmonic distance is angular distance.
- **Functional maps from data.** Hooktheory's Trends shows, for a given chord or progression, which chords tend to follow, computed "by performing a Markov Analysis using every song in the database" [30][31]. The database is now described as "75,000+ songs" [30]. An earlier blog analysis of 1,300 songs found V following I 31 % of the time [31]. Unlike the video's map, which shows all six moves as equally available, this kind of map ranks the moves by how often they occur.

### 2.5 Emotion and chords: the context for the video's labels

The video gives each root movement (for example IV to vii°) an emotion such as "Drama/Tension/Alarm". No source is given, and no study was found that tests labels for diatonic root movements. The nearest empirical work is on single chords and modes:

- **Single chords.** In 269 listeners rating 14 chords (triads and sevenths, in inversions, on piano and on strings), perceived emotion differed significantly between chords, in line with musical convention. Inversion and timbre also mattered, and naive and expert listeners differed little [32].
- **Major/minor valence.** The association of major with positive and minor with negative valence is "psychologically robust, but without a single accepted explanation"; Parncutt compares six theories of where it comes from [33].
- **Context.** Major chords are rated more pleasant and less tense than minor ones. When a major chord ends a stable progression it is rated more pleasant and more stable; after unstable endings the major/minor difference disappears [34]. So a chord's emotion depends on the progression it ends, which supports the video's choice to label moves rather than chords. That choice is a framing, not a measured result.

## 3. Comparison

"Reachable per key" counts distinct chords available without changing a setting.

| Layout | Unit | Axes (interval per axis) | Key-dependence | Chords per key reachable | What a player must learn |
|---|---|---|---|---|---|
| Video's harmonic map [1][2] | chord (diatonic triad) | row: 4th up; diagonals: 3rd up, 2nd down (scale steps +3, +2, -1) | one key (C seen) | 7, each one hex from every other | the six directions (which interval class each one is); no distance to learn |
| Omnichord / Q-Chord [3][4][5] | chord | columns: roots (reported as fifths); rows: major / minor / 7th | none (all 12 roots) | 36 to 38 buttons; 84 to 108 with combinations | which column is the key; combination rules |
| Stradella bass [7] | chord + bass note | columns: 5ths; rows: counterbass, root, M, m, 7, dim7 | none; one block shape in every key | 80 chord buttons; a key's triads in a 6x3 block | the block shape; finding place by touch |
| Autoharp (Haisley 21-bar) [8] | chord | rows by quality, columns by fifths | some keys only (layout-dependent) | 21 bars in total | the bar layout; each layout is a separate thing to learn |
| Push, In Key [9] | note | right: next scale step; up: 4th (or 3rd) | one key per setting | all diatonic chords as shapes; one triad shape with the 3rds layout | shapes; layout choice |
| Launchpad Pro Chord Mode [10] | chord | triads in ascending scale order | one scale | 7 triads plus stored chords | degree order |
| InstaChord [11] | chord | buttons 1 to 9 = degrees | key is a setting | 9 plus modifiers (7, sus4, aug, flat, major/minor swap) | degree numbers |
| Orchid [6] | chord | a one-octave keyboard (root) x chord-type buttons | key lock optional | 12 roots x types; diatonic with key lock | root keyboard plus modifiers |
| GarageBand Smart Guitar [13][14] | chord | 8 strips | key is a setting | 8 | none beyond the strip labels |
| Wicki-Hayden [15][18][19] | note | horizontal: whole tone; diagonals: 5th / 4th; vertical: octave | none | any chord, as a shape | one shape per chord type |
| Harmonic table / AXiS [17][20] | note | vertical: 5th; diagonals: M3 / m3 | none | any; root-position triads are 3-key triangles | triangle orientation = quality; melody is harder |
| Jankó [22] | note | row: whole tone; between rows: semitone | none | any | a new fingering for pianists |
| Tonnetz / PLR [23][24][26] | note (triads as triangles) | 5th, M3, m3 | none | all 24 major and minor triads; P/L/R are single edge moves | a theory map more than an instrument |
| Diatonic circle of thirds [27][28] | chord | one ring: roots by diatonic 3rds | one key | 7 | ring order = smoothest voice leading |
| Circle-of-fifths wheel [29] | chord | angle: 5ths; ring: major / minor | key centred | 24 shown; the key's chords numbered | the wheel |
| Hooktheory Trends [30][31] | chord | none (ranked lists) | relative to the key | ranked by frequency | nothing; a guide, not a controller |

## 4. What is known about learnability and playability

**Isomorphism is mostly an untested claim, and the few tests give mixed results.** The claim that it eases learning dates from the 19th century [35]. Wikipedia's article states that it "has not been rigorously tested" and attributes it to vendors [16]. Maupin et al. compare layouts on paper only [18]. Park and Gerhard repeat that isomorphism "promotes quicker learning" while noting that, like the Jankó, isomorphic instruments "have not become commercially successful" [36]. The first controlled tests come from Western Sydney University:

- **MacRitchie and Milne (2017)** [37]. 24 experienced musicians, four layouts, a scale and arpeggios trained audio-visually, then retention and transfer (a nursery rhyme not trained). Placing pitches a major second apart next to each other "strongly improves performance accuracy in the training and retention tasks". Shearing the layout so that pitch runs vertically "worsens performance accuracy for the training tasks but ... strongly improves performance accuracy in the transfer task".
- **Stanford, Milne and MacRitchie (2018)** [35]. 68 participants (26 musicians, 42 non-musicians), each playing on Wicki or Bosanquet and on a "minimally adjusted non-isomorphic version" of it. Preregistered, with a Bayesian analysis. In the transfer task played in the trained key, isomorphic layouts did better: evidence ratio 39, accuracy/inaccuracy ratio up 14 %. In an untrained key the evidence was only moderate (evidence ratio 8.5, +12 %). In arpeggio training the *non*-isomorphic layout was better (evidence ratio 3999). Overall, isomorphism helped musicians transfer learning to a new task, and for non-musicians "the results were mixed".
- **A 2026 master's thesis** (N = 21, not peer reviewed) found a 1-D keyboard more accurate overall than a 2-D isomorphic grid for chord matching. The grid started with "severe cognitive friction" but reached the 1-D accuracy on a second exposure (19-EDO) [38].
- **Practitioner reports.** A reviewer of the AXiS-49 found major and minor chords quick to find, while seconds, fourths, sixths, octaves, inversions and fast melody took practice measured in months [20]. Haisley names consistency across keys ("muscle memory with minimal retraining required for different keys") as the reason to choose a layout, and the cost of relearning as the reason to choose it once [8].

**Taken together** (inferred from the above, not stated by any one source): isomorphism pays off when a player moves a learned pattern to a new key or a new tune, which is what [35] and [37] measured as transfer. Adjacency pays off in raw accuracy [37]. Both favour putting the most-used moves next to each other. In-key chord layouts (Push In Key, Launchpad Chord Mode, InstaChord, the video's map) remove the transfer problem altogether: there is only one key on the surface, so a pattern of degrees is already key-independent.

**Chord instruments for novices.** Several are designed for players with no training (InstaChord's designer was not an instrumentalist [11]; Orchid's key lock [6]; HiChord's "no wrong notes" claim [12]), but no controlled learnability study of a chord-button instrument was found. Two spatial harmony systems have small evaluations:

- **Harmony Space.** Holland's direct-manipulation interface puts notes, chords and keys on a 2-D lattice derived from Longuet-Higgins' and Balzano's tonal spaces, and later prototypes were played with the whole body. A small-subject study found that it "considerably reduces the prerequisites required for novices" to learn and experiment with harmony [39]. Only the abstract was read.
- **The Harmonic Walk.** A camera-tracked 3 x 4 m floor with six chords at fixed positions; a user stepping into a zone plays its chord, to accompany a melody. In a 22-student high-school assessment, the authors report learning improvements both with and without explicit instruction [40]. Only the abstract was read.

Neither isolates the layout from the novelty of the setting.

**Accessible and gaze instruments, the nearest relatives of a camera grid.** Frid's review of 83 accessible digital musical instruments found ten interface types, most of them tangible. Touchless controllers (sensors or cameras) are one type, and only 14.5 % of instruments gave vibrotactile feedback [41]. The EyeHarp, a gaze-played instrument with a chord layer, is the most detailed evaluation of pointing at on-screen musical targets with no touch [42]:

- Its step sequencer, which does not play in time, uses a dwell of 700 ms. Its melody layer uses a "pie" of 14 slices (adjustable), and six slices can be switched to chords.
- Notes trigger when a fixation lands in each slice's outer selection area. This "screen button" method separates where the player looks from what triggers, instead of using dwell, because "dwell-time does not allow triggering events in tempo" [42].
- In an earlier 10-subject test, notes came early on average (-46 ms between diametrically opposite slices, -94 ms between adjacent ones), timing improved with practice, and timing variance was 10 times that of a computer keyboard [42].
- Its authors describe "a steep learning curve", as with traditional instruments [42].

## 5. Implications for a camera instrument

These are findings with sources; §6 is the design they led to.

**Pointing precision and target size.**

- Absolute freehand pointing is the hard case even with perfect tracking. With Vicon markers on the hand, 4 m from a 5 m-wide display, absolute ray-casting had error rates of 56 % on 16 mm targets (0.3 % of display width), 10.5 % on 48 mm (1 %), and under 1.1 % on 144 mm targets (about 3 %) for every technique [43]. The authors attribute this to natural hand tremor and concluded that, although ray-casting was faster on large targets, "its high error rates prevent it from being a practical technique" [43].
- A markerless tracker adds its own noise. Against Vicon, MediaPipe's finger joint angles had a mean RMSE of 22.5°, and the error grew with movement speed [44]. Its developers report that training on synthetic data gave "less jitter visually across frames", without a number [45].
- thoremin's own measurements put MediaPipe's frame-to-frame jitter on a still hand at about 2 px at 640 px width, about 0.3 % of the frame ([`subframe-impact-prediction.md`](subframe-impact-prediction.md)). Raw palm-relative distances jittered enough to move a bass note by a quarter of a scale step before smoothing ([`air-instruments.md`](air-instruments.md)).
- A Fitts's-law test of the Leap Motion as a pointer found a 7.8 % error rate against 2.8 % for a mouse, with movement times twice as long [46].
- Filtering trades jitter for lag. The 1€ filter raises its cutoff with speed: a low cutoff for a slow hand, less lag for a fast one [47]. Vogel and Balakrishnan used a dynamic low-pass of the same kind [43].
- Taken together: cells a few percent of the frame wide sit where marker-tracked absolute pointing became reliable [43]. A seven-chord lattice filling three quarters of the frame [1] is an order of magnitude larger than that, and well above the measured jitter. Cell size is not the limit for a seven-cell surface. The limits are hysteresis at cell edges and what the hand crosses on its way.

**Transit, and the Midas touch problem.**

- Jacob named the problem for gaze: if looking acts, "everywhere you look, another command is activated". He used dwell, finding 150 to 250 ms "excellent" for selections that are easy to undo and long dwells (over about a second) never useful [48].
- A hand that selects by position has the same problem with every cell it passes through. EyeHarp's answer was the screen-button method [42]. In the video's lattice every chord has a copy adjacent to the current hex (§1), so any change of chord can be a move across one shared edge, with no other chord on the way. This holds only if the player aims for the nearest copy, which the repeated lattice makes possible.
- Chord-button instruments avoid transit by construction: choosing a chord makes no sound until the strum (Omnichord [3], InstaChord [11], Orchid's chord keys [6], GarageBand's strips [13], the autoharp's damping bars [8]). The video's tool, as seen, does not separate the two: a chord sounds on entering its hex (§1).

**Triggering and strumming: latency.**

- Wessel and Wright put the "acceptable upper bound on the computer's audible reaction to gesture at 10 milliseconds", with variation of no more than 1 ms [49]. In a controlled test with percussionists and amateur musicians, 10 ms was not rated significantly differently from zero latency, but 10 ± 3 ms of jitter and 20 ms were rated lower in quality [50]. Most common DIY instrument setups miss these targets [51].
- For gestural control without touch, the just-noticeable latency on a theremin was 20 to 30 ms, and "when playing slow passages with vibrato, even high latencies were not noticed" [52].
- thoremin's measured path from a hand movement to the speaker is about 100 ms plus the camera hardware ([`latency-budget-and-browser-realtime.md`](latency-budget-and-browser-realtime.md)). So a strum timed from the frame that shows it lands far outside every bound above. A sustained chord change tolerates more, because a pad's onset is soft and its harmony is heard over a longer span, which is what [52] found for slow passages.
- The repository's answer for percussive onsets is prediction ahead of the frame ([`subframe-impact-prediction.md`](subframe-impact-prediction.md)). The Virtual Air Guitar (Helsinki, 2006) took the same split as the chord instruments: the distance between the hands chose the pitch, and a separate plucking motion of the right hand triggered it [53].

**How to trigger without a button.**

- Freehand click gestures exist, but they must be told apart from pointing motion. Vogel and Balakrishnan's AirTap is an index-finger "down and up" and their ThumbTrigger an "in and out" of the thumb [43]. AirTap is recognised from the finger's velocity, acceleration and distance moved in 200 ms along its own movement axis. It is calibrated per user from 5 s of clicking, because "other hand gestures and even involuntary finger movement tend to resemble this type of clicking action". In exploratory tests the two gestures did not differ in time or error rate [43].
- The EyeHarp's timing data shows a no-touch trigger can be learned for in-tempo playing, at a cost in timing spread [42].

**How many cells.**

- Commercial chord-button instruments for novices stay small: 7 triads (Launchpad Chord Mode) [10], 8 strips (GarageBand) [14], 9 numbered buttons (InstaChord) [11]. The Omnichord's 27 to 38 buttons cover every root because it is not tied to one key [3][5].
- The EyeHarp defaults to 14 slices for melody and makes six of them chords [42]. The Harmonic Walk uses six chord zones on a floor [40].
- No study was found that measures how many chord targets a camera-tracked hand can use, so a count from five to fourteen is what practice shows, not a measured limit. Beyond about seven, a layout either repeats chords (the video's periodic lattice, the Tonnetz) or takes on a second axis of quality (Omnichord rows, Stradella rows).

**Feedback.** Touchless control lacks the kinesthetic and tactile cues a button gives. Vogel and Balakrishnan added "subtle auditory and visual feedback techniques to compensate" [43], and Frid's review found tactile feedback rare among accessible instruments [41]. The video's tool shows the selected hex, its neighbours' labels and the lit keyboard, so it carries all of its feedback visually [1][2].

## 6. The thoremin instrument: the chord map

What was built, and which finding above each choice rests on. The code is the air extension's `chord-map` node (`packages/ext-air/src/nodes/chord_map.ts`), its pure layout library (`packages/ext-air/src/lib/chord_map.ts`) and the overlay's generic `cellGrid` element; two instruments ship, **Chord Map** and **Chord Map Strum**.

**The layout.** Three layouts, one dial (`chordMap.layout`):

- `harmonic` (the default): the video's lattice [1][2], pointy-top hexagons, a fourth up across a row (+3 scale steps), a third up on the down-right diagonal (+2), a second down on the down-left (-1). The tonic sits on the middle cell. Because every cell's six neighbours are the other six chords (§1), any chord change can be one move across a shared edge, which is what keeps a held chord from sounding the chords it would otherwise cross (the transit problem, §5).
- `fifths`: one row by fifths, IV I V ii vi iii vii°, the functional neighbours side by side (§2.4).
- `scale`: one row in scale order, I to vii°, the chord-strip instruments' order (§2.1).

A row's cells are full-height strips, so only the hand's width matters: the largest target a seven-cell row can give (§5, target size). The harmonic map's cells are 0.2 frame heights wide by default (`cellSize`), an order of magnitude above the tracker's jitter (§5).

**The key.** The chords are the key's diatonic triads, spelled in the key (Bb in F major, not A#). The key is the instrument's chord-source scale: the Sound section's root and scale, or the Chord sound section's custom chord scale. A five- or six-note scale is read through its seven-note parent, as everywhere else in thoremin. Both instruments ship in C major, as in the video.

**Choosing a chord.** The chord hand (the left by default, as in the video) chooses with its palm's centre, or its index fingertip. A new chord takes over after two camera frames over it (about 67 ms at 30 fps, well under Jacob's 150 to 250 ms dwell for undoable selections [48]), and only once the hand is nearer its centre than the sounding chord's by 0.12 cell widths: hysteresis, so a hand resting on an edge does not flicker between two chords (§5). A chord keeps sounding 0.3 s after the hand leaves the map or is lost, which bridges a dropped tracking frame.

**Sounding it.** Two modes (`chordMap.play`):

- `hold` (the video's): the chord sounds while it is chosen, through the SDK's chord renderer with the instrument's Chord sound settings (sound, voicing, sustained or arpeggiated rendering), the same path as every other chord thoremin plays. A sustained pad tolerates the camera path's latency, as slow passages did on a theremin [52]. The other hand plays a melody on the chord's tones: its height over a ladder of them, from the octave above the chords, two octaves and the root on top (the video's right strip).
- `strum`: the other hand strums and the chord under the chord hand is strummed as a guitarist voices it. When a strum sounds is the air guitar's decision, now shared by both instruments (`packages/ext-air/src/lib/strum.ts`): the impact predictor commits the strum ahead of the frame that shows it, with the output's lead plus the frame's age, and a strum it missed sounds at once, softer. The chord is latched at that decision. This is the answer §5 points to for percussive onsets, which a frame-timed strum would miss by about 100 ms.

**What the screen shows.** The overlay draws the map on the chord hand's side (65 % of the width by default), each chord in its degree's colour with its numeral, the chosen one lit, the one the hand is moving to half-lit, and a ring at each pointing hand. On the harmonic map, each edge of the chosen chord carries the move across it ("4th up", "3rd down"). The video's emotion labels are not reproduced: they are the creator's own and unsourced (§2.5), so the map names the interval, which is a fact about the move. In hold mode the melody ladder is drawn on the other side, its notes named, the one played lit.

**What it does not do yet** (each is a follow-up or an open choice on the tracking issue): common-tone voice leading as the video demonstrates it (the renderer's voicings are fixed shapes that glide per voice); sevenths, secondary dominants or borrowed chords; the chord shown on the shared chord name and keyboard strip (it waits for chord producers to become a pool in the extension seams work); and a chord change timed ahead of the frame, as the strum is.

## REFERENCES

1. Pur Pasteur. All Diatonic Chords and their Emotional Signatures Controlled by Hand Movement (no theory required) [video]. YouTube. [youtu.be/95u70uQfofQ](https://youtu.be/95u70uQfofQ)
2. Pur Pasteur. Control Harmony With Your Bare Hands?? [YouTube Short]. [youtube.com/shorts/4avKOWkj34Y](https://www.youtube.com/shorts/4avKOWkj34Y)
3. Wikipedia. Omnichord (secondary). [Omnichord](https://en.wikipedia.org/wiki/Omnichord)
4. Jan125. Chordian, a virtual instrument emulating the Suzuki Omnichord OM-84 (README; an emulator's documentation, secondary). [github.com/Jan125/pb.chordian](https://github.com/Jan125/pb.chordian)
5. Douglas A. Suzuki Omnichord OM-108 hands-on. Gearnews (secondary). [gearnews.com](https://www.gearnews.com/suzuki-omnichord-om-108-hands-on)
6. Reviewing Telepathic Instruments' Orchid: the synth from the mind of Tame Impala. Splice blog (secondary; the manufacturer's manual URL redirected to a 404). [splice.com](https://splice.com/blog/telepathic-instruments-orchid-review/)
7. Wikipedia. Stradella bass system (secondary). [Stradella bass system](https://en.wikipedia.org/wiki/Stradella_bass_system)
8. Haisley L. Chromatic Standard Layout. Autoharp.org; 2018. [PDF](https://www.autoharp.org/articles/Chromatic_Standard_Layout.pdf)
9. Ableton. Push manual: playing melodies and harmonies, layout and scale options. [ableton.com/en/push/manual](https://www.ableton.com/en/push/manual/)
10. Novation. Launchpad Pro [MK3] Chord Mode Guide (read through search excerpts; the page refused direct fetch). [support.novationmusic.com](https://support.novationmusic.com/hc/de/articles/360011206299-Launchpad-Pro-MK3-Chord-Mode-Guide)
11. The Music Trades (Japan). InstaChord: an instrument for people with no musical training; 2023. [musictrades.co.jp](https://www.musictrades.co.jp/en_page?id=5660)
12. Perfect Circuit. Pocket Audio HiChord Compact Chord Synthesizer (retailer listing, read through search excerpts; secondary). [perfectcircuit.com](https://perfectcircuit.com/pocket-audio-hichord-standard.html)
13. Apple. GarageBand for iPhone User Guide: Guitar chord strips and Autoplay. [support.apple.com](https://support.apple.com/en-mo/guide/garageband-iphone/chs39282a88/ios)
14. Expert Reviews. GarageBand tutorial: how to use GarageBand on iPad and iPhone (read through search excerpts; secondary). [expertreviews.co.uk](https://www.expertreviews.co.uk/technology/software-services/garageband-tutorial-how-to-use-garageband-on-ipad-iphone/2)
15. Wikipedia. Wicki-Hayden note layout (secondary). [Wicki-Hayden note layout](https://en.wikipedia.org/wiki/Wicki%E2%80%93Hayden_note_layout)
16. Wikipedia. Isomorphic keyboard (secondary). [Isomorphic keyboard](https://en.wikipedia.org/wiki/Isomorphic_keyboard)
17. Wikipedia. Harmonic table note layout (secondary). [Harmonic table note layout](https://en.wikipedia.org/wiki/Harmonic_table_note_layout)
18. Maupin S, Gerhard D, Park B. Isomorphic tessellations for musical keyboards. Proc. Sound and Music Computing Conference (SMC); 2011. [PDF](https://wiki.shiverware.com/images/0/08/Isomorphic_Tessellations_For_Musical_Keyboards.pdf)
19. Woehr J. Interview with Brian Hayden, inventor of the Hayden Duet Concertina; 2003. [people.well.com](https://people.well.com/~jax/rcfb/BrianHayden_20031023.html)
20. Sound On Sound. C-Thru Music AXiS-49 review (secondary). [soundonsound.com](https://www.soundonsound.com/reviews/c-thru-music-axis-49)
21. Lumatone. Details and specs. [lumatone.io/details-specs](https://lumatone.io/details-specs)
22. Wikipedia. Jankó keyboard (secondary). [Jankó keyboard](https://en.wikipedia.org/wiki/Jank%C3%B3_keyboard)
23. Wikipedia. Tonnetz (secondary). [Tonnetz](https://en.wikipedia.org/wiki/Tonnetz)
24. Wikipedia. Neo-Riemannian theory (secondary). [Neo-Riemannian theory](https://en.wikipedia.org/wiki/Neo-Riemannian_theory)
25. Douthett J, Steinbach P. Parsimonious graphs: a study in parsimony, contextual transformations, and modes of limited transposition. Journal of Music Theory 42(2); 1998 (course-site copy found in search, not read). [PDF](https://edisciplinas.usp.br/pluginfile.php/4287684/mod_resource/content/1/Parsimonious%20Graphs%20-%20A%20Study%20in%20Parsimony,%20Contextual%20Transformations,%20and%20Modes%20of%20(Dout.pdf)
26. Crans AS, Fiore TM, Satyendra R. Musical actions of dihedral groups. American Mathematical Monthly; 2009 (arXiv 0711.1873). [arXiv](https://arxiv.org/pdf/0711.1873)
27. Tymoczko D. The geometry of musical chords. Science 313:72-74; 2006 (read through Princeton's press release; secondary). [princeton.edu](https://www.princeton.edu/news/2006/07/06/composer-reveals-musical-chords-hidden-geometry)
28. Diatonic modes and chords: the diatonic circle of thirds, after Tymoczko, A Geometry of Music (2011) §6.3.2 (secondary). [harmonious.nfshost.com](https://harmonious.nfshost.com/p/b9/Diatonic-Modes-Chords)
29. Steinberg. Chord Assistant: Circle of Fifths (Cubase/Nuendo documentation). [steinberg.help](https://archive.steinberg.help/nuendo/v8/en/cubase_nuendo/topics/chord_functions/chord_functions_chord_assistant_fifths_c.html)
30. Hooktheory. Trends. [hooktheory.com/trends](https://www.hooktheory.com/trends)
31. Hooktheory. Chord progression search, patterns and trends (blog). [hooktheory.com/blog](https://www.hooktheory.com/blog/chord-progression-search-patterns-and-trends/index.html)
32. Lahdelma I, Eerola T. Single chords convey distinct emotional qualities to both naïve and expert listeners. Psychology of Music 44(1):37-54; 2016. [jyx.jyu.fi](https://jyx.jyu.fi/handle/123456789/48313)
33. Parncutt R. The emotional connotations of major versus minor tonality: one or more origins? Musicae Scientiae 18(3):324-353; 2014. [PDF](https://static.uni-graz.at/fileadmin/_Persoenliche_Webseite/parncutt_richard/Pdfs/Parncutt2014EmotionalConnotations.pdf)
34. Zhang J, Li L, Wei L, Wang H. Moderating effects of chord progressions on the emotional experience of major and minor chords. Acta Psychologica; 2025. [DOAJ](https://doaj.org/article/cfc4813ce0934d47a96ce33102be59d4)
35. Stanford S, Milne AJ, MacRitchie J. The effect of isomorphic pitch layouts on the transfer of musical learning. Applied Sciences 8(12):2514; 2018. [mdpi.com](https://www.mdpi.com/2076-3417/8/12/2514)
36. Park B, Gerhard D. Rainboard and Musix: building dynamic isomorphic interfaces. Proc. NIME; 2013. [nime.org](https://nime.org/proc/nime2013_park_a/)
37. MacRitchie J, Milne AJ. Exploring the effects of pitch layout on learning a new musical instrument. Applied Sciences 7(12):1218; 2017. [mdpi.com](https://www.mdpi.com/2076-3417/7/12/1218/html)
38. Puerto Rodríguez GA. Xenatone: microtonal harmony navigation through dynamic isomorphic interfaces. Master's thesis, Universitat Pompeu Fabra; 2026 (not peer reviewed). [zenodo.org](https://zenodo.org/records/23189414)
39. Holland S. Learning about harmony with Harmony Space: an overview. Open Research Online (abstract only). [oro.open.ac.uk](https://oro.open.ac.uk/59664)
40. Mandanici M, Rodà A, Canazza S. The Harmonic Walk: an interactive physical environment to learn tonal melody accompaniment. Advances in Multimedia; 2016 (abstract only). [research.unipd.it](https://www.research.unipd.it/handle/11577/3172134)
41. Frid E. Accessible digital musical instruments: a review of musical interfaces in inclusive music practice. Multimodal Technologies and Interaction 3(3):57; 2019. [PDF](https://mdpi-res.com/d_attachment/mti/mti-03-00057/article_deploy/mti-03-00057-v4.pdf)
42. Vamvakousis Z, Ramirez R. The EyeHarp: a gaze-controlled digital musical instrument. Frontiers in Psychology 7:906; 2016. [frontiersin.org](https://www.frontiersin.org/articles/10.3389/fpsyg.2016.00906/text)
43. Vogel D, Balakrishnan R. Distant freehand pointing and clicking on very large, high resolution displays. Proc. UIST; 2005:33-42. [PDF](https://www.dgp.toronto.edu/public_user/ravin/papers/uist2005_distantpointing.pdf)
44. Sprague AH, Vogel C, Williams M, Wolf E, Kamper D. Evaluation of commercial camera-based solutions for tracking hand kinematics. Sensors 25:5716; 2025. [PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12473350/)
45. Zhang F, Bazarevsky V, Vakunov A, et al. MediaPipe Hands: on-device real-time hand tracking. arXiv 2006.10214; 2020. [arXiv](https://arxiv.org/pdf/2006.10214)
46. Bachmann D, Weichert F, Rinkenauer G. Evaluation of the Leap Motion Controller as a new contact-free pointing device. Sensors 15(1):214-233; 2015. [PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4327015/)
47. Casiez G, Roussel N, Vogel D. 1€ filter: a simple speed-based low-pass filter for noisy input in interactive systems. Proc. CHI; 2012:2527-2530. [cristal.univ-lille.fr](https://cristal.univ-lille.fr/~casiez/1euro)
48. Jacob RJK. The use of eye movements in human-computer interaction techniques: what you look at is what you get. ACM Transactions on Information Systems 9(3); 1991. [PDF](https://marcjohnson.fr/wp-content/uploads/2020/12/1991-Jacob-The-Use-of-Eye-Movements-in-human-computer-interaction-techniques.pdf)
49. Wessel D, Wright M. Problems and prospects for intimate musical control of computers. Computer Music Journal 26(3); 2002 (NIME 2001). [arXiv](https://arxiv.org/pdf/2010.01570)
50. Jack RH, Mehrabi A, Stockman T, McPherson A. Action-sound latency and the perceived quality of digital musical instruments. Music Perception 36(1); 2018. [PDF](https://qmro.qmul.ac.uk/xmlui/bitstream/handle/123456789/44614/Jack%20Action-sound%20Latency%202018%20Accepted.pdf?sequence=1)
51. McPherson A, Jack R, Moro G. Action-sound latency: are our tools fast enough? Proc. NIME; 2016:20-25. [nime.org](https://nime.org/proc/nime2016_mcpherson/)
52. Mäki-Patola T, Hämäläinen P. Latency tolerance for gesture controlled continuous sound instrument without tactile feedback. Proc. ICMC; 2004. [PDF](https://users.aalto.fi/~hamalap5/publications/icmcarticlefinal10.pdf)
53. Karjalainen M, Mäki-Patola T, Kanerva A, Huovilainen A. Virtual air guitar. Journal of the Audio Engineering Society; 2006 (abstract only). [aes2.org](https://aes2.org/publications/elibrary-page/?id=13884)
