# Component model: superseding "the six layers"

> Status: design record (2026-06-23). Expands and supersedes the "six layers"
> framing in [Discussion #3](https://github.com/thorwhalen/thoremin/discussions/3)
> and the table in `docs/ARCHITECTURE.md`. Outcome of a multi-lens architecture
> review of the live code against #3.

## TL;DR

The engine is a **DAG**, not a linear stack — the code already proves it. So we
stop talking about *layers* (which implies "a stage only sees its neighbours")
and talk about **components** (DAG nodes) carrying **roles** (descriptive tags),
composed of **elements** (toggled functions inside a node), exposing **options**
(tunable params), saved as **presets** (named settings instances), and swapped
via **slots** (named, role-typed swap points in the graph builder).

"Layer" survives **only** as onboarding prose for the default signal-flow story
(`source → feature → mapping → music → synth/overlay`). It is never again a
code-level abstraction.

## Why "layer" is the wrong noun (the evidence)

The production graph (`src/app/graph.ts`) is already non-linear:

- `cam.hands` fans out to **both** `feat` and `overlay`.
- `feat.features` fans out to **both** `map` and `overlay`.
- `map.params` fans out to **both** `synth` and `overlay`.
- `overlay` fans **in** from five producers (hands, features, params, scale,
  octaveShift) — it is the graph's real merge point.
- control sources (`kbd → kctrl`, `ui`) inject *sideways* into `map`.

A "layer N talks only to N±1" model is false on day one. The `overlay` node
alone consumes from a *source*, a *feature* extractor, a *mapping*, and
*controls* — i.e. it already spans what #3 called four separate layers. That is
the clearest sign roles belong on nodes as metadata, not as positions in a stack.

## The vocabulary (adopt these words, retire the rest)

| Term | Meaning | In code |
|------|---------|---------|
| **Component** | A node instance wired into the graph (user-facing word for "node") | `NodeSpec` over a `NodeDef` |
| **Role** | Descriptive tag(s) a node **definition** carries; a node may have **several** | `roles?: Role[]` on `NodeDef` (advisory, like `PortSpec.kind` today) |
| **Kind** | The data contract on a **port** (already exists) — *do not reuse for nodes* | `PortSpec.kind` |
| **Element** (sub-component) | A toggled, parameterized function **inside one component** — not a separate node | e.g. an `OverlayElement` in `canvas-overlay` |
| **Option** | One tunable param → one UI control | one Zod field |
| **Preset** | A named, saved, full settings instance | a record in a zodal collection |
| **Sub-preset** *(later)* | A named saved subtree (one slot's choice+options, one element config) | a smaller collection record |
| **Slot** | A named, role-typed swap point the graph builder fills from config/settings | a key in a `slots` table in `graph.ts` |

> **Terminology footgun (unanimous across all review lenses):** `kind` is
> already taken by `PortSpec.kind` (the port data contract). Use **`role`** for
> nodes. Never add a node-level `kind` field.

## Roles

Roles are **advisory metadata** — they never gate engine execution (mirroring the
existing "`kind` is not enforced in v0" stance). They power three things:
docs/onboarding, a `registry.listByRole(role)` view, and (eventually) the
settings swap UI.

A node carries a **set** of roles (this is how the DAG's "lots of grey area"
resolves — a node can legitimately be source + feature, or sink + generate):

| Role | What it does | Examples |
|------|--------------|----------|
| `source` | Originates a stream the graph consumes (sensor, replay, keyboard, the UI store) | `webcam-hands`, `synthetic-hands`, `replay-source`, `keyboard-source`, `store-controls` |
| `feature` | Extracts structured features from a source frame | `hand-features`, `face-features`, `gesture-classifier` |
| `mapping` | Turns features+control into sound/visual params | `voice-mapping`, `indirect-map` |
| `music` | Musical rules/constraints (scale-snap, chords, voicing) — a *soft* boundary with `mapping`; a node may carry both | `chord`, `progression`, `score` |
| `synth` | Renders params into audio | `webaudio-synth`, `lyria` |
| `overlay` | Renders the visual canvas | `canvas-overlay` |

Cross-cutting **modifier** tags (orthogonal, combine with the above):

- `control` — a side-input that *steers* a mapping rather than carrying the main
  signal (magnetism, octave, mute, scale/instrument selection). Explains why
  `kctrl`/`ui` wire sideways into `map` without it being a "layer violation".
- `generate` — a node that *invents* new material non-deterministically (Lyria,
  future Magenta). Flags edges as **not** bit-reproducible for the record/replay
  test harness.

> **Governance rule (the one that keeps this from sprawling):** a role becomes a
> user-facing **swap point** (gets a settings dropdown) **only when ≥2
> interchangeable implementations actually exist** that the user would choose
> among. Until then it's a fixed component with options. Add a *new* role only
> under the same test. We split #3's old `output` into `synth` + `overlay`
> because the user tunes sound and visuals in entirely separate panels; we keep
> `mapping`/`music` as distinct names but treat their boundary as soft
> (multi-role nodes).

## Two corrections that reshape the plan

The review's adversarial verification pass surfaced two problems that **every**
optimistic "swapping is just a config flip" claim glossed. Both are prerequisites,
not afterthoughts.

### 1. The interchangeable mappings are **not** edge-stable yet

`voice-mapping`, `chord`, and `score` all *emit* the same `synth-params` output
contract — so people assume they're drop-in. But their **input** ports differ:
`voice-mapping` takes `magnetism`, `octaveShift`, `mute`, `scaleRight`, `scaleLeft`,
`soundRight`, `soundLeft` (plus an optional `face`) side-inputs; `chord`/`score` do
not. Repointing a `slot` from `voice-mapping` to `chord` would leave **7 `ui → map`
edges** wired to input ports that don't exist on the new node → `validateEdge` throws.

> Port names updated 2026-07-12: the timbre ports are `soundRight`/`soundLeft` since
> the "instrument" → "sound" rename (PR #73), and the side-inputs all come from `ui`
> (`store-controls`) — the `kctrl` keyboard node was retired by #90.

**Implication:** "one-string swap, zero edge changes" is false until the
interchangeable nodes share an explicit **input + params contract** (a named,
exported `PortSpec[]`/schema the alternatives spread). Fixing that contract is
the real load-bearing work that makes node-swapping safe — and it must come
*before* any slot machinery.

### 2. The registry is a hand-listed array, not a discovery seam

`CORE_NODES` (`src/nodes/index.ts`) and `BROWSER_NODES` (`src/nodes/browser.ts`)
are hand-maintained arrays. There is **no** folder/entry-point scan. So "tag a
node with a role and it auto-appears in settings" assumes a discovery mechanism
that does not exist. True open-closed/third-party extensibility needs a
registration seam added first. (We don't need third-party plugins yet — but the
docs must not *claim* open-closed before the seam exists.)

## Sub-components are functions inside a node — **not** DAG nodes

The single strongest consensus across all review lenses: **overlay pieces (and
similar "pipeline of small same-shaped pieces") are toggled functions composed
inside one node, never separate DAG nodes.** Two reasons:

1. The engine **rejects fan-in to a single input port** (`engine.ts`). Five
   element-nodes cannot all feed one `<canvas>` without an artificial merge node.
2. Elements share hot state (the 2D context, the mirror transform, one
   `clearRect`, z-order) — promoting them to nodes buys nothing testable and
   loses the natural z-ordering and the generated settings panel.

**Promotion rule:** a piece graduates from element → node *only* when something
**outside** the node must consume, tap/record, or re-rate it. "Edge-worthy → node;
brushstroke-worthy → element."

### Worked example: the overlay

`canvas-overlay` stays **one** node whose `make()` composes an ordered list:

```ts
type OverlayElement = (g: CanvasRenderingContext2D, ctx: {
  W: number; H: number; inputs: OverlayInputs; params: OverlayParams;
}) => void;

const elements: OverlayElement[] = [
  videoBackdrop,      // grey-out = its `alpha` option (already `videoAlpha`)
  scaleGuide,         // the "fretboard" vertical lines (existing drawGuide)
  scaleGuideLabels,   // note names — split OUT of scaleGuide as its own toggle
  indexFingerGuide,   // NEW: the prior-art dashed vertical line to the edge
  landmarkDots,       // existing
  controlMarkers,     // existing drawMarker (ring=openness, fill=pinch, note label)
];
```

- `drawGuide` / `drawMarker` are already local closures — this is **extraction,
  not invention**.
- z-order = list order. Each element is gated by its own `enabled` option and
  carries its own sub-params (a per-element Zod object).
- **The video grey-out slider** the user asked for is just `videoBackdrop`'s
  `alpha` option exposed as a control (the `videoAlpha` param already exists).
- The **per-overlay settings panel** is generated from that list of per-element
  sub-schemas: one collapsible section per element (master toggle + its options).

### The "old overlay" the user remembers

It is **not** in the DAG overlay — it lives in the legacy
`src/components/Theremin.tsx` (the pre-DAG app). It draws, per index fingertip: a
**dashed (`[5,5]`) vertical line from the fingertip to the top edge (right hand)
or bottom edge (left hand)**, a tip dot, and a hand label, in the hand's colour.
(No code ever drew full-width horizontal lines, a frame, or corner `fillRect`
ticks — the remembered "ticks at the extremes" is that dashed line terminating at
the top/bottom edge.) Reconstruct it as the new `indexFingerGuide` element — note
the keypoint-access convention differs (legacy uses `keypoint.name`, the DAG uses
`LM.index_tip = 8`).

## Settings & persistence — the zodal way

The user's directive: **everything to do with persistence and collections goes
through zodal** — express the *affordances* first (a Zod schema), then choose a
storage *target* (localStorage now; files/cloud later) behind a stable contract,
then choose the *UI* behind those affordances.

### What operations do we need?

Two stores, not one:

1. **Live settings** (the current control state): hot, read every tick. Stays in
   the existing **zustand** store — `getState()` per tick must stay synchronous.
2. **Named presets** (a *collection* of saved settings): `list`, `get(name)`,
   `put`, `delete`. This is what zustand+persist can't do today.

### The zodal mapping

- **Affordances:** one `SettingsSchema` (Zod) is the SSOT — `{ slots, per-component
  options, overlay.elements[] }`. `zod` is already a dependency.
- **Collection:** `@zodal/core` `defineCollection(SettingsSchema)`; each preset is a
  record keyed by name. (Published on npm @ 0.1.2.)
- **Storage target (swappable):** `@zodal/store`'s `DataProvider<T>` contract
  (`getList/getOne/create/update/delete`) — identical across backends, so moving
  from localStorage → files → cloud never touches settings code. *Default target =
  localStorage.*
- **UI:** `@zodal/ui` generators (`toFormConfig`) → renderers. Schema-driven, so
  the form follows the affordances.

### Integration reality (decided)

- `@zodal/core`, `@zodal/store`, `@zodal/ui` **are** published on npm (0.1.2) →
  install directly.
- `@zodal/store-localstorage` and `@zodal/ui-shadcn` are **not** published (exist
  locally @ 0.1.0). Per the ecosystem's storage-facade + zodal-development policy
  (build capabilities *in* zodal, don't inline in the consumer), the path is to
  **publish `@zodal/store-localstorage`** (thoremin is its first customer) rather
  than re-implement the adapter inline. If publishing is blocked short-term, a
  thin in-repo adapter implementing the published `DataProvider<T>` interface is
  the *temporary* fallback, tracked for migration.
- The shadcn **renderers** are a "plain HTML baseline" per their README and the
  app uses no shadcn today. So: hand-build the settings panel now (driven by the
  same `SettingsSchema` for structure), and adopt `@zodal/ui-shadcn` once it's
  production-ready. The affordance-first design keeps the UI swappable.

**Two-layer rule:** load preset → hydrate zustand (live); edit in UI → debounce
→ save via `DataProvider`. Never `await` a provider in the audio/tick loop.

## Recording — settings the user asked for

Foundations already exist; this is wiring, not invention:

- **Formats via lazy converters.** Keep WebM/Opus as the always-available default
  (it is the *only* container `MediaRecorder` produces natively; WAV/MP3 must be
  encoded in-house). Add an open-closed `converters` registry keyed by format,
  each a `() => import(...)` loader: WAV in-house (reuse `scripts/lib_audio.ts`
  `writeWav`, retargeted to an `ArrayBuffer` from `decodeAudioData`) — zero new
  dep; MP3 via `lamejs` (small, lazy); "any format" via `ffmpeg.wasm` (heavy,
  opt-in, lazy). User picks one or several output formats.
- **Save location + toast.** Feature-detect `showSaveFilePicker` (Chromium) to let
  the user choose a folder, falling back to the current anchor-href download
  (→ `~/Downloads`). Always surface a "saved as `<name>`" toast (the web API
  exposes the chosen filename, never a true absolute OS path).
- **What to record.** Beyond audio: (a) the **overlay** as video —
  `canvasRef.captureStream(fps)` + the existing audio dest stream → one
  `MediaRecorder`; (b) the **raw video**; (c) the **feature streams** as NDJSON —
  attach a `StreamRecorder` tap to the live `Engine` (the `test/app_graph.test.ts`
  pattern; `engine.emitTaps` already fires every tick) and write per-edge
  `<node>.<port>.ndjson` via the existing codec. (Caveat: live NDJSON accumulates
  in memory unbounded — needs chunking for long sessions.)

## Recommended sequencing

Ordered by value ÷ effort × (user priority), risk noted:

1. **Overlay → composable elements** (+ `indexFingerGuide`, grey-out option,
   split guide-lines/labels). *No engine/registry/dep change. Near-zero risk.*
   Directly serves the main ask. **Build first.**
2. **Retire "layer"** in `docs/ARCHITECTURE.md` + Discussion #3; add `role?` field
   + `registry.listByRole`. *Docs + ~3 lines + node tagging. Advisory only.*
3. **Settings: named presets via zodal** (schema-first; zustand stays the hot
   layer). *User's stated top priority.* Resolve the localStorage-adapter publish.
4. **Recording settings** (formats, save location + toast, what-to-record).
5. **Live face control** — lazy-loaded `webcam-face` source (relates to issue #9).
6. **Node-swap slots** — *only after* fixing the mapping input/params contract
   (correction #1), and only for roles with a real 2nd implementation.
7. **Chore:** drop unused deps (`express`, `better-sqlite3`, `dotenv`).

## What we deliberately are NOT doing (yet)

- Promoting `PortSpec.kind` to strict runtime enforcement (over-engineering until
  the kind vocabulary is curated; a shared TS type on the swap contract is free
  and enough).
- Building the React Flow visual patcher (#14) — the role/slot seam must be proven
  headless first.
- A third-party plugin discovery mechanism — not needed until there's a third
  party; the hand-listed registry is honest for now (don't *claim* open-closed).
- End-user "swap the mapping algorithm" dropdowns — the clearly user-facing swaps
  are overlay elements, instruments (already shipped), and presets. Deeper node
  swapping stays developer-facing (graphs are data) with the seam ready to surface
  later.
