# @thoremin/ext-patcher

The Patcher tool (#14, v1 scope decided on #181): the instrument's LIVE composed graph drawn with React Flow (`@xyflow/react`), and an inspector for the node the player clicks.

- **The graph** is the one the engine runs. A status hook keyed to the trunk's `ui` node receives the engine, which also answers `currentGraph()` and `graphVersion()`; the sink compares one integer per tick and publishes the spec to a zustand store only when the engine commits a new graph (`src/app/liveGraph.ts`). No host seam and no app import.
- **The layout** is layered by longest path from a source, delayed (feedback) edges left out (`src/lib/layout.ts`).
- **The inspector** shows the node's live outputs (polled at 4 Hz), its inputs, its build-time params (read-only) and the dials that feed it: the `store-controls` ports wired into the node, matched to the dials form's field keys by name or through `DERIVED_PORT_DIALS` (`src/lib/inspect.ts`). Controls are generated from the form's field config (widget, enum values, bounds); a structured dial is walked to its scalar leaves. Every write is a dispatch (`dispatchDialSet`, `dispatchDialSetIn`); `test/patcher/patcher_shell.test.tsx` and the write-path guard hold it.
- **Out of scope (v2)**: rewiring edges, adding or removing nodes, editing spec params, saving a `GraphSpec`.

A LAZY, tool-only extension: the eager stubs (`src/index.ts`, `src/ui.tsx`, `src/tools.ts`) are about 0.3 kB; the React half and React Flow load the first time the tool opens (`npm run check:lazy`). Imports only the SDK packages.
