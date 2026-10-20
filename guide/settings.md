---
title: Settings
---

The instrument editor (the Edit button next to an instrument) is made of sections. Each page about an instrument says which ones matter for it. Every knob is in [the manual](manual:); this page says what each section is for.

## Sound {#sound}

Per voice (right and left): the root note, the scale (major, minor, pentatonic, blues, chromatic...), the octave range, the base octave and the sound (the timbre); the master volume sits at the top. *Sync both hands* makes the left voice copy the right.

## Hand {#hand}

Where the note comes from (the index fingertip or the steadier wrist), the maximum volume, the stereo pan spread, a handedness dwell that stops the camera swapping left and right, and what the open hand, the pinch, the closed fist and the position on screen do. Each finger can also be routed to an effect: brightness, vibrato, pan, pitch bend, octave or gate, continuous or as a trigger, with its own sensitivity.

## Face {#face}

What the face does: nothing; *timbre* (a smile brightens, an open mouth adds vibrato); *chord* (an expression plays a chord of the key); or *controls* (a deliberate head, jaw or brow pose plays a chord). Plus the chord sound, volume, voicing (open, bass + triad, close, shell, power, voice-led), the rendering (sustained pad, strum, arpeggio up, down or up-down, pulse, alberti) and which chord each expression plays.

## Overlay {#overlay}

What is drawn on the video: the video itself, the hand landmarks, the control markers, pitch and scale guides, chord names, the keyboard strip, the face mesh, the finger lines and bars. Switch things off for a clean picture.

## Keyboard {#keyboard}

The keyboard shortcuts, listed. See also [Commands](tool:commands).

## Air drum {#air-drum}

Switch the drum on; choose which hand strikes, each hand's drum sound (right: kick, left: snare), the stick point (wrist, index fingertip or stick tip), how fast a stroke must be to sound at full volume, how far ahead a hit is committed (Lead), how much the timing is pulled to the beat; the pads (move, resize, stack, give each a sound); whether the pads and sticks are drawn on the video; saved pad layouts; and the pattern trainer.

## Air bass {#air-bass}

Switch the bass on; choose the plucking hand and the point that plucks, how far apart the hands are at the highest and the lowest note (in palm widths), and the volume. The notes themselves are the Sound section's scale.

## Air guitar {#air-guitar}

Switch the guitar on; choose the strumming hand and point, the volume, teach your chord shapes (enrol them one by one) or run the chord sequence trainer.

## Air flute {#air-flute}

Switch the flute on; choose how a note is started (your blowing mouth, or fingers only: a held fingering sounds on its own), the volume, teach your fingerings and your blowing mouth, pick a wind instrument's fingering chart as a guide, show the breath cue, and run the sequence trainer.

## Chord map {#chord-map}

The chord map's own settings; the key is the **Sound** section's root and scale, and the way a held chord sounds (sustained or arpeggiated, its voicing and tempo) is there too.

- **Layout**: the honeycomb map, where every chord's neighbours are the other six; one row by fifths; or one row in scale order. **Letters** keeps the map in place when the key changes, so a new key lights up the chords it changes instead of moving everything.
- **Hold or strum**: hold a chord and play a melody over it, or strum it like the air guitar.
- **Which hand points**, and with what: the palm or a fingertip. **Chord size**: bigger chords are easier to hit, smaller ones show more of the map.
- **Move captions**: the words on each move from the chord you hold. **Intervals** says the move in scale steps (4th up, 3rd down); **Computed** says what it does: how many notes it keeps, whether it turns darker or brighter, and how expected it is after the chord you hold (Piston's table of usual progressions).
- **Trail to follow**: a well-known chord path (Pachelbel's Canon, the Romanesca, the circle of fifths, the Andalusian cadence, the fifties progression...) drawn ahead of your chord as a dashed trail. Play the next chord on it and the trail moves on; wander off and it waits where you left it. **Trail length** is how many chords ahead it shows.
- **Torus**: the seven chords drawn on a slowly turning ring-shaped surface above the map. On it every chord touches all six others, and the three loops are the three kinds of move (by a second, a third, a fourth), the same three directions as the honeycomb. The loop of the move you just made lights up. **Torus turns** sets its speed (0 holds it still).
- **Melody**: on or off, its notes (the chord's tones, a pentatonic, the whole scale, or chosen by tilting the hand), its volume. **Seventh chords** turns the key's chords into sevenths. Also: draw the map on the video, the chords' share of the screen and the strum volume.
- **Face**: whether your face colours the chords (a smile major, a frown minor; an open mouth with raised brows adds a seventh, then a ninth), and whether it is read against your face at rest.
- **What chooses the chords**: your hand, a MIDI keyboard (Chrome or Edge), the microphone, or your signs: fingerspell a letter A to G and that letter's chord in the key lights up while your other hand plays over it (turn on **Sign language** too). **Chords from**: the key's seven, or a pentatonic's own five.
- **Timing**: what keeps the beat (the Chord sound's tempo, a song loaded in the Song tool, or the conductor while you conduct), and whether a new chord waits for the next beat.
- **Grid on the video**: draw the map over the video, or play it undrawn.

## Chord wheel {#chord-wheel}

The chord wheel's own settings; the key and how chords sound are in **Sound**.

- **Moves**: the key's six moves, or the Tonnetz's, which leave the key one or two changed notes at a time.
- **Steering**: your hand, your face, or both, your signs, or your poses; which hand and which point of it; the wheel's size; and how far to push and how long to hold before a hand move is made. With signs, a fingerspelled letter A to G goes to that letter's chord in the key, and the next letter goes straight on (turn on **Sign language** too). With your poses, your first pose makes the top move, the next pose the next move clockwise (choose the poses in **Pose categorizer**).
- **Order**: the moves in a fixed place, or the likeliest next chord on top. **Surprise** brings rarer moves to the top, from this setting, your other hand's height, or your face.
- **Tension**: a number under each chord saying how far it is from home, and which model measures it (the models disagree, so the model is always named).
- **Walk on the beat**: a push held out keeps making that move, every one to four beats.
- **Timing**: what keeps the beat for arpeggios and walks (the Chord sound's tempo, a song loaded in the Song tool, or the conductor while you conduct).

## Chord chart {#chord-chart}

For conducting a piece's chords (it needs the **Conductor**, which chooses the piece and the parts).

- **Play the chord chart**: on or off.
- **A chord every**: how much of the piece is read as one chord, every beat for fast harmony, two beats or a bar for slow.
- How the chord sounds (its voicing and arpeggio) is the chord sound in **Sound**.

## Sign language {#sign-language}

Switch the ASL reader on, include the movement signs (J, Z and the words), set how confident and how smooth the reading must be, and choose whether A to G play chords, whether the chord holds between letters, and the key, sound and volume of those chords.

## MIDI {#midi}

Send the voices you hear to an external instrument or a music program. Off by default; it needs a browser with Web MIDI (Chrome and Edge, not Safari). A device plugged in later appears after you switch MIDI off and on.

## Generative {#generative}

Steer an AI music model with your gestures. Off by default; it needs your own Google API key (the Assistant's key serves both), and says plainly when it cannot connect.

## Body {#body}

Turn on body tracking (the most expensive thing the app can run, so it is off until you ask), choose the model (lite or full), and route a body feature to a sound aspect.

## Conductor {#conductor}

Switch conducting on, choose the piece, the orchestra and its parts, conduct with the hand or the body, where the loudness comes from, and how closely the score follows you.

## Face categorizer {#face-categorizer}

Choose which of your saved face models the instrument plays, and which chord each of its groups plays.

## Pose categorizer {#pose-categorizer}

Choose which of your saved pose models the instrument plays, and whether it starts, holds and cuts off the conductor.

## Categorizer chords {#categorizer-chords}

The chords your own categories play, one degree of the key per group. Besides your own hand-shape and pose categorizers, **Chords from** lists two shipped examples (a few hand shapes, a few poses), which the Hand-shape Chords and Pose Chords instruments play.

