---
seed: Physical Theremin
area: field
do:
  - Bring your right hand toward the rod on the right of the video: the closer, the higher the pitch.
  - Hold the hand still and open or close your fingers to play intervals: an open hand sounds higher than a fist.
  - Raise your left hand over the loop at the bottom left for more volume; lower it onto the loop for silence.
settings: Physical theremin
---
A theremin that works the way a real one does. Your hand and the rod are the two plates of an invisible capacitor, and the pitch comes from how much they couple, so both where your hand is and its shape play the note.

:::details How it works
On a real theremin your hand and the pitch antenna form a tiny capacitor, a fraction of a picofarad with the arm stretched out and a few picofarads close by. That capacitor detunes a radio oscillator, and the difference between it and a second, fixed oscillator is the note you hear. This instrument computes the same thing from the camera: each part of your hand (the palm and every finger) adds its area divided by its distance to the rod.

So the field is crowded near the rod: each octave up takes half the distance of the octave below. **Linearity** (in the settings) straightens it out, the way the coil inside a modern theremin does, so equal moves give more even intervals.

Opening a finger adds its area to the plate, so it raises the pitch. That is **aerial fingering**, the technique Clara Rockmore made famous: keep the hand in one place and play the intervals with the fingers. Here a fist sounds about five semitones below an open hand at the same spot. A palm turned to face the rod couples more than one seen edge-on.

The left hand works the volume loop the same way: the nearer it is, the more it detunes the volume circuit and the quieter the sound, down to silence on the loop. With the left hand out of view the sound plays at full volume, as a real theremin does with no hand near the loop. Lower your right hand out of view to stop.

**Vibrato** is a quick, small rocking of the wrist, five or six times a second. **Staccato** is a quick dip of the left hand onto the loop and back.
:::

:::details Assistance
A real theremin has no frets: the note is wherever your hand is, and it slides between notes. **Assistance** adds help a little at a time, from 0 (a pure theremin with no help at all) up to 1:

- **Pitch correction** pulls the pitch toward the nearest note. Low assistance pulls gently toward every semitone; from the middle up it pulls toward the notes of the instrument's scale (set in the Sound section). At full strength it locks onto the note, and a hand held near the border between two notes stays on one of them.
- **Smoothing** quiets the small shake the camera sees in a still hand, while still following a real move.
- **Vibrato aid** notices a real wrist vibrato and keeps it through the correction (a plain pitch correction would flatten it), a little deeper.

The four helpers follow the assistance level until you move one of them yourself; then they are yours, and "Back to the level's defaults" hands them back. Assistance at 0 always turns all of them off.
:::

:::details Settings
**Physical theremin** in the editor: on or off, the assistance and its four helpers, the sound and the volume. Under **Antennas and circuits**: linearity, how sensitive the rod is, the zero beat (the low hum with no hand near; 0 is silence), the pitch circuit's capacitance (a larger one gives a narrower range), how close a hand can come, where the rod stands and how high the loop is, how sharply the loop silences, what happens with the left hand out of view, and whether the antennas and the note readout are drawn on the video.
:::
