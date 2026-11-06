# Codified theremin hand technique: pitch hand and volume hand

The sources behind the Physical Theremin's hand-position library (`src/slices/theremin/lib/poses.ts`): what Clara Rockmore's aerial fingering and Carolina Eyck's eight finger positions are, how sure the sources are, and which public videos show them. The library's `refs` are this note's reference numbers. How the positions were then MEASURED on Eyck's lessons (each frame labelled by the note she sounds) is §7; how the snap uses them is in `src/slices/theremin/lib/pose_snap.ts`. The physics they rest on is `theremin-physics.md`.

Research for (a) an educational guide and (b) a snap-to pose library for a hand-tracking theremin (MediaPipe 21 hand landmarks plus world landmarks in metres). Compiled 2026-11-06.

**How to read this.** Every claim carries a reference number. Short quotations (a phrase or a sentence) are verbatim from the source; everything else is paraphrase. Anything marked **[inference]** is this note's reading, not a source's claim. Confidence levels: **high** means a primary source (the method author's own text or video) states it directly; **medium** means a primary source implies it, or a reliable secondary source states it; **low** means forum testimony or this note's own reconstruction.

**Headline findings.**

- Rockmore's method [1] defines **four numbered positions plus a "half position"**, and these are **relative shape states, not fixed intervals**. The same 1→4 change spans a fourth in a scale study and an octave in an octave or arpeggio study. Moog's 1977 liner notes [2] give the canonical finger-by-finger account of a four-note arpeggio.
- Eyck's system [10] defines **eight positions numbered as the scale degrees of one major-scale octave**. FP1 is the tonic and FP8 is the octave, and the theremin is tuned so that FP1→FP8 is exactly one octave. FP8→FP5 moves only the fingers. FP5→FP1 adds a forearm rotation around a fixed point, wrist extension and finger closing. Each position has a stated hand shape. Kavina's Theremin School uses the same 1–8 numbering [18][19][21].
- Measured theremin vibrato rate: about **7 Hz** (one unnamed professional thereminist [29]). No source gives a measured theremin vibrato depth in cents. Rockmore asks for a vibrato that is narrow and "as fast and as much in place as possible" [1].
- No candidate video is Creative Commons except two: Kurstin's TED talk (CC BY-NC-ND) and the public-domain film of Léon Theremin. Every Rockmore, Eyck and Kavina video found carries the standard YouTube licence.

---

## 1. Clara Rockmore: "aerial fingering"

### 1.1 Sources and their standing

- **[1] Rockmore, *Method for Theremin*** is a primary source. It is her own text, written in the 1990s, dedicated to Robert Moog and originally titled *The Art of the Theremin*. The 1998 free edition is a revised transcription by David Miller and Jeffrey McFarland-Johnson, with "only the slightest changes … to the actual text" (Intro). It is 14 pages long: 12 exercises plus pages on vibrato and practical instructions. The text is sparse, and forum readers call it "rather vague" [7] and "useful only if you can watch video of Clara Rockmore" (paraphrased in [7]).
- **[2] Robert Moog, album notes to *The Art of the Theremin*** (Delos, 1977) is a primary eyewitness account: Moog produced the recording and watched her play. It is quoted verbatim on Delos's own page.
- **[3] Glinsky, *Theremin: Ether Music and Espionage*** (2000), p. 156, is a secondary source quoting a Rockmore interview. Read only as quoted in Wikipedia.
- **[4] Moog Music, Etherwave manual (2021)** is secondary: a modern paraphrase.
- **[6][7][8][9] Theremin World forum** is low-grade testimony. It is useful only to show what practitioners believe.
- No separate written method or position chart from the Nadia Reisenberg/Clara Rockmore Foundation, and no academic paper that codifies Rockmore's positions, was found.

### 1.2 What the Method itself says ([1])

- Exercise 1: hand in first position, with the forefinger resting on the thumb. This is an interval study that uses glissando between notes, taking "great care" not to slide past the note while the left hand stays stationary.
- Exercise 5, the first study in using different finger positions of the right hand:
  - Instead of moving the whole hand, leave it in position 1 (forefinger on thumb). Position 2 comes from moving only the fingers, stretching them forward; position 3 from moving them still further.
  - The "additional explanation" distinguishes **positions** from **fingerings**. Position 1 is the forefinger resting on the thumb. Positions 2, 3 and 4 stretch all three fingers forward (arm at rest) toward the vertical antenna. The fingers may then be moved back, not only to position 1 but all the way to the palm, and for musical effect the contact of fingers with the palm can serve as an accent.
  - The notated pattern is in C major, positions 1-2-3 over C-D-E, D-E-F, E-F-G and so on, ascending and descending (3-2-1). **One position step equals one diatonic scale step.**
- Exercise 7, going from position 1 to position 3 directly: C→E, D→F, E→G and so on. **1→3 is a diatonic third.**
- Exercise 9: a study in positions 1, 2, 3 and 4 and also in half position, which is obtained by stretching the fingers "to a half-tone distance". This is in G major with patterns of four consecutive scale notes (for example G-A-B-C). **1→4 spans a diatonic fourth here**, which matches the forum summary "four finger positions, with a range of a fourth" [7].
- Exercise 10, the "Octave study": finger position 1 to 4 is first played staccato, then the same exercise legato. The slide sound is to be eliminated by opening the left hand during the move between notes and closing it on arrival, keeping the volume even. The pattern is C4 (pos 1), C5 (pos 4), C5 (pos 4), C4 (pos 1). **Here 1→4 is an octave.**
- Exercise 11, an advanced study in quick changes of position: repeated eighth notes on one pitch are marked "4 1 4 1 …". Exercise 12 (daily warm-up) again uses 1→4 for octave leaps and "1 2 1 2 1 2 3 4" in scale runs.
- Closing advice (p. 12): the choice of how to position the right arm or fingers depends "entirely on your musical phrasing". She says to try all alternatives: arm at rest with fingers forward or back, or arm forward or back, with fingers together or stretched forward or back as the music dictates.
- Exercise 4 (left hand): the left hand is raised and dropped sharply on each note, giving a staccato effect. She says to use it "as you would use a violin bow", and that legato, staccato and various accents come from different motions of the hand or fingers.
- Exercise 2: start each note pianissimo and slowly raise, then lower, the left hand, while being very careful to keep the correct pitch with the right hand. This is an independence drill.
- p. 2: fingers should be thought of as "delicate butterfly wings". She also warns that involuntary motion of the head or shoulders can interfere with pitch and volume.

### 1.3 Moog's eyewitness account of the arpeggio ([2])

Moog says Rockmore used fingering patterns for her most rapid passages. For an upward arpeggio, in his account, she moves through these steps:

1. The lowest note is played with the right hand tilted back and the fingers withdrawn.
2. The next note comes from abruptly moving the hand forward from the wrist, with the right arm motionless.
3. The third note comes from rapidly extending the little finger.
4. The fourth note comes from extending one or two more fingers while turning the wrist sideways, which brings the newly extended fingers nearer to the pitch antenna.
5. To continue the arpeggio she moves the whole arm closer to the pitch antenna while drawing the hand and fingers back, then repeats the sequence.

Meanwhile the left hand may articulate each pitch by quickly entering the volume antenna loop and withdrawing, which silences the tone during the brief moves of the right hand between pitches. Moog adds that no other player has mastered the technique, which a reviewer called "aerial fingering".

The term "aerial fingering" is therefore a reviewer's coinage that Moog quotes, not Rockmore's own term.

### 1.4 Rockmore position table

| Position | Finger state (source) | Hand and arm | Pitch meaning | Confidence |
|---|---|---|---|---|
| 1 | Forefinger resting on thumb [1]; Moog's 2021 manual reads this as "a loosely closed fist" with the index on the thumb [4]; forum: "fingers against the thumb" [6] | Arm at rest; arpeggio start "hand tilted back and fingers withdrawn" [2] | Base note of the current group | High (shape), high (role) |
| ½ ("half position") | "stretching the fingers to a half-tone distance" [1] | Arm at rest | +1 semitone from the reference | High (text) / low (exact shape) |
| 2 | "move only the fingers by stretching them forward" [1]: the three fingers (middle, ring, little) reach toward the antenna | Arm at rest | Next scale step in scale passages (Ex. 5, 9) [1]; in Moog's arpeggio the second note comes from the **wrist** moving forward, not the fingers [2] | High (scale role) |
| 3 | Fingers stretched "still further" [1]; in the arpeggio, "extending the little finger" [2] | Arm at rest | Third scale step (Ex. 5) or a diatonic third above pos. 1 (Ex. 7) [1]; third arpeggio note [2] | High |
| 4 | Fingers fully stretched; in the arpeggio, "one or two more fingers" plus "turning the wrist sideways" [2] | Arm at rest; wrist rotation [2] | A fourth above pos. 1 in scale study (Ex. 9) **or an octave above pos. 1** in octave and arpeggio studies (Ex. 10, 12) [1][2] | High that both readings exist; the size depends on context |
| "palm" | Fingers drawn back past position 1 "all the way to the palm"; finger-to-palm contact can serve "as accent" [1] | — | Below position 1 | High |

**Where sources disagree or are vague.**

- **The interval per position is not fixed.** In [1], 1→4 is a fourth in Exercise 9 and an octave in Exercise 10. Moog's arpeggio [2] spans four arpeggio notes (for a root-position triad that is an octave) with four hand states. **[inference]** Rockmore's numbers name *degrees of finger extension within the current hand placement*, not intervals. For a step-wise passage she sizes the extensions to scale steps. For an arpeggio she uses wrist travel plus finger extension to cover an octave. A pose library should therefore not hard-code "position k = n semitones" for Rockmore.
- **Exercise 11** marks alternating positions 4 and 1 on the same repeated pitch. The Method does not explain this. **[inference]** It reads as a drill in changing the hand shape while the arm compensates to hold the pitch, which is a coordination exercise. This is uncertain.
- **Knuckles versus whole fingers.** Forum practitioners say Rockmore's extension is "only the knuckles … never the fingertips" [7] (search excerpt; the thread page itself did not show the quote), and that Peter Pringle "follows Clara Rockmore's example of using knuckle extentions" [6]. A poster named Thierry (Colmar; possibly Thierry Frenkel, unverified) writes: "the system by Clara Rockmore where you extend your knuckles but not the entire fingers", and says Eyck's system "uses knuckles up to about the same range, but continues by extending the whole fingers" [9]. Moog's manual: "tiny knuckle extensions … uncurling her pinky, ring, and middle fingers outward in small steps while keeping her index finger resting on the thumb" [4]. The Method itself says only "stretching them forward" [1]. **[inference]** "Knuckle extension" means extension at the MCP joints while the PIP and DIP joints stay partly flexed.
- **The second arpeggio note.** Moog attributes it to a wrist movement [2]. The Method's scale exercises attribute position 2 to finger stretching [1]. Both can be true: an arpeggio needs a larger step than a scale.
- **How many notes without moving the arm.** A forum poster says "a major third or a fourth", depending on the hand [9]. Moog's arpeggio implies an octave of arpeggio notes per hand cycle [2].

### 1.5 Rockmore's vibrato

- She calls vibrato very important to the desired tone quality, played with the forefinger of the right hand resting on the thumb. She pleads for "not a wide vibrato", but one as fast and as much **in place** as possible, not to be mistaken for a trill. [1]
- A trill should not be a wide vibrato but a very exact distance of either a half tone or a whole tone. [1]
- She says to avoid constant vibrato and to leave areas without it, as the music dictates. [1]
- She kept the tips of her right-hand thumb and forefinger in contact to control vibrato, which gave "a steadier tone" (Glinsky 2000, p. 156, via [3]).
- Forum impressions: "Clara has a VERY fast vibrato" [7]; "Very fast, 1910-esque vibrato" [8]. These are impressions, not measurements.
- The Method does not say which joint produces the vibrato. **[inference]** "In place" together with the closed thumb-forefinger ring suggests a small, fast oscillation of the whole hand rather than a finger wiggle.

### 1.6 Rockmore's range and setup

- She advises tuning "to your own body capacity". For herself she found that to be the G below middle C, giving her three-plus octaves up to the vertical rod and one-plus octave down toward herself. [1] **[inference]** G3 is her reference note at a comfortable middle hand placement, with about 3+ octaves forward and about 1+ octave back.
- Moog: the pitch runs from lower than two octaves below middle C with the right hand back at the shoulder, to approximately 2 1/2 octaves above middle C with the hand barely touching the pitch antenna; complete silence occurs when the hand is "an inch or so" from the loop. [2] This gives roughly 4.5 octaves over the forearm-plus-hand travel.
- She urges the "daring of a diver" in wide jumps without any sliding, aiming not only for the desired note but for the very center of the note. [1]

---

## 2. Carolina Eyck: the eight finger positions

### 2.1 Sources and their standing

- **[10] Eyck, "Theremin Lessons – Playing the Major Scale"**, 13 YouTube videos (2021-03 to 2021-08), is a primary source in her own words. Read through YouTube's auto-captions, checked against the frames. This is the most precise public description of the positions.
- **[12] "How to play a scale on the theremin" (2018)** is a primary short summary.
- **[11] *The Art of Playing the Theremin*** (SERVI Verlag, Berlin, 2006; ISBN 3-933757-08-8; about 90 pages, a €21.95 PDF) is the codified source, but **it was not accessible for this note**. Her site calls the method the "8 finger position technique", invented at 16 [11]. Two forum readers of the 2006 book speak of "9" positions [14][15]. **This discrepancy is unresolved.** **[inference]** The ninth may be one of the "extended positions" she mentions in the lessons, or a lower position.
- Eyck says the 2006 method "refers to the playing technique of her longstanding teacher Lydia Kavina" (press release quoted in [14]).

### 2.2 Common frame ([10])

The wording below is paraphrased from the auto-captions; only short phrases are quoted.

- **Basic arm position (Lesson 03).** She has the player stretch the right arm all the way up, then bring it down so the elbow is next to the body with a bit of space between them and the hand at shoulder level, giving an angle of about 45 degrees between upper and lower arm. Then make a circle with thumb and index finger, close the other fingers, bend the wrist backwards, keep the elbow where it is, and swing the lower arm onto the invisible string. Keeping the 45-degree angle is "very important", because then the arm need not move to play a full scale.
- **The invisible string (Lesson 03).** It is attached to the pitch antenna and runs straight to the body. Its starting point is just below the collarbone next to the shoulder muscle, and it runs horizontally to the antenna.
- **The thumb–index ring (Lesson 04).** All positions have a circle formed by thumb and index finger. It is there to stabilize the hand, giving it "something to hold on to in the air", and it helps show which direction the hand is pointing.
- **The hand as a keyboard (Lesson 04).** An octave is measured by the length of a hand: closing the hand gives the basic note, and opening it gives the octave above.
- **Tuning (Lesson 07).** First put zero beat at the body, "maybe even a bit behind you" (Lesson 02). Then play FP8, go silently to FP5 and FP1, and judge the interval. If it is bigger than an octave, expand the field (pitch knob left). If smaller, compress it (knob right). Repeat until an octave is heard between the two positions.
- **Two movement regimes (Lessons 10, 12).** Between FP8 and FP5 only the fingers move. From FP5 to FP1 the arm rotates, the wrist bends and the fingers close. She also notes that going down is easier than going up, because of the rotation: it is easier to "fall into the one" than to go up to the five.

### 2.3 Eyck position table

The pitch meaning is the major-scale degree above the basic note at FP1. In semitones that is FP1 = 0, FP2 = 2, FP3 = 4, FP4 = 5, FP5 = 7, FP6 = 9, FP7 = 11, FP8 = 12. Eyck names the steps: FP8 to FP7 is a half step and FP7 to FP6 a whole step (Lesson 09), FP5 is "a fourth below the octave" (Lesson 08), and FP3 gives "the major third" (Lesson 10).

| FP | Fingers (middle, ring, little) | Thumb–index ring orientation | Wrist and forearm | Pitch | Source lesson | Confidence |
|---|---|---|---|---|---|---|
| 8 | Stretched out with "a bit of air between the fingers" (closing them gives one note lower); the hand is stretched as far as possible | Lying flat, horizontal (the "eye" of the ring looks up) | Basic arm position; specific points of the hand in line with the invisible string (shown, not named) | Octave (degree 8) | L04 | High |
| 7 | A small movement from 8; she moves only the ring and little fingers and keeps the middle finger straight (her preference; players should check what feels best) | Horizontal | Fingers only | Major 7th (11 st) | L09 | High |
| 6 | Fingers "nicely curled", not crunched together, with a little space between them | Horizontal | Fingers only | Major 6th (9 st) | L09 | High |
| 5 | Close the three fingers until they almost reach the index finger; "imagine you're holding a mandarin" | Horizontal | Fingers only; the center of the frame | Perfect 5th (7 st) | L05, L08 | High |
| 4 | More closed than 5 (shown, not described in words) | Neither vertical nor horizontal, but "a bit angled tilted" | Partial rotation toward FP1: go to FP5, pretend to go to FP1, and stop at FP4 | Perfect 4th (5 st) | L11 | High (role) / medium (shape) |
| 3 | Fingers a bit more closed than in FP5 | The circle is "kind of diagonal" | Partial rotation: imagine going to FP1 and stop when you hear the major third | Major 3rd (4 st) | L10 | High (role) / medium (shape) |
| 2 | Close to 1 (shown, not described in words) | Close to vertical | Approached from FP1: think of going all the way to FP5 but stop at FP2 | Major 2nd (2 st) | L11 | High (role) / low (shape) |
| 1 | Closed | **Vertical** (the circle is no longer horizontal); big hands turn it more toward the body, small hands more to the left | Forearm rotation about a rotation point just above the wrist, in the middle of the hand, that stays in the same spot in space; wrist bent backwards; small hands rotate more | Basic note (0 st) | L03, L06 | High |
| "Extended" 3 / 4 | From FP3 (or FP4), simply stretch out the fingers while keeping the rotation | Diagonal or tilted, as in FP3 or FP4 | — | FP3ext sounds the FP5 pitch; FP4ext sounds the FP6 pitch (on three the fifth, on four the sixth) | L10, L11 | High (stated); "a lot more extended finger positions" exist but are not described |

**[inference]** Moving from FP1 up to FP8 combines three roughly independent degrees of freedom: (1) forearm pronation from a vertical to a horizontal ring plane, about 90°, spread over FP1→FP5; (2) wrist going from extended (bent back) to neutral over FP1→FP5; (3) finger opening at the middle, ring and little fingers over FP5→FP8 and partly over FP1→FP5. Her "extended position" check (FP3 plus fingers stretched equals the FP5 pitch) means the rotation and the finger opening are approximately additive, at about two scale degrees each. This is useful for a model that composes pitch from separate rotation and finger features.

**Hand-size caveats she states herself.** If a student's FP5 looks a bit different from hers, that is fine because hands differ (L05). FP5 is "an approximate position" for now, until adjusted by ear (L05, L08). FP1 may look different depending on hand size (L06). Rein Liu, a forum player, finds positions 7 and 8 hard to vibrate on [17]. bendra dropped positions 6–8 "due to hand pain" [16].

### 2.4 Eyck's left hand (volume)

- She distinguishes movements of the whole arm, of the hand and of the fingers. **Arm:** big dynamics, crescendo and decrescendo, moving the arm "like a wave" or "like wings". **Hand:** more precise articulation such as staccato and portato, done with the hand alone because it moves faster than the arm. Simple note separation is a relaxed hand movement. Staccato is a rapid movement. Portato holds a low note and interrupts it briefly. A further option is to put an attack on the note and let it fade out. **Fingers:** used (especially the middle finger) to shape fast notes and to put accents on specific notes [13]. The auto-caption names the middle finger and then the little finger, so which finger she means is ambiguous; watch [13] at about 1:50–2:30 to resolve it.
- Volume-field details are kept for paid online lessons (L01) and for the book [11]. **No numbered left-hand positions were found in the public material.**

---

## 3. Other codified systems (hand shapes only)

### 3.1 Lydia Kavina (and her Theremin School)

- **Same 1–8 numbering as Eyck.** The Theremin School says the numbering is related to Eyck's "Eight finger method" and "resembles interval names within an octave", adding that "hand shape and use may vary" [18]. Kavina's own exercise sheets label notes in C major with positions: 1 = C4, 8 = C5, 7 = B, 6 = A, 5 = G [19]. Another sheet maps "1-3-5-8 positions" to arpeggio notes [18].
- **Position 1:** "close fingers of your pitch hand into the fist" (B01). **Position 8:** the middle, ring and little fingers stretched "towards the antennae", the thumb and forefinger optionally kept together "to stabilise the hand" (B01). Practise 1↔8 "until the octave they produce is clean" [18].
- **From her lesson video [21]:** Each finger position lies between the closed hand and the outstretched, open hand. Closed-hand movements are more secure and stable; she says to "imagine you are holding a hammer", with a firm hand and a strong wrist, and calls this position one. To reach one octave you need only open the fingers and slightly tilt the wrist, without moving the whole arm. A little ring may be made by keeping thumb and finger joined, and most players hold their fingers in this ring shape. She also says to tune the instrument so that an octave can be played by moving only the fingers from the closed hand to stretched-out fingers while bending the wrist. Open finger positions with a bent wrist are less comfortable, so avoid holding the wrist bent for long periods; open positions are good for quick jumps.
- **Difference from Eyck.** Kavina describes the octave as finger opening plus wrist tilt. She does not describe Eyck's explicit forearm rotation of the ring from vertical to horizontal. Her FP1 is a firm "hammer" fist. Eyck's FP1 is a closed hand with a vertical ring and the wrist bent back. **[inference]** These are the same family; Eyck codified the rotation component more explicitly.
- **Volume hand [21].** Arm movements are "very free and relaxed". The wrist moves from a dropped position to a straight one; to make sound, the wrist is fixed straight, and it is not bent backwards. Small wrist movements separate repeated notes and give staccato and accents. She warns against separating each melody note by symmetrical movements of both hands, which "sounds silly". The rhythm of the melody comes from quick movements of the right-hand fingers.
- **Vibrato [21][20][22].** One way is to move the arm back and forth, as when changing pitch, with a very slight movement. Another way is side to side, perpendicular to the invisible string. In both cases the movement comes from the arm, and under no circumstances from the hand controlled by the wrist. In a cello register she moves "in the direction of the antenna"; in a higher, flute-like register, "side to side". Vibrato is "always supported by a change in dynamics" and not used "on each note".
- Earlier Kavina instructional video, not reviewed: *Mastering the Theremin* (Big Briar), referenced in [5].

### 3.2 Moog manuals

- **Older Etherwave sheet [5].** Stand slightly left of centre; with the right arm fully extended the knuckles should just touch the pitch antenna; the right shoulder is about 24" from the pitch antenna; a hand at the shoulder gives "about one to two octaves below middle C"; the volume falls silent when the left hand is two to three inches from the volume antenna, and 8 inches above the loop gives "a noticeable reduction". Vibrato: move the right hand back and forth from the wrist, several times a second, "even and steady". Also: avoid producing vibrato continuously, and impart expressive nuance by shaping the amount and rate of vibrato.
- **2021 Etherwave manual [4].** Rest position with the pointer finger resting on the thumb. Subtly moving a knuckle or slightly extending the pinky is all that is required to reach the next note, while opening the fist and spreading the fingers can raise the pitch by "a full octave". Rockmore paraphrase: see §1.4. Volume hand: keep the motion mainly in the wrist rather than raising the whole forearm, so that one can go from full mute to maximum loudness "with just a flip of the wrist". Vibrato: one that is too wide, covering several steps, is a trill; using only the wrist "can become painful", so leave the wrist relaxed and flexible and use mainly forearm movements. **This contradicts the older sheet [5]**, which says to vibrate from the wrist. Kavina sides with the forearm [21].

### 3.3 Thierry Frenkel, Dorit Chrysler, Pamelia Kurstin

- **Frenkel.** No codified hand-shape system was found. He is known for instrument electronics (ESPE01, EPVM1345 modules). The only related remark is the forum post by "Thierry" (Colmar) in [9], quoted in §1.4.
- **Chrysler.** No codified hand shapes were found. Her Claravox tutorial [28] covers setup only: the lowest note ideally starts where the arm rests on the shoulder, and the hand positions venture out from there "along this invisible line". She plays left-handed, so her pitch hand is the mirror image.
- **Kurstin** (Etherwave Pro DVD with Bob Moog [27]). This is not a numbered system. Her points: she keeps her arms rested on her body, and in a jump she tries to use the fingers alone as much as she can. On volume, she uses the thumb as "the other reference plane" to hit against with two fingers, which marks full volume. She creates a legato illusion by "rais[ing] the volume a little bit more for the notes". Practise without vibrato first, then add a small one. Forum observers describe her as "stretching her fingers sideways towards the antenna" [6].

---

## 4. Quantities for a model

| Quantity | Value | Source | Confidence |
|---|---|---|---|
| Positions in Rockmore's system | 4 plus a half position (½ = one semitone stretch) | [1] | High |
| Rockmore interval per position | Context-dependent: one diatonic step per position in scales (1→4 = a fourth); 1→4 = an octave in octave and arpeggio studies | [1][2] | High that both exist |
| Positions in Eyck's system | 8 (FP1–FP8), plus unnamed "extended" positions; 2006 book reportedly "9" | [10][11][14][15] | High (8 in videos) / unresolved (book) |
| Eyck and Kavina semitones per position | Major-scale degrees: 0, 2, 4, 5, 7, 9, 11, 12 | [10][19] | High |
| Hand span (FP1→FP8, fingers plus wrist, arm still) | One octave, by design of the tuning | [10][21][4] | High |
| Notes reachable by knuckles only (Rockmore style) | "a major third or a fourth", depending on the hand | [9] | Low |
| Full pitch range across the arm | From below C2 (hand at shoulder) to about F#6/G6 (touching the antenna), i.e. about 4.5 octaves | [2] | Medium (one instrument, one tuning) |
| Rockmore's personal tuning | G3 reference; 3+ octaves forward, 1+ octave back | [1] | High |
| Usable range of modern instruments | "up to six octaves … rarely more than five" | [31] | Medium |
| Distance–pitch nonlinearity | "Notes get closer together in the higher octaves as the hand approaches the antenna" [31]; "the highest octave … might be spread over only a few centimeters"; on instruments with good linearity, consecutive notes are equally spaced [30]; "in some types of theremin the octave might be played comfortably only within a limited range" [21] | [30][31][21] | Medium (qualitative only; no distance–frequency law found stated in an accessible source; Skeldon et al. [32] is the standard physics reference but was not accessed) |
| Zero-beat placement | At the body or slightly behind it (Eyck) [10]; at about shoulder level (Kavina) [21]; lowest note where the arm rests at the shoulder (Chrysler) [28]; hand at the shoulder ≈ 1–2 octaves below middle C (Moog) [5] | as listed | High |
| Vibrato rate | About 7 Hz on average for one professional thereminist playing *Le Cygne* at 10 tempi; rate consistent across repetitions, slightly higher at the extreme tempi | [29] (Desain, Aarts, Honing, Timmers 1999) | Medium (n = 1) |
| Vibrato rate, older Moog advice | "several times a second" | [5] | Low precision |
| Vibrato rate, Rockmore | "as fast … as possible" [1]; "VERY fast" [7] | [1][7] | Qualitative |
| Vibrato depth | **No measured theremin value found.** Rockmore: "not a wide vibrato … as much in place as possible", narrower than a trill (a half or whole tone) [1]. Moog 2021: wider than "several steps" is a trill [4]. A forum player limits his vibrato to "not more than a semitone in either direction" [17]. Analysis threshold in [29]: extent > 0.1 semitone, general maximum about 1.5 semitones | [1][4][17][29] | Low. **[inference]** Default ±15–40 cents for a "classical" Rockmore-style vibrato, under 100 cents total; treat as a tunable parameter. |
| Vibrato mechanics | Arm or forearm (Kavina [21], Moog 2021 [4]) versus wrist (older Moog [5]); direction toward the antenna or side to side [21]; Rockmore: thumb–forefinger closed [1][3] | as listed | High that the sources disagree |
| Volume silence distance | About 1 inch from the loop on Rockmore's instrument [2]; 2–3 inches on an Etherwave [5] | [2][5] | Medium (instrument-specific) |

---

## 5. Videos for measuring technique

**Licences.** The licence of each YouTube video was read with `yt-dlp`, which fills its `license` field only when YouTube marks a video Creative Commons. All YouTube candidates came back empty, which means the **standard YouTube licence**. Commons and Internet Archive licences come from their own metadata APIs. Camera angle and hand visibility were checked on 20-frame contact sheets per video. **Timestamps are approximate, ±5 s**, and come from contact-sheet sampling and caption times.

Ranked by how measurable the pitch hand's finger states are:

| Rank | Video | Performer | Hands and camera | Timestamps (right-hand fingering) | Licence |
|---|---|---|---|---|---|
| 1 | "Theremin Lessons – Playing the Major Scale", 13 videos [10]. Best: L04 FP8 https://www.youtube.com/watch?v=X8PHe5axqMs, L05 FP5 https://www.youtube.com/watch?v=UMl2fPtjDV4, L06 FP1 https://www.youtube.com/watch?v=iOm_5bNSRqs, L07 tuning https://www.youtube.com/watch?v=LQI2kazeM_A, L08 https://www.youtube.com/watch?v=UWYaOP0uoR4, L09 FP7/6 https://www.youtube.com/watch?v=0iXmUrlwOOY, L10 FP3 https://www.youtube.com/watch?v=7hw9QDCikoQ, L11 FP2/4 https://www.youtube.com/watch?v=ifB8R0jMKZ8, L12 scale https://www.youtube.com/watch?v=_tXD5tXTFRs | Carolina Eyck | 1080p; seated, frontal, medium shot, steady; both hands and the pitch antenna in frame; pitch hand on screen-left. L04 has a close-up side view of FP8 at about 3:19. On-screen position labels in L12 ("3-2-3" ≈2:35, "5-6-5" ≈2:49, "7-6-5-7" ≈3:17, "8" ≈3:31) | L04 1:40–4:10; L05 1:10–3:00; L06 1:20–3:40 (rotation); L07 1:30–3:15 (with sound: FP8, FP5, FP1); L08 1:20–3:40 (sound); L09 1:10–4:50; L10 2:00–4:00; L11 1:10–4:40; L12 1:20–3:40 (full scale, sound) | Standard YouTube |
| 2 | "Theremin – Lydia Kavina plays 'The Swan' (Saint-Saëns)", Classic FM, https://www.youtube.com/watch?v=GzeFQLJezk0 [23] | Lydia Kavina | 1080p; standing; wide frontal shots alternating with **tight close-ups of the pitch hand** (≈0:16, 0:41, 0:57, 1:46) and of the volume hand (≈1:14, 1:30, 2:03–2:11); clean white background; real performance with audio | Close-ups listed; frontal wide shots ≈0:00–0:10, 0:25, 0:49, 1:05, 1:22, 1:38, 2:20 | Standard YouTube |
| 3 | "Lydia Kavina \| THEREMIN Lesson \| With Subtitles", https://www.youtube.com/watch?v=UssbUN6bUdI [21] | Lydia Kavina | 1080p; standing, frontal, very steady; both hands in frame, white background; side shots near the end | Positions 1→2→3→4→5 demonstrated with sound 8:40–9:40; one-octave finger opening 7:40–8:30; larger intervals 10:00–10:30; volume wrist 14:40–15:30; vibrato 17:20–18:50 | Standard YouTube |
| 4 | "How to play a scale on the theremin \| Carolina talks Theremin", https://www.youtube.com/watch?v=0n-o71RUrQw [12] | Carolina Eyck | 1080p; standing, frontal, plus a **side/oblique angle** ≈1:34–1:53; both hands | FP1/FP8 0:35–0:50; scale by opening the hand 1:00–1:55 | Standard YouTube |
| 5 | "Clara Rockmore \| The Swan", Moog Music, https://www.youtube.com/watch?v=XdFSU8sn3mo [24] (filmed by Bob Moog in her apartment, 1976; restored 1998) | Clara Rockmore | 480p (638×480); seated, frontal, medium shot, steady; both hands visible; pitch hand on screen-left; the hand is small in frame, so expect noisy finger landmarks | Whole performance ≈0:10–3:00 | Standard YouTube (© 1998 Big Briar in the end card) |
| 6 | "Léon Theremin playing Theremin", Wikimedia Commons https://commons.wikimedia.org/wiki/File:Leon-Theremin-playing-Theremin.ogg ; also Internet Archive https://archive.org/details/LeonThereminPlayingHisOwnInstrument [25] | Léon Theremin | 384×288; standing, frontal, static camera; both hands clearly in frame; thumb–index ring grip visible on the pitch hand. Not a codified method | Playing ≈0:14–1:32 | **Public domain** (Commons: "Public domain"; IA: Public Domain Mark 1.0). Date given as "1920s" (Commons) or 1928 (IA); the opening shows an older Theremin, so the date is uncertain |
| 7 | "Theremin lesson for beginner \| Lydia Kavina", https://www.youtube.com/watch?v=DhAHIMHel7U [22] | Lydia Kavina | 1080p; standing, frontal, with some side and close shots (≈2:36, ≈7:50 close on the pitch hand) | Finger movements 5:37–6:30; volume 6:34–7:40; vibrato 7:43–8:30 (chapters in the description) | Standard YouTube |
| 8 | "Pamelia Kurstin plays the theremin" (TED 2002), Internet Archive https://archive.org/details/PameliaKurstin_2002 ; YouTube https://www.youtube.com/watch?v=X-ywH1Vj8_U [26] | Pamelia Kurstin | Standing, front-left angle, several camera cuts and close-ups; YouTube copy only 432×240 | Throughout, 19 min (a non-classical, sideways-finger style) | **CC BY-NC-ND 3.0** (IA metadata); YouTube shows the standard licence |
| 9 | "Left hand articulation on the theremin", https://www.youtube.com/watch?v=szFEwzEcwJ0 [13] | Carolina Eyck | 1080p, frontal (not frame-checked) | **Volume hand**: arm 0:10–0:40, hand articulations 0:40–1:45, finger accents 1:50–2:30 | Standard YouTube |
| 10 | "Theremin Tutorial by Pamelia Kurstin and Bob Moog", https://www.youtube.com/watch?v=TOWtJURUaKg [27] | Pamelia Kurstin (with Bob Moog) | 480p; varied angles, some hand close-ups | Volume ≈24:00–26:00; fingers ≈29:30–30:10; vibrato ≈32:50–36:30 | Standard YouTube; **re-upload of a commercial Moog DVD by a third party**, so rights are unclear |

**Checked and rejected:**

- "Clara Rockmore plays Tchaikovsky Berceuse" https://www.youtube.com/watch?v=6-T2R830QnU is a still photograph over audio [34].
- Commons "Saw & Theremin Duo Performance" (CC BY 3.0) is too distant and too dark [33].
- Dorit Chrysler's Claravox tutorial [28] (4K, left-handed) is mostly controls, with a few hand close-ups; low value.
- *Theremin: An Electronic Odyssey* (1993, Rockmore footage) is copyrighted, and no licence is stated on its IA copy.

**No Creative Commons or public-domain recording of a codified method (Rockmore, Eyck or Kavina) was found.** The licensed-for-reuse options are #6 (public domain, uncodified) and #8 (CC BY-NC-ND, non-classical). For measurement only, without redistribution, #1–#5 are the strongest.

**[inference] Measurement notes.** Eyck's L07, L08 and L12 put *sound and hand shape together*, so pitch from audio (for example CREPE or pYIN) can label each frame's position, giving a supervised FP1–FP8 dataset. L04–L06 and L09–L11 show the shapes, partly in silence. Kavina's Classic FM close-ups are the sharpest view of real-performance finger states. Rockmore's Swan is the only footage of the method's author, and it is low-resolution.

---

## 6. Machine-usable sketch for the pose library [inference throughout]

These are feature definitions for MediaPipe hand landmarks (0 wrist; 4 thumb tip; 5, 9, 13, 17 MCPs; 8, 12, 16, 20 tips). They are this note's proposal, built from the sourced descriptions above; the library replaced them with the measured shapes of §7 for Eyck.

- `ring_closed`: distance(4, 8) divided by palm span (|0–9|) is under a threshold. True in every Rockmore and Eyck position [1][10]; optional for Kavina [21].
- `ext_m, ext_r, ext_l`: per-finger extension in [0, 1], from the MCP angle (Rockmore's "knuckle" extension) and the PIP angle (Eyck and Kavina whole-finger extension) of the middle, ring and little fingers.
- `spread`: mean angular gap between the middle, ring and little fingers. Eyck's FP8 needs "air between the fingers"; closing them lowers the note by one step [10].
- `ring_roll`: angle of the thumb–index ring plane relative to horizontal. Take the normal of the plane through landmarks 2, 4, 5 and 8 in world coordinates: about 0° (horizontal) for Eyck FP5–8, diagonal for FP3–4, about 90° (vertical) for FP1 [10].
- `wrist_ext`: wrist extension angle. Bent back at FP1 (Eyck) [10]; Kavina adds wrist tilt for the upper part of the octave [21].

```yaml
systems:
  eyck:                     # source [10]; semitones above FP1
    pitch_semitones: {1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11, 8: 12}
    tuning_rule: "pitch knob set so that FP1 -> FP8 is exactly one octave"
    poses:
      FP8: {ring_closed: true, ext: [1.0, 1.0, 1.0], spread: high, ring_roll_deg: 0,  wrist_ext: neutral}
      FP7: {ring_closed: true, ext: [1.0, 0.8, 0.8], spread: mid,  ring_roll_deg: 0,  wrist_ext: neutral}   # Eyck curls ring+little only
      FP6: {ring_closed: true, ext: [0.6, 0.6, 0.6], spread: low,  ring_roll_deg: 0,  wrist_ext: neutral}   # "nicely curled", gaps kept
      FP5: {ring_closed: true, ext: [0.3, 0.3, 0.3], spread: low,  ring_roll_deg: 0,  wrist_ext: neutral}   # "holding a mandarin"
      FP4: {ring_closed: true, ext: [0.25, 0.25, 0.25], ring_roll_deg: 30, wrist_ext: slight}  # "tilted" (angle estimated)
      FP3: {ring_closed: true, ext: [0.2, 0.2, 0.2],    ring_roll_deg: 45, wrist_ext: slight}  # "diagonal"
      FP2: {ring_closed: true, ext: [0.1, 0.1, 0.1],    ring_roll_deg: 70, wrist_ext: mostly_back}
      FP1: {ring_closed: true, ext: [0.0, 0.0, 0.0],    ring_roll_deg: 90, wrist_ext: back}    # "vertical", hand bent backwards
    extended: {FP3_ext: 7, FP4_ext: 9}   # FP3 + fingers stretched = FP5 pitch; FP4 + stretched = FP6 pitch
  rockmore:                 # source [1][2]; relative states, interval set by context
    poses:
      P1:   {index_on_thumb: true, ext: [0.0, 0.0, 0.0], hand_tilt: back}
      Phalf: {index_on_thumb: true, ext: "half-tone stretch"}
      P2:   {index_on_thumb: true, ext: [0.33, 0.33, 0.33], mode: knuckle}
      P3:   {index_on_thumb: true, ext: [0.66, 0.66, 0.66], mode: knuckle}   # arpeggio: little finger leads
      P4:   {index_on_thumb: true, ext: [1.0, 1.0, 1.0], mode: knuckle, wrist_turn: sideways}
      palm: {fingers_touch_palm: true}    # below P1; contact used as an accent
    interval_per_step:
      scale: "one diatonic step"         # Ex. 5, 9
      arpeggio: "one chord tone"         # Moog 1977; 1->4 spans an octave (Ex. 10)
  vibrato:
    rate_hz: {default: 7.0, range: [5.0, 8.0]}  # 7 Hz measured [29]; range assumed
    depth_cents: {default: 25, max: 100}        # no theremin measurement exists; Rockmore: narrow, "in place"
    driver: arm                                 # Kavina/Moog 2021; older Moog: wrist
```

Snap-strength semantics follow from the pedagogy. Eyck says FP5 is "an approximate position" that the player adjusts by ear (L05, L08), and that positions are personal. So the library should store **per-user calibrated poses**: record FP1, FP5 and FP8 first, as Eyck teaches, then the in-between positions. Snapping should pull toward the *pitch* of the nearest calibrated position, not toward a canonical hand geometry.

## 7. Measured on Eyck's lessons

The library's Eyck shapes are measured, not guessed. Method, all in `scripts/theremin/`:

1. The twelve videos of `sources.json` were downloaded for analysis only and kept on one machine; the hands, pose and face landmark streams were extracted with `scripts/video_streams.py`. Neither the videos nor the streams are committed (thoremin-recordings ADR 0002); only the numbers below are, in `src/slices/theremin/lib/pose_measurements.json`, with each measured video credited (performer, title, URL, licence).
2. `label_pitch.py` labels each video's audio with the note sounded (pYIN, C3 to C6, notes held at least 0.3 s).
3. `measure_poses.ts` labels a frame with the position whose degree is the note above the video's tonic (C4 in the 2021 lessons, F♯4 in the 2018 video [12]), drops 0.12 s at each end of a note (the glide), and computes the pitch hand's features with the instrument's own code (`hand_pose.ts`). Dropped: the tuning lesson (L07: she turns the knobs until each position sounds its note, so there the note does not name the position); the series' opening jingle and the short melody every 2021 lesson repeats after its spoken intro (the same clip in every video; its notes are too short to give labelled frames here, but it is dropped so it can never sit on both sides of the held-out split); the two Kavina videos (they set no tonic, so a note does not name a position).

5,608 frames from 8 videos (L05 and L06 give under ten each, being mostly talk). Median and spread (median absolute deviation scaled to a standard deviation) of each feature:

| FP | frames | index open | middle open | ring open | little open | thumb–index gap (palms) | knuckle line from horizontal (°) |
|---|---|---|---|---|---|---|---|
| 1 | 1110 | 0.38 ±0.11 | 0.00 ±0.00 | 0.00 ±0.00 | 0.00 ±0.00 | 0.38 ±0.09 | 21 ±4 |
| 2 | 313 | 0.36 ±0.08 | 0.18 ±0.24 | 0.22 ±0.26 | 0.28 ±0.24 | 0.17 ±0.11 | 31 ±10 |
| 3 | 413 | 0.33 ±0.09 | 0.19 ±0.13 | 0.28 ±0.13 | 0.31 ±0.14 | 0.19 ±0.10 | 32 ±5 |
| 4 | 384 | 0.35 ±0.05 | 0.23 ±0.10 | 0.33 ±0.10 | 0.35 ±0.10 | 0.14 ±0.06 | 43 ±8 |
| 5 | 998 | 0.31 ±0.06 | 0.22 ±0.11 | 0.32 ±0.15 | 0.47 ±0.21 | 0.37 ±0.14 | 83 ±6 |
| 6 | 357 | 0.43 ±0.06 | 0.45 ±0.17 | 0.57 ±0.14 | 0.64 ±0.07 | 0.17 ±0.04 | 80 ±7 |
| 7 | 559 | 0.57 ±0.04 | 0.70 ±0.03 | 0.74 ±0.05 | 0.62 ±0.05 | 0.16 ±0.07 | 68 ±5 |
| 8 | 1474 | 0.53 ±0.04 | 0.68 ±0.04 | 0.74 ±0.04 | 0.68 ±0.06 | 0.22 ±0.05 | 74 ±3 |

What this confirms of §2.3. From FP1 to FP5 the hand turns: the knuckle line goes from near horizontal (21°) to near vertical (83°). That is her ring going from vertical to horizontal, seen from the knuckles: with the ring lying flat the palm faces the antenna and the knuckles stack vertically. (§6 sketched the angle of the ring's plane, the complement of this one; the measured feature is the knuckle line because the tracker gives it reliably.) From FP5 to FP8 the fingers open (middle 0.22 to 0.68) while the turn stays. FP1's middle, ring and little fingers read fully closed in most frames (median and spread both 0; the classifier floors every spread at about the tracker's jitter, 0.1 of a finger's opening, so a fist read a little open is still FP1). No finger reads more than about 0.75 open on a tracked hand: Rockmore's shapes, which cannot be measured (no recording shows her fingering clearly enough), are written on this measured scale.

How well the shapes name a position. Each video held out in turn, scored by the instrument's own classifier against the centroids of the others: 67% of frames on the right position, 90% within one. The pose snap takes a position only on a reading at least as confident as its threshold, held 0.12 s; the threshold's trade-off:

| confidence at least | frames read | of those, right |
|---|---|---|
| 0.3 | 70% | 80% |
| 0.5 (the snap's) | 56% | 86% |
| 0.7 | 39% | 89% |

Pooled, those numbers are carried by FP1 and FP8, which are almost half the frames. Per position, at the snap's threshold:

| FP | sure readings of it | right | mostly mistaken for | sure readings naming it | of those, it |
|---|---|---|---|---|---|
| 1 | 740 | 98% | FP2 | 775 | 93% |
| 2 | 96 | 27% | FP1 | 96 | 27% |
| 3 | 97 | 33% | FP2 | 65 | 49% |
| 4 | 170 | 84% | FP3 | 168 | 85% |
| 5 | 781 | 80% | FP6 | 662 | 95% |
| 6 | 191 | 93% | FP5 | 358 | 49% |
| 7 | 194 | 81% | FP6 | 176 | 90% |
| 8 | 845 | 94% | FP7 | 814 | 97% |

The last column is what the snap rests on: when the classifier names a position, how often the hand is in it. FP2, FP3 and FP6 fall below 70% (frames of their neighbours are read as them), so the snap shows them but does not pull them (`POSE_SNAP_TUNING.minPrecision`); it pulls FP1, FP4, FP5, FP7 and FP8. Two causes of the confusions, not separated here: neighbouring positions are close (FP2's shape is near FP1's, §2.3), and the labels are noisy (her "extended" FP3 sounds FP5's note with an FP3 turn, §2.3, and is labelled FP5). Among the six videos with more than 300 labelled frames, the held-out accuracy ranges from 39% (L10, FP3) to 87% (L08, adjusting FP5). This is one player's hand; Eyck says positions differ with hand size (§2.3), so a player's own calibration would beat these centroids, as §6 recommends. The snap is off by default (`positions.snap` 0).

Reproduce: fetch the URLs in `sources.json`, extract with `scripts/video_streams.py`, then `python scripts/theremin/label_pitch.py` and `npx vite-node scripts/theremin/measure_poses.ts --write`.

---

## REFERENCES

1. Rockmore C. *Method for Theremin* (originally *The Art of the Theremin*). Revised transcription by Miller D, McFarland-Johnson J. Shreveport (LA): 1998. Free PDF: [Method.pdf](http://www.electrotheremin.com/Method.pdf); download page: [electrotheremin.com/claramethod.html](http://www.electrotheremin.com/claramethod.html).
2. Moog R. Album notes to Rockmore C, *The Art of the Theremin* (Delos, 1977), excerpt posted by Delos Productions, 2010-03-12: [delosmusic.com/?p=349](https://delosmusic.com/?p=349) (now redirects; read from the [Wayback copy](https://web.archive.org/web/2020/https://delosmusic.com/?p=349)).
3. Wikipedia. [Clara Rockmore](https://en.wikipedia.org/wiki/Clara_Rockmore), citing Glinsky A. *Theremin: Ether Music and Espionage*. Urbana: University of Illinois Press; 2000. p. 156; and Moog's 1977 liner notes.
4. Moog Music. *Etherwave Theremin user manual*. Asheville (NC): Moog Music; 2021. Mirror: [MOOG ETHERWAVE THEREMIN manual.pdf](https://muzcentre.ru/download/pdf/MOOG%20ETHERWAVE%20THEREMIN%20manual.pdf).
5. Moog Music. *Setting up and playing the Moog Etherwave Theremin* (older owner's sheet). Mirror: [gear4music PDF](https://r2.gear4music.com/media/8/85856/download_85856.pdf).
6. Theremin World forum. [Aerial Fingering Technique](http://www.thereminworld.com/Forums/T/24739/aerial-fingering-technique) (2005).
7. Theremin World forum. [Clara Rockmore's method](http://www.thereminworld.com/Forums/T/24843/clara-rockmores-method) (2011).
8. Theremin World forum. [Clara's technique – Drawing parallels with the violin](http://www.thereminworld.com/Forums/T/24776) (2007).
9. Theremin World forum. [# of notes played without moving arm](http://www.thereminworld.com/Forums/T/24815/of-notes-played-without-moving-arm) (2010).
10. Eyck C. [Theremin Lessons – Playing the Major Scale](https://www.youtube.com/playlist?list=PLO67K64m9F4UEiJLd_QArZ8owpBfoeIvY) (13 videos, YouTube, 2021-03-04 to 2021-08-12).
11. Eyck C. [Theremin Method](https://www.carolinaeyck.com/method): *The Art of Playing the Theremin / Die Kunst des Thereminspiels*. Berlin: SERVI Verlag; 2006. ISBN 3-933757-08-8.
12. Eyck C. [How to play a scale on the theremin](https://www.youtube.com/watch?v=0n-o71RUrQw) (YouTube, 2018-11-22).
13. Eyck C. [Left hand articulation on the theremin](https://www.youtube.com/watch?v=szFEwzEcwJ0) (YouTube, 2018-11-26).
14. Theremin World forum. [theremin method by Carolina Eyck](http://www.thereminworld.com/Forums/T/24745/theremin-method-by-carolina-eyck) (2006).
15. Theremin World forum. [The Art of Playing the Theremin book](http://www.thereminworld.com/Forums/T/27285/the-art-of-playing-the-theremin-book) (2007).
16. Theremin World forum. [Let's Do a Survey of Your Playing Techniques!](http://www.thereminworld.com/Forums/T/32832/lets-do-a-survey-of-your-playing-techniques) (2019–2020).
17. Theremin World forum. [Struggling about Vibrato / Fingering Techniques](http://www.thereminworld.com/Forums/T/33028/struggling-about-vibrato-fingering-techniques---hello-from-a-chinese-newcomer) (2020).
18. Kavina L (site). Free Online Theremin Course, [B – Finger technique](https://thereminschool.com/courses/b-finger-technique/), including [B01 1st and 8th positions](https://thereminschool.com/courses/b-finger-technique/exercises/b01-1st-and-8th-positions-2/) and [B06 1-3-5-8 positions](https://thereminschool.com/courses/b-finger-technique/exercises/b06-1-3-5-8-positions-2/).
19. Kavina L. [Exercise for opened finger positions](https://thereminschool.com/wp-content/uploads/2025/11/B08-Exercise-for-opened-finger-positions-1.pdf) (PDF score with position numbers).
20. Theremin School. [F – Vibrato](https://thereminschool.com/courses/f-vibrato/).
21. Kavina L. [THEREMIN Lesson | With Subtitles](https://www.youtube.com/watch?v=UssbUN6bUdI) (YouTube, 2021-01-15).
22. Kavina L. [Theremin lesson for beginner](https://www.youtube.com/watch?v=DhAHIMHel7U) (YouTube, 2024-01-26).
23. Classic FM. [Theremin – Lydia Kavina plays 'The Swan' (Saint-Saëns)](https://www.youtube.com/watch?v=GzeFQLJezk0) (YouTube, 2020-03-03).
24. Moog Music. [Clara Rockmore | The Swan](https://www.youtube.com/watch?v=XdFSU8sn3mo) (recorded 1976, restored 1998; YouTube 2020-04-30).
25. [Léon Theremin playing Theremin](https://commons.wikimedia.org/wiki/File:Leon-Theremin-playing-Theremin.ogg) (Wikimedia Commons, public domain); [Internet Archive copy](https://archive.org/details/LeonThereminPlayingHisOwnInstrument) (Public Domain Mark).
26. Kurstin P. [Pamelia Kurstin plays the theremin](https://archive.org/details/PameliaKurstin_2002) (TED 2002; Internet Archive, CC BY-NC-ND 3.0); [YouTube (TED)](https://www.youtube.com/watch?v=X-ywH1Vj8_U).
27. Kurstin P, Moog R. [Theremin Tutorial by Pamelia Kurstin and Bob Moog](https://www.youtube.com/watch?v=TOWtJURUaKg) (Etherwave Pro DVD, third-party re-upload, 2020).
28. Chrysler D. [Claravox Tutorial](https://www.youtube.com/watch?v=y3fqdCnRwo0) (Moog Music, 2022).
29. Desain P, Aarts R, Honing H, Timmers R. [Rhythmic aspects of vibrato](https://www.mcg.uva.nl/mcg-2023/papers/dhat-2/dhat-2.html). In: Desain P, Windsor WL, editors. *Rhythm Perception and Production*. Lisse: Swets & Zeitlinger; 1999. p. 203–216.
30. Ross E. [Composing for the Theremin: Some Practical Issues](https://newmusicusa.org/nmbx/composing-for-the-theremin-some-practical-issues/). NewMusicBox; 2008-11-05.
31. Alonso-Pérez S. [Playing with electromagnetic waves: The science of the theremin](https://physicstoday.aip.org/news/playing-with-electromagnetic-waves-the-science-of-the-theremin). Physics Today; 2025-09-25.
32. Skeldon KD, Reid LM, McInally V, Dougan B, Fulton C. Physics of the theremin. *Am J Phys*. 1998;66(11):945–955. [doi:10.1119/1.19004](https://doi.org/10.1119/1.19004) (not accessed; listed as the standard physics reference).
33. Makkonen A. [Saw & Theremin Duo Performance](https://commons.wikimedia.org/wiki/File:Saw_%26_Theremin_Duo_Performance.webm) (Wikimedia Commons, CC BY 3.0); rejected as unmeasurable.
34. [Clara Rockmore plays Tchaikovsky "Berceuse"](https://www.youtube.com/watch?v=6-T2R830QnU) (YouTube); rejected, still image only.
