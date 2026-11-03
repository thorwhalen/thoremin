# @thoremin/dag

The typed dataflow engine thoremin runs on: a TypeScript mirror of the Python `meshed` library. Framework-agnostic and Node-safe: no DOM, no React, no audio.

- `defineNode` with typed ports and a Zod params schema; `NodeRegistry`; `GraphSpec` (nodes and edges as data).
- `Engine`: compiles a spec, ticks it, and reconciles a RUNNING engine onto a new spec in place (`applyGraph`: nodes whose id, type and validated params are unchanged are kept, so a swap reloads no model).
- `NodeDef.reads`: the host resources (keys of `ctx.resources`) a node NEEDS to produce its outputs, e.g. `reads: ['video']` for a model run on the camera's frames. Advisory like `roles`, never checked by the engine; a host reads it to decide what to acquire before a graph holding the node runs. A resource a node only uses when present is not declared. `readsResource(registry, type, key)` reads it: `true` / `false` for a loaded type, `false` for an unknown one, `undefined` for a lazily declared type not loaded yet.
- `Applier` with a `Clock` (`BatchClock`, `RealtimeClock`), sinks and taps; `StreamRecorder` and replay; `runHeadless`.

Consumed by the app through the npm workspace as TypeScript source (no build step). The conceptual model is in `docs/design/component-model.md`.
