# The theremin's physics, and a theremin played through it

*Research note, October 2026 (#863). The implementation is the physical theremin slice, [`src/slices/theremin/`](../../src/slices/theremin/), seed **Physical Theremin**; the player's page is [`guide/instruments/physical-theremin.md`](../../guide/instruments/physical-theremin.md). The real-hand numbers in §6 are printed by `npx vite-node scripts/stability/theremin.ts` and held by `test/theremin/theremin_stability.test.ts`.*

## 0. What this note answers

The request: look up how a theremin actually works, understand why hand *gestures* and not only hand *positions* correspond to notes, and build that into thoremin. This note (1) sets out the physics of the instrument, (2) explains from that physics why the shape of the hand plays (aerial fingering) and what vibrato, portamento and staccato are on a real theremin, (3) records what thoremin had before, (4) gives the model the implementation uses, with its equations, (5) describes the assistance a modern instrument adds and how it is built here, and (6) reports the measurements on real hand landmarks.

## 1. Headline findings

- **The pitch is a capacitance.** The pitch antenna and the player's hand are the two plates of a capacitor of a few picofarads at most [2], [6]. That capacitor is part of the tank of a radio-frequency oscillator, so it sets its frequency, `f = 1 / (2 pi sqrt(L C))` [1]. A second, fixed oscillator is tuned to the same frequency with the hand away; the two are mixed and the difference, the beat, is the audible note [1], [2], [4]. Typical designs run between 170 kHz and 1 MHz [2]; a lecture demonstration runs at 260 kHz with the variable oscillator moving from 257 to 260 kHz, a beat from about 65 Hz to 3 kHz [4].
- **That is why the field is crowded near the antenna.** For a small hand capacitance the beat is nearly proportional to it, and the capacitance falls roughly as one over the distance near the antenna. Each octave up therefore takes about half the distance of the octave below: lower notes need much bigger moves than high ones [8], [9]. Real instruments partly straighten the field with an inductor in series with the antenna [1], [8].
- **The shape of the hand plays because the hand is the plate.** A capacitance depends on the plates' areas and distances, not on a point. Opening a finger adds its area to the plate and, if it points at the antenna, brings that area closer; closing the hand removes it. Clara Rockmore built her technique on this: the hand held in one place, the intervals played by finger openings ("aerial fingering") [15], [16]. In this model a real signer's open palm sounds **4.9 semitones above their fist** held at the same place (§6), the same order as the "about an octave from open to closed fist" players report [10].
- **Volume is a second capacitor in a tuned circuit.** The volume antenna is part of a circuit tuned to resonance with the hand far away; a hand coming closer adds capacitance, detunes it, and the control voltage, and with it the loudness, falls, to silence a few centimetres from the loop [1], [4], [7].
- **Assistance is a modern addition, and it can be built as a stack of switches that are off at zero.** Moog's Theremini pulls the pitch toward a chosen scale with one knob, from free pitch to locked notes, and at full lock it eliminates vibrato [13]. The implementation here has one assistance level, 0 an exact pass-through, driving pitch correction (with hysteresis), smoothing and a vibrato aid that keeps a real vibrato through the correction. On a real held hand the assistance cuts the note changes from 3.6 to 1.1 per held second at a quarter of full, and to 0.13 at full (§6).

## 2. The physics

### 2.1 Two oscillators and a beat

A theremin's pitch circuit is two radio-frequency oscillators, one fixed and one variable, followed by a mixer (a nonlinear element, a single diode will do) and a low-pass filter [1], [2], [6]. The mixer's output contains the sum and the difference of the two frequencies; the filter keeps the difference. With both oscillators at, say, 260 kHz, a shift of the variable one by 1 kHz is a 1 kHz note [4]. The oscillators sit below 500 kHz in most designs to keep radio interference low [1]; a hobby kit runs at about 165 kHz [3], a student design at 285 kHz [6].

Tuning is a matter of where the beat is zero. The Moog Etherwave's pitch knob moves the fixed oscillator: at "zero beat" the tone stops, and the instrument is tuned so that the hand drawn back to the shoulder sounds one to two octaves below middle C; turning the knob further "reduces the distance, thus compressing the distance between musical intervals" [7].

### 2.2 The antenna is part of the tank

The variable oscillator's frequency is set by an inductance and a capacitance, `f = 1 / (2 pi sqrt(L C))`, and the antenna is part of that capacitance [1]. The bare antenna is about 16 pF (an 18-inch rod [6]); the player is a large grounded plate, with 100 to 200 pF between body and earth [3], so the hand near the antenna adds a capacitance in parallel. Bringing the hand closer raises `C`, lowers the variable oscillator's frequency and raises the beat [3], [4]. The hand's contribution is "typically only a few picofarads" [2]; a student paper gives 1 to 15 pF over the playing range and 0.43 pF with the hand 4 m away [6].

With `C_t` the tank's own capacitance and `C_h` the hand's, the variable frequency is `f_v = f_0 / sqrt(1 + C_h / C_t)`, and with the fixed oscillator at `f_0 + f_null`,

```
beat = f_null + f_0 (1 - 1 / sqrt(1 + C_h / C_t))  ~  f_null + f_0 C_h / (2 C_t)   for C_h << C_t.
```

The pitch is very nearly proportional to the hand's capacitance.

### 2.3 Why the field is not linear

How the hand's capacitance falls with distance depends on the geometry. Two parallel plates give `C = eps0 A / d`, one over the distance; a thin rod and a distant body fall more slowly, closer to a logarithm [6]. Players and course projects describe the result as exponential: the pitch falls fast near the antenna and slowly far from it, so the lower octaves need far larger moves [8], [9]. Combined with §2.2, a `1 / d` capacitance makes the pitch, in semitones, about `-12 log2(d)`: each octave up halves the distance, which is the crowded near field players complain of [10].

Instruments straighten the field with a coil in series with the antenna, which makes the antenna branch a series-tuned circuit whose equivalent capacitance changes faster than the antenna's own [1]. One builder cites a coil of 40 to 50 mH for the purpose [8]; the Etherwave's pitch antenna circuit is described as resonant near 285 kHz [11]. The linearisation is partial and adds a third resonance to tune [1], [10], which is why "pitch field linearity" is a topic of its own among builders [12]. The Claravox Centennial keeps the analog heterodyne oscillators beside DSP ones, with switchable scales and quantisation [14].

### 2.4 The volume loop

The volume circuit is separate [2]. In the classic design a fixed oscillator (about 450 kHz in Moog's) drives an LC circuit that includes the volume antenna, tuned to resonance with the hand far away [4], [6]. The hand adds capacitance, lowers the circuit's natural frequency, detunes it from the oscillator and reduces the voltage across it; a detector turns that voltage into the control voltage of an amplifier [1], [4]. So the loudness falls as the hand comes closer, smoothly, and the sound is silent with the hand two to three inches from the loop [7]. The Etherwave's volume knob is not a level control but a tuning of how the volume responds [7].

## 3. Gestures, not only positions

### 3.1 The hand is a plate, so its shape matters

A capacitance is a property of two conductors' whole geometry. The hand is not a point at a distance: it is a palm and five fingers, each with an area and a distance of its own. Three consequences follow, and players use all three.

- **Finger extension.** An extended finger adds its area to the plate; a finger curled into the palm lies on top of it, partly shielded by it. Opening the hand raises the pitch with the wrist held still: "pitch raised by opening the fist with gradual finger movements" [8].
- **Pointing.** A finger extended toward the antenna puts its area nearer than the palm: the same opening raises the pitch more when the fingers point at the rod.
- **Orientation.** A palm turned to face the antenna presents its whole area; turned edge-on it presents its edge (and still couples through the fringing field).

### 3.2 Aerial fingering

Clara Rockmore made this the basis of a technique: a fingering system that allows fast passages and large leaps without audible portamento, with the right thumb and forefinger tips kept in contact for a steadier tone and vibrato [15]. Her technique is "based on the principle of aerial fingering", only the fingering and volume hands may move, and the body must stay still [16], because any moving body changes the pitch and volume [7]. Carolina Eyck's eight-finger-position technique is in the same line: tune the instrument to the hand and play by finger positions rather than by correcting a note once it is heard [19]. The physics is §3.1: a fixed hand position chooses a region of the field, and the fingers choose the note within it.

### 3.3 Portamento, vibrato and staccato

- **Portamento** is the default. The pitch is continuous in the hand, so a melody is a continuous glide between notes unless the player hides it [8]: Rockmore's fingering avoids it on leaps [15]; the volume hand hides it by dipping during the move.
- **Vibrato** is a rocking of the right hand from the wrist, "several times a second" [7], like a singer's or a violinist's [8]; Rockmore's advice, as players relay it, was a narrow vibrato, fast and in place, not a trill [17]. No theremin-specific rate was found; vibrato in general sits around 6 to 7 Hz, within about 4 to 12 Hz [18].
- **Staccato** is the left hand, taking the volume to zero quickly between notes [8]; Rockmore had Theremin raise her instrument's volume sensitivity for rapid staccato [15].

## 4. What thoremin had

- **The field instruments** (the seeds Pentatonic, Wrist Theremin, Open Air Pad, Finger FX, Pitch Bender and the rest of `src/app/dials/instruments.ts`) share the `voice-mapping` node: the hand's horizontal position in the frame is the pitch, snapped toward a scale by `magnetism`, and its height the volume. **Wrist Theremin** (`guide/instruments/wrist-theremin.md`) reads the wrist instead of the fingertip and gates the voice with a fist. The fingers are routed to effects (brightness, vibrato, pan, a pitch bend) by the hand map. These are theremin-like in what the player does, not in the physics: the pitch is linear in a screen coordinate, the shape of the hand does not change the pitch except through an explicit route, and there is no near-field compression.
- **The air instruments** (`docs/research/air-instruments.md`) cite the theremin as the model for a continuous pitch axis quantised to a scale (the air bass's neck, §7.1 there) and the delayed-theremin latency study, 20 to 30 ms just noticeable, slow vibrato hiding much more [A1 there].
- **The Python `theremin` package** (thorwhalen's video-to-sound theremin, the browser app's predecessor) computes, per hand, a palm centre over the wrist and the five finger bases, finger directions from base to tip, and a palm normal from the wrist and the index and pinky bases, and drives a `pyo` synth. Those three features are what a plate model needs; the browser implementation computes them the same way (the palm centroid over landmarks 0, 5, 9, 13, 17; the normal as the cross product of wrist-to-index-base and wrist-to-pinky-base) and adds finger extension and distance to an electrode.

## 5. The model the implementation uses

Everything here is `src/slices/theremin/lib/physics.ts`; the numbers in brackets are the defaults (the `physicalTheremin` dial).

### 5.1 The hand as plates

MediaPipe gives each hand 21 image keypoints (pixels, with a relative depth) and 21 world keypoints (metres, centred on the hand, axes aligned with the camera). The image says where the hand is in the frame; the world points say how big it is and its shape.

- **Scale.** Metres per pixel at the hand, `s = (|w9 - w0| + |w5 - w17|) / (|k9 - k0| + |k5 - k17|)`: the palm's length and width in world metres over the same in image pixels. Without world points (older fixtures, the synthetic source) the palm length is taken as 0.09 m.
- **Electrodes.** The pitch antenna is a vertical segment in the displayed (mirrored) frame on the player's right [x 0.88, from 0.08 to 0.95 down]; the volume loop a horizontal segment under the left hand [y 0.85, from 0.04 to 0.42 across]. A part of the hand at image point `p` is at distance `d = sqrt((s dist_px(p, electrode))^2 + d_0^2)` from it: the in-plane distance in metres, and a standoff `d_0` [3 cm] out of the plane, because a virtual antenna has no depth, the hand never touches it, and the near field must stay finite (the real hand's closest approach).
- **Finger extension.** For each finger chain (the thumb from its CMC joint, the others from their base), `e = clamp((|tip - base| / path - 0.5) / 0.45, 0, 1)`, the chain's straight span over its length: 1 straight, 0 folded. Scale-free, computed on the world points.
- **Palm facing.** With `n` the palm normal and `u` the axis toward the electrode (`x` for the rod beside the hand, `y` for the loop under it), the palm presents `A_palm (beta + (1 - beta) |n . u|)` of its area [beta 0.4: an edge-on palm still couples through fringing].
- **Areas.** One side of an adult hand: palm 80 cm², thumb 14, index 16, middle 18, ring 16, pinky 11. An extended finger's area `a_f e_f` sits at the middle of its outer two segments; the curled rest `a_f (1 - e_f) gamma` sits on the palm, partly shielded [gamma 0.3].

The hand's capacitance to an electrode is the plate sum, with a coupling factor `kappa` [1] for the geometry (the antenna's sensitivity):

```
C_h = kappa eps0 sum_i a_i / d_i
```

For an open hand facing the rod this gives about 0.17 pF at 50 cm and 1.9 pF at 4 cm, within the ranges reported for real instruments [2], [6].

### 5.2 Pitch

The beat of §2.2 with a carrier `f_0` [260 kHz], a tank `C_t` [120 pF] and a zero beat `f_null` [30 Hz], in fractional MIDI notes, `m_raw = 69 + 12 log2(beat / 440)`. With the raw curve (linearity 0) an open hand facing the rod sounds about E3 at 70 cm, G#3 at 50 cm, B4 at 20 cm, A#5 at 10 cm and C7 at 4 cm: three and a half octaves over half a metre, each octave up at about half the distance.

**Linearity** `g` [0.6] stands in for the series coil. The capacitance is read back as the distance a reference open hand would have, `d_eq = sqrt((kappa eps0 A_ref / C_h)^2 - d_0^2)`, the pitch is taken as a power law in it between the raw curve's own values at a near and a far anchor (5 and 50 cm),

```
m_warp = m(near) + (m(far) - m(near)) (d_eq^g - near^g) / (far^g - near^g),
m = (1 - g) m_raw + g max(m_warp, m(f_null)),
```

so `g = 0` is exactly the raw curve, `g = 1` equal intervals for equal distances, and the anchors keep the range. A finger opened still raises `C_h`, so it lowers `d_eq`: aerial fingering survives the linearisation (and, as on a linearised instrument, a given finger opening spans more semitones far from the rod than near it, where the field has been expanded).

### 5.3 Volume

The left hand's capacitance to the loop, `C_v`, detunes the volume oscillator to `r = f / f_0 = 1 / sqrt(1 + C_v / C_vt)` [C_vt 100 pF] against a circuit tuned to its free frequency; the circuit's response, rectified, opens the amplifier above a floor [0.25]:

```
h = 1 / sqrt(1 + Q^2 (r - 1/r)^2)          [Q 150]
volume = clamp((h - floor) / (1 - floor), 0, 1)
```

Full with no hand, silent with the hand on the loop; with the defaults a palm held flat over the loop gives 29% at 5 cm, 62% at 10, 86% at 20 and 97% at 50 cm. A higher `Q` silences from further away. With the left hand out of view the volume is full (a real loop with no hand near) unless the player chooses silence.

### 5.4 What a camera cannot give, and what stands in

- **Depth to the antenna.** A camera sees the hand's place in the image plane; the rod is drawn in that plane. The standoff `d_0` replaces the missing depth. A hand moved toward the camera is not nearer the virtual rod; its image grows, and the scale `s` grows with it, so its in-plane distance in metres stays about right.
- **The body.** A real theremin feels the whole player (the body is the ground plate [3], a swaying body moves the pitch [7]); here only the hands couple.
- **A lost hand.** A real hand never vanishes, a tracked one does for a frame or two. A lost pitch hand keeps its pitch for 0.3 s, then the voice stops (there is no far field for a missing hand to drone in).

## 6. Assistance, and what it measures

### 6.1 The stages

`src/slices/theremin/lib/assist.ts`, over the pitch in fractional MIDI notes, once per new camera frame:

1. **Vibrato aid.** The pitch is split into a slow centre (a one-pole low-pass at 2.5 Hz) and the wobble around it. Over the last 0.8 s the wobble is detrended (a glide leaves the centre lagging by a steady offset, which is no oscillation) and its normalised autocorrelation searched over lags of the 3.5 to 9 Hz band. A wobble that correlates with itself one period later (above 0.45), with a depth between 0.08 and 1.5 semitones RMS, is a vibrato; the tracker's jitter is as deep and crosses zero as often, but does not correlate one period later. While a vibrato is detected (faded in and out over 0.15 s) the wobble is held out of the next two stages and added back, `1 + 0.5 aid` times as deep.
2. **Smoothing.** The 1-euro filter [20] on what remains, its minimum cutoff falling geometrically from 6 Hz toward 0.4 Hz as the smoothing rises.
3. **Correction.** A pull toward the nearest note of the snap scale (every semitone, or the instrument's scale), `m' = n + (m - n)(1 - strength)`. The note in force is kept until another is nearer by a quarter of the step between them, so a hand held on the border between two notes stays on one.

One `level` (0 to 1) sets the defaults: correction = level, smoothing = 0.8 level, vibrato aid = level, snap = the semitones below 0.5 and the scale from 0.5. Tuning any stage makes them all the player's own (`assist.custom`); level 0 turns all of them off, whatever they are set to, and is an exact pass-through (tested to equality).

### 6.2 On real hands

The real held hand is the stillest second of the signer's open-palm (B) clips in `real_hands_signs` (SignAlphaSet, CC BY 4.0; the fixture's README), played back and forth and placed by script, as the Chord Map's stability stream does (`docs/testing/stability.md`): holds of 2.5 s at four distances from the rod, then a 4 s sweep toward it, through the seed's whole composed graph. Aerial fingering is measured with the same signer's real fist (A) and open palm (B), each held at the same place.

| Assistance | Held warble, cents | Note changes / held s | Sweep order | Open over fist, semitones |
|---|---|---|---|---|
| 0 | 12.7 | 3.63 | 97% | 4.9 |
| 0.25 | 8.6 | 1.13 | 98% | 4.8 |
| 0.5 | 10.8 | 1.13 | 98% | 4.9 |
| 1 | 19.5 | 0.13 | 87% | 5.0 |

*Held warble*: the RMS of the frame-to-frame pitch change while held. *Note changes*: how often the nearest semitone changes while held. *Sweep order*: the share of the sweep's pitch steps that go up, as the hand goes. *Open over fist*: the median pitch of the open palm less the fist's.

Read with care:

- **A real held hand drifts.** Even the stillest second of a real hand wanders by about a semitone in pitch over a hold (its shape and place both move a little), with 13 cents of frame-to-frame warble on top. A pure theremin plays both, which is honest and is why real thereminists train for years.
- **A quarter of the assistance already helps**: the warble falls by a third and the note changes by two thirds, with the sweep still in order.
- **From the middle up the snap is to the scale** (the seed's scale is a pentatonic): note changes fall to one every eight seconds at full assistance, but each is a jump of up to three semitones, so the warble number rises. The sweep at full assistance is a staircase of scale notes; its 87% counts the few steps back at a note boundary and at the sweep's start.
- **Aerial fingering is real and does not depend on the assistance**: about five semitones from fist to open palm on a real hand, at every level.

### 6.3 The tests

`test/theremin/`: the beat formula and its small-signal form, monotonic pitch with distance, the near-field compression (a centimetre near is more than four times the semitones of a centimetre far, raw), linearity evening the intervals, each finger raising the pitch on its own, the palm's facing, the image-only fallback, the volume loop's shape and its `Q`; the assistance's pass-through at 0, snap, hysteresis, smoothing, a 6 Hz vibrato kept through a full correction with the aid and flattened without it, and jitter and glides not taken for vibrato; the seed's composed graph (wiring guard and a real replay); and the relations of §6.2.

## 7. Open questions

- **Listening.** Whether the default calibration (range, linearity, volume curve) and the vibrato aid sound right needs ears and a real camera; it is on the owner's list (#865).
- **A real theremin to compare against.** The model's constants come from published ranges, not from a measured instrument; one measured pitch-versus-distance curve would calibrate the coupling and the falloff.
- **The falloff.** The plate model's `1 / d` is the near-field form; a thin rod falls more slowly far away [6]. A falloff exponent is an easy addition if a comparison asks for it.
- **The left-handed theremin.** Real left-handed instruments exist; swapping the hands is a small dial if a player asks.

## REFERENCES

1. Wikipedia. [Theremin](https://en.wikipedia.org/wiki/Theremin).
2. Physics Today. [Playing with electromagnetic waves: the science of the theremin](https://physicstoday.aip.org/news/playing-with-electromagnetic-waves-the-science-of-the-theremin).
3. Art Theremin. [102 Minimum Theremin: schematic and circuit description](https://theremin.us/Product%20Information/102/102_schematic.html).
4. UCSB Physics Lecture Demonstrations. [Theremin](https://web.physics.ucsb.edu/~lecturedemonstrations/Composer/Pages/60.17.html).
5. Skeldon KD, Reid LM, McInally V, Dougan B, Fulton C. Physics of the Theremin. American Journal of Physics. 1998;66(11):945-955. [doi:10.1119/1.19004](https://doi.org/10.1119/1.19004). (Cited for completeness; not read: paywalled.)
6. Adu, Mendoza, Spalding, Trinh. [Electronic Music Interaction: modern and alternative interactions with music devices](https://www.ece.ucf.edu/seniordesign/su2012fa2012/g01/docs/conferencepaper.pdf). UCF senior design paper.
7. Moog Music. [Setting Up and Playing the Moog Etherwave Theremin](https://r2.gear4music.com/media/8/85856/download_85856.pdf) (user guide).
8. Thereminvox. [Of the theremin and futurist stringed instrument making, p. 5](https://thereminvox.com/stories/tech/of-the-theremin-and-futurist-stringed-instrument-making/5/).
9. UBC PHYS341. [Theremin project](https://wiki.ubc.ca/Courses:PHYS341/2021/Project3).
10. ThereminWorld forum. [The purpose of coils and linearity of the instrument](https://dp6mvjp51jcws.cloudfront.net/Forums/T/31968/the-purpose-of-coils-and-linearity-of-the-instrument) (players' and builders' discussion).
11. [Hot-rodding the Etherwave](https://www.mikrocontroller.net/attachment/161695/HotRodEtherwav.pdf) (builder's document).
12. Becker C. [Ideal Pitch Field Linearity](https://oldtemecula.com/+Pitch%20Field%20Linearity2.pdf) (builder's document).
13. Sound On Sound. [Moog Theremini review](https://www.soundonsound.com/reviews/moog-theremini).
14. MusicTech. [Moog's Claravox Centennial modernises the Theremin](https://musictech.com/news/gear/moog-claravox-centennial-theremin/).
15. Wikipedia. [Clara Rockmore](https://en.wikipedia.org/wiki/Clara_Rockmore).
16. The Juilliard Journal. [On Clara Rockmore](https://journal.juilliard.edu/node/14265).
17. ThereminWorld forum. [Rockmore on vibrato](https://dp6mvjp51jcws.cloudfront.net/Forums/T/24843?Page=0).
18. Music Cognition Group, University of Amsterdam. [Rhythmic aspects of vibrato](https://www.mcg.uva.nl/mcg-2023/papers/dhat-2/dhat-2.html).
19. Eyck C. [The method](https://www.carolinaeyck.com/method) (the eight-finger-position technique; The Art of Playing the Theremin, 2006).
20. Casiez G, Roussel N, Vogel D. 1 € Filter: a simple speed-based low-pass filter for noisy input in interactive systems. Proceedings of CHI 2012. [doi:10.1145/2207676.2208639](https://doi.org/10.1145/2207676.2208639).
