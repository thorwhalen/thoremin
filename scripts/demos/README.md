# scripts/demos — generators for the private demo page

Each script turns something that has landed into a short video, GIF or data file for a human to watch and listen to. Everything they write goes under `~/.local/share/thoremin/demos/` and is never committed; YouTube-derived output in particular appears only on a private page.

| script | makes |
|---|---|
| `impact_onsets.ts` | the onsets three timing strategies would sound for one `an.impacts` clip (frame-snapped, predicted, predicted + pulled to the grid), with per-clip errors |
| `render_impact_demo.py` | the clip with its ground truth drawn on (contact plane, exact contact point, a scrolling strip of frame / impact / beat times), optionally with drum hits at one strategy's onsets, at any playback speed |
| `air_drum_hits.ts` | the hits the shipped `air-drum` node plays over one `an.impacts` clip, with a simulated capture-to-tick delay and an optional pull toward a beat follower; same file shape as `impact_onsets.ts` |
| `chord_shape_timeline.ts` | per-frame chord-shape predictions for one guitar video, enrolled on the first seconds of each chord and scored on the rest |
| `render_chord_demo.py` | the footage with the hand skeleton, the recognised chord and a synthesised strum of it (or, with `--voice bass|flute`, the recognised pitch class as a single note), the original audio mixed underneath |
| `air_pitch_timeline.ts` | one leave-one-player-out fold of the bass or flute pitch model, per frame, in the chord-timeline shape |
| `drum_strokes_timeline.ts` | a drums source's wrist strokes, their drum assignment and (for real footage) the audio onsets, as `eval_drum_strokes.ts` computes them |
| `render_drum_demo.py` | the footage with the pose arms and a ring per stroke; real footage in stereo (recording left, a click per stroke right), air footage with a synthetic kit per assigned drum |
| `instrument_take.ts` | a scripted performance on the air drum (pads: centre/rim, soft/hard), air bass or air guitar, played through the production graph headless; the node's events and the frames to draw |
| `offline_audio/` + `render_take_audio.mjs` | those events played through the shipped WebAudio sinks (`drum-out`, `pluck-out`) in an `OfflineAudioContext`, under the Vite dev server, to a WAV |
| `render_take_video.py` | the take drawn on a mirrored stage (pads, stick, hands, neck, chord) with each sound labelled, muxed with its WAV |
| `tour_air.mjs` | the built bundle's Air instruments group and the pad editor (place, move, resize, recolour), recorded with step marks and crop boxes |
| `tour_live.mjs` | a scripted tour of the built bundle with `synthetic-hands`, recording the page's own Web Audio output alongside the screen (Playwright from `smoke/node_modules`) |

```bash
OUT=~/.local/share/thoremin/demos   # never inside the repo
an impacts clip $OUT/clips --object stick --kind surface --tempo 0:96,16:132 --beats 16 --pattern 1,0.6,0.8,0.6 --jitter-sd 0.012 --exposure 0.5 --seed 7
npx vite-node scripts/demos/impact_onsets.ts $OUT/clips/<clip> $OUT/onsets.json
python3 scripts/demos/render_impact_demo.py --clip $OUT/clips/<clip> --onsets $OUT/onsets.json --strategy predicted --speed 0.25 --out $OUT/predicted.slow.mp4
npx vite-node scripts/demos/air_drum_hits.ts $OUT/clips/<air clip> $OUT/drum.json --name lat40 --latency 0.04
python3 scripts/demos/render_impact_demo.py --clip $OUT/clips/<air clip> --onsets $OUT/drum.json --strategy lat40 --sound kick --out $OUT/airdrum.lat40.mp4
npx vite-node scripts/demos/chord_shape_timeline.ts --video 2pXS8k1zx8U   # -> $OUT/guitar/2pXS8k1zx8U.timeline.json
python3 scripts/demos/render_chord_demo.py --timeline $OUT/guitar/2pXS8k1zx8U.timeline.json --video V.mp4 --landmarks L.ndjson --start 110 --out $OUT/guitar/guitar.mp4
npm run build && npx vite preview --port 4391 --strictPort &   # then:
node scripts/demos/tour_live.mjs --url http://localhost:4391/thoremin/ --out $OUT/tour
node scripts/demos/tour_air.mjs            # same server; -> $OUT/round3/tour
npx vite-node scripts/demos/instrument_take.ts --instrument drums   # or bass, guitar
npx vite --port 4392 --strictPort &   # the offline-audio harness
node scripts/demos/render_take_audio.mjs $OUT/round3/drums.take.json $OUT/round3/drums.wav
python3 scripts/demos/render_take_video.py --take $OUT/round3/drums.take.json --wav $OUT/round3/drums.wav --out $OUT/round3/drums.mp4
```
