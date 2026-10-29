# @thoremin/judge

The pure half of a music game or lesson: is the player on time, on pitch, and how do we know the latency? Input-agnostic and dependency-free apart from `@thoremin/stats`.

```ts
import { judgeOnsets, scoreJudgments, AUDIO_ONSET_WINDOWS } from '@thoremin/judge';

const targets = [0, 0.5, 1, 1.5].map((t, id) => ({ id, t }));
const { judgments, strays } = judgeOnsets(targets, [{ t: 0.01 }, { t: 0.55 }, { t: 1.2 }], { windows: AUDIO_ONSET_WINDOWS });
scoreJudgments(judgments, strays.length).accuracy;
```

- `windows` — tiers tight to loose with early and late half-widths in seconds; `windowsInBeats` for tempo-relative tiers; presets for microphone onsets.
- `onsets` — `createOnsetJudge` (live: `hit`, `advance`) and `judgeOnsets` (a whole take); `nearest` or `lock` matching, lanes, strays and misses.
- `score` — accuracy, tier counts, combo, the mean and spread of the offsets (early / late).
- `pitch` — `judgePitchNote` / `judgePitchLine` by the share of a note's time on pitch (cents tolerance, octave folding), `liveReading` for a visual, `midiOf` / `hzOf` / `centsOff`.
- `calibration` — `estimateOffset(references, responses)`: a tap-along or loopback take turned into an offset with a spread, refused when it cannot be trusted; `clickTimes`.

Times are seconds on the caller's one clock; the judge never reads a clock. The design is in `docs/design/audio-games.md`; the research behind the numbers in `docs/research/music-games-from-audio.md`.
