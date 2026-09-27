# @thoremin/dag

The typed dataflow engine thoremin runs on: a TypeScript mirror of the Python `meshed` library. Framework-agnostic and Node-safe: no DOM, no React, no audio.

- `defineNode` with typed ports and a Zod params schema; `NodeRegistry`; `GraphSpec` (nodes and edges as data).
- `Engine`: compiles a spec, ticks it, and reconciles a RUNNING engine onto a new spec in place (`applyGraph`: nodes whose id, type and validated params are unchanged are kept, so a swap reloads no model).
- `Applier` with a `Clock` (`BatchClock`, `RealtimeClock`), sinks and taps; `StreamRecorder` and replay; `runHeadless`.

Consumed by the app through the npm workspace as TypeScript source (no build step). The conceptual model is in `docs/design/component-model.md`.
