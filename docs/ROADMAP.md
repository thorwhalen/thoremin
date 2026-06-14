# Thoremin Roadmap

Incremental milestones, each keeping a runnable, testable artifact. Status as of
the foundation build.

| Milestone | Goal | Status |
|-----------|------|--------|
| **M0** | Baseline + layer contract: DAG engine, recorder/replay, pure node library, music theory, headless tests. | ✅ done |
| **M1** | First real video→sound vertical slice in the browser, on-device. | ✅ done (builds + typechecks; live webcam unverified in CI) |
| **M2** | Fixture record/replay infra + persisted per-edge feature streams on disk + CI gate. | ✅ done |
| **M3** | Refactor the working Lyria app (`wips/`) into a `lyria` generative node + `indirect-map` node (indirect mapping / conductor-of-AI). | ⏳ next |
| **M4** | Broaden input/feature layer (`face-features` 52 blendshapes, `pose-features`, `gesture-classifier`) + tonal depth (Tonal.js chords/voicing/progression, Tone.js Transport quantization). | planned |
| **M5** | Conductor mode: immutable `score` node + `performance` overlay (gesture→tempo/dynamics/articulation) + humanization toggle. | planned |
| **M6** | `midi-out` (WEBMIDI.js, Safari/iOS gated); React Flow patcher UI driven by Zod node configs; deploy as a tw_platform static app. | planned |
| **M7** | (optional) Pluggable Python feature service + self-hosted Magenta RT2 generative service behind the existing node facades. | optional |

## M0–M2 delivered

- `src/dag/` — typed Engine (topo-sort, Zod params, cycle + fan-in rejection),
  `defineNode`, `StreamRecorder`, `replayNode`, `runHeadless`, NDJSON.
- Pure nodes: `synthetic-hands`, `replay-source`, `hand-features`,
  `voice-mapping`, `keyboard-control`; `src/music/theory.ts` (magnetic snapping).
- Browser nodes: `webcam-hands` (lazy TF.js), `keyboard-source`,
  `store-controls`, `webaudio-synth`, `canvas-overlay`.
- React shell (`src/app/`) wiring the default instrument graph to webcam +
  Web Audio + canvas overlay + keyboard + a live controls panel.
- `scripts/record_stream.ts` + committed fixtures in `test/fixtures/`.
- 28 passing tests across 6 files (`npm test`), `tsc --noEmit` clean, `vite build` clean.

## Open decisions (recorded; defaults taken)

1. **Lyria API key** — ship key-in-localStorage now (as `wips/` does); thin
   proxy or platform-managed key later. *(gates M3)*
2. **Music theory lib** — keep the hand-rolled snapping on the hot path; add
   Tonal.js for chords/voicing/progression in M4.
3. **Synth engine** — Web Audio oscillator now; adopt Tone.js when richer
   voices/effects/Transport are needed (M4).
4. **On-device vs backend** — frontend-only now; keep node interfaces clean so a
   Python/`theremin` or Magenta-RT2 service can plug in later (M7).
5. **Fixture videos** — commit small derived NDJSON; raw `.mp4`s optional/external.
