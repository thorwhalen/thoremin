# Lazy loading as a catalogued pattern

> Status: design record (2026-09-09), issue [#188](https://github.com/thorwhalen/thoremin/issues/188). The maintainer's rule, verbatim: *"We don't want to load everything at once, but only what is needed when it's needed."* This page is the pattern that rule became, and the module that implements it (`src/lazy/`). The wider context (where generative AI fits inside an instrument) is [`generative-instruments.md`](generative-instruments.md) §5.

## The rule

A heavy thing (a vendor SDK, an ML model, a wasm runtime, a network session, an encoder) is **never in the main chunk and never loaded before a player asks for it**, and while it loads, the instrument keeps playing and the UI says what is happening. A player who never enables a capability never pays for it, in bytes or in permission prompts.

## Why a pattern and not a convention

Three sites already do this by hand, and each invented its own state machine and its own status words:

| Site | Heavy thing | Loader | Status words |
|---|---|---|---|
| `src/nodes/sources/webcam_hands.ts`, `webcam_face.ts` | MediaPipe tasks-vision (137 kB gzip + wasm + model) | `import('@mediapipe/tasks-vision')` in `init` / behind the face gate | `idle`, `loading`, `ready`, `error` |
| `src/app/recording/formats.ts` → `flac.ts` | libflacjs (108 kB gzip) | `load()` per format entry, two lazy hops | a null blob plus an error |
| `src/nodes/output/midi_out.ts` → `midi_engine.ts` | WEBMIDI.js (17 kB gzip) + the MIDI permission | `ctx.resources.createMidiSink` or `import('./midi_engine')` | `off`, `unsupported`, `connecting`, `ready`, `no-ports`, `denied`, `error` |

The bugs #147's adversarial review found in the third copy (an open for a superseded port attaching a device; a disabled node still holding a port) are bugs of exactly this state machine. A fourth hand-written copy would make them again. So the machine is extracted once, with each rule pinned by a test, and the status words are unified so one readout component can render any heavy node.

## The three parts

### 1. Loader seam

A heavy node never imports its implementation statically. It declares a factory type, reads it from `ctx.resources.<name>` when the host injects one (tests, headless runs, custom hosts), and otherwise uses a module-level default whose body is a dynamic `import()` of a **browser-only sibling module** (`midi_engine.ts`, `lyria_engine.ts`). Two consequences that are easy to get wrong:

- The sibling module is the only static importer of the vendor library, and **nothing in `src/nodes/index.ts` or `src/nodes/browser.ts` re-exports it**. A static re-export defeats the split: that is how `@google/genai` (207 kB raw, 38 kB gzip) sat in the main chunk until PR 3 of #188 removed the `LyriaEngine` export from `browser.ts`.
- Loading is *requested* synchronously from `process()` and never awaited there. The node reads `current()` each tick and does its job when the thing is there.

### 2. Status port

Every heavy node emits a `status` output of type `LoadStatus` (`src/lazy/status.ts`):

| phase | meaning |
|---|---|
| `off` | not requested: the enable input is false; nothing loaded, nothing held |
| `unavailable` | requested, but this host cannot provide it; `reason` says why (`unsupported`, `no-key`, `denied`, `no-ports`, …) |
| `loading` | the SDK / model / wasm / session is being fetched or opened; `progress` 0..1 when known |
| `ready` | loaded and usable, idle |
| `active` | loaded and doing its job right now (playing, sending, detecting) — `withActive(status, isActive)` |
| `error` | the load or the resource failed; `message` is human-readable; disable then enable retries |

Node-specific detail goes in `reason`, never in a new phase. The two existing nodes keep their own status shapes (both are pinned by tests); the shared readout adapts them. New heavy nodes speak `LoadStatus` directly.

### 3. UI affordance

`src/app/LoadStatusReadout.tsx` renders a `LoadStatus` as the dot + message the MIDI panel already draws (`PHASE_DOT` generalised), with a progress bar while `loading` and progress is known. Two rules travel with it:

- Where the capability cannot exist on this host (`unavailable` with `unsupported`), render the reason instead of a dead toggle (the MIDI section's precedent).
- A multi-megabyte download is labelled as such *before* the player triggers it (the ffmpeg.wasm rule in `recording-v2.md`). The readout shows progress; the enable control says the size.

## The module: `src/lazy/`

```ts
import { lazyResource, withActive } from '@/lazy';

const engine = lazyResource<GenerativeEngine>({
  load: (ctx) => (injectedFactory ?? defaultFactory)(opts, ctx),  // the seam
  unload: (e) => void e.stop(),
  label: 'generative engine',
  log: ctx.log,
});

// in process(), every tick, never awaited:
engine.want(inputs.enabled === true);
const e = engine.current();
if (e && playing) { /* drive it */ }
return { status: withActive(engine.status(), playing, 'Playing') };
```

Five rules, each a test in `test/lazy_resource.test.ts`:

1. **Request once.** `request()` on every tick starts at most one load.
2. **A late arrival is discarded.** A load that resolves after `release()` / `dispose()` is unloaded on arrival, never attached, and the loader's `AbortSignal` fires so a download can stop early.
3. **A failure is not re-hammered.** After `unavailable` / `error`, `request()` is a no-op until `release()`.
4. **Re-enable retries.** `release()` clears the failure, so disable → enable is the player's "try again".
5. **Never throw.** A rejecting (or synchronously throwing) loader becomes an `error` status.

Pure and Node-safe: no DAG import, no DOM, no vendor library. `src/dag/` is untouched; a node composes the resource inside `make()`.

## Adopters

| Node / site | Status | Notes |
|---|---|---|
| `lyria` (`src/nodes/output/lyria.ts`) | **adopts in #188 PR 3** | `createGenerativeEngine` seam; default lazily imports `lyria_engine.ts`, which reads the BYO key from the assistant's provider-key store. `LyriaEngine` leaves `browser.ts`'s static exports. |
| `midi-out` | reference site, not migrated | Mutation-verified as is; migrate when a change touches it. Its `MidiPhase` maps to `LoadStatus` as `connecting → loading`, `unsupported/no-ports/denied → unavailable + reason`. |
| `webcam-face`, `webcam-hands` | reference site, not migrated | Owned by the body-features work (#186); asked to adopt for the body model rather than write a fourth copy. |
| recording formats | reference site | Already a registry of `load()` thunks; the status here is per conversion, not per node. |
| conductor assets (#187) | asked to adopt | Any score / model / sample fetched on first use. |
| an in-browser generator (`generative-instruments.md` §3b) | must adopt | ~300 kB gzip of library and 12–18 MB of checkpoint, with a progress bar. |

## What this is not

- Not a plugin or discovery mechanism; the registry stays a hand-listed array (`component-model.md`, correction 2).
- Not a replacement for Vite's code splitting; it is what makes the split *reach* the node (the seam) and *visible* to the player (the status).
- Not a cache: whether a model is cached across sessions is the browser's business (HTTP cache, or the Cache API in a later step), not this module's.
