# @thoremin/games

The listening games (Sing, Play along, Match the note) as pure sessions, without the instrument around them. Each session is fed the time and what the microphone heard, and returns what to draw and what to play:

```ts
import { createMatchSession, lessonById, drawStage } from '@thoremin/games';

const session = createMatchSession(lessonById('match-triad')!, { start: now });
// every frame:
const { view, cues } = session.tick(now, heard); // heard: pitch frames and onsets since the last tick
drawStage(canvas.getContext('2d')!, { W: canvas.width, H: canvas.height }, view);
for (const c of cues) playNote(c.midi, c.t, c.velocity); // reference notes and count-in clicks
```

- `lesson`, `lessons`: a lesson is data (notes in beats at a tempo, a count-in), written in a compact text (`C4 D4 E4:2`); the shipped lessons.
- `sing`, `play_along`, `match`, `calibrate`: one session per game, judged by `@thoremin/judge`.
- `listen`: what a game hears (`Heard`) and the adapter from the audio seam's events (`heardFrom`).
- `view`: the view model; `stage`: draws it (`drawStage`) and its pure geometry (`layout`).
- `cues`: the sounds a game plays itself (count-in clicks, reference notes), each handed out once, a little ahead.

Times are seconds on the caller's one clock. Dependencies: `@thoremin/judge`, `@thoremin/stats`, `zod`, and a type from `@thoremin/sdk`. Inside thoremin the games slice runs these in a graph node (`src/slices/games/`); `play/` runs them on a bare page with no camera and no app shell. The design is `docs/design/audio-games.md`.
