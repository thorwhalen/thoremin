# scripts/demos — generators for the private demo page

Each script turns something that has landed into a short video, GIF or data file for a human to watch and listen to. Everything they write goes under `~/.local/share/thoremin/demos/` and is never committed; YouTube-derived output in particular appears only on a private page.

| script | makes |
|---|---|
| `impact_onsets.ts` | the onsets three timing strategies would sound for one `an.impacts` clip (frame-snapped, predicted, predicted + pulled to the grid), with per-clip errors |
| `render_impact_demo.py` | the clip with its ground truth drawn on (contact plane, exact contact point, a scrolling strip of frame / impact / beat times), optionally with drum hits at one strategy's onsets, at any playback speed |
| `chord_shape_timeline.ts` | per-frame chord-shape predictions for one guitar video, enrolled on the first seconds of each chord and scored on the rest |
| `render_chord_demo.py` | the footage with the hand skeleton, the recognised chord and a synthesised strum of it, the original audio mixed underneath |
| `tour_live.mjs` | a scripted tour of the built bundle with `synthetic-hands`, recording the page's own Web Audio output alongside the screen (Playwright from `smoke/node_modules`) |

```bash
an impacts clip OUT --object stick --kind surface --tempo 0:96,16:132 --beats 16 --pattern 1,0.6,0.8,0.6 --jitter-sd 0.012 --exposure 0.5 --seed 7
npx vite-node scripts/demos/impact_onsets.ts OUT/<clip> onsets.json
python3 scripts/demos/render_impact_demo.py --clip OUT/<clip> --onsets onsets.json --strategy predicted --speed 0.25 --out predicted.slow.mp4
npx vite-node scripts/demos/chord_shape_timeline.ts --video 2pXS8k1zx8U --out timeline.json
python3 scripts/demos/render_chord_demo.py --timeline timeline.json --video V.mp4 --landmarks L.ndjson --start 110 --out guitar.mp4
npm run build && npx vite preview --port 4391 --strictPort &   # then:
node scripts/demos/tour_live.mjs --url http://localhost:4391/thoremin/ --out tour/
```
