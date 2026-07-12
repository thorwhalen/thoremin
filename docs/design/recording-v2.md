# Recording v2 — session-based multi-stream recorder

> **Status:** implemented (2026-07, issue #88). This document is the single
> source of truth for the recording subsystem. It supersedes the audio-only
> `PerformanceRecorder` flow and is a superset of the older recording-settings
> work (#49).

## The idea in one line

A recording is a **session** (a transient config that lives OUTSIDE the
instrument), capturing any subset of **five streams** into **one folder** with a
`manifest.json` that is the alignment SSOT — so a take is a self-describing,
downstream-friendly artifact.

## Why recording is not an instrument parameter

Recording config (what to capture, where to save, output formats) is a *tooling
preference*, not a musical setting. It must never live in a preset/instrument.
So it is its own Zod schema (`RecordingSessionSchema`), persisted separately to
`localStorage['recording.session.last']`, and the settings UI lives in a
transient sheet, not the instrument panel.

## The button-swap UX (`RecordButton`)

```
idle       →  [ ● Record ]
settings   →  a "recording session" sheet in the same slot, with
              [ ● Rec now ] exactly where Record was + a [ ✕ ] Close that
              auto-saves (it's a settings surface, not a form to submit)
recording  →  [ ■ Stop ]  ● 00:12   audio · overlay · features   (compact HUD)
saving     →  the HUD, disabled, while the take converts + writes
```

All state lives in `useThoreminEngine().recording`; `RecordButton` is purely
presentational.

## The five streams (one `MediaRecorder` per media stream)

| Stream | Source | Notes |
|---|---|---|
| **audio** | master-bus tap (`MediaStreamAudioDestinationNode`) | always available; converted to the selected formats (webm/wav) on stop |
| **video + overlays** | `canvas.captureStream(fps)` muxed with the audio tap | "what you see" (mirrored, with landmarks) |
| **pure webcam** | the raw camera `MediaStream` (else `video.captureStream()`) | overlay-free; per-stream "include audio" (default off) |
| **overlay-only (alpha)** | a transparent offscreen canvas the overlay node redraws to with the backdrop suppressed | **Chromium-only**, experimental (alpha WebM); feature-gated |
| **features → JSONL** | a live `FeatureJsonlTap` attached via `engine.addTap` | `{tick,t,key,value}` per edge; serialize-on-receipt (constant memory) |

All streams share one **t0** — the DAG clock (`ctx.time`, which the engine drives
from `performance.now()/1000`) at record start. Media recorders use `start(2000)`
(2s timeslice) for constant-memory long takes.

### Overlay-alpha without duplicating the overlay code

The overlay is a single node (`canvas_overlay.ts`) that draws `OVERLAY_ELEMENTS`
onto `ctx.resources.canvas`, with the webcam as a toggleable `backdrop` element.
For the alpha stream, the `SessionRecorder` injects a transparent
`ctx.resources.overlayAlphaCanvas`; the node, after its main draw, redraws the
**same** element list onto it with `params.video.show = false` — reusing all
drawing logic (no drift) and costing nothing when the resource is absent.

## One folder per recording + naming (`plan.ts`, `naming.ts`)

Always a folder (predictable model for downstream tooling; the `manifest.json`
always exists). The **folder name = file stem**; the **primary ext = the type**,
with a **secondary ext = the role** when streams share a primary ext:

```
demo-theremin-2026-07-05T14-30-12/
  ….overlay.webm  ….camera.webm  ….alpha.webm
  ….webm  ….wav  ….features.jsonl  ….annotations.jsonl  ….manifest.json
```

`recordingStem()` + `fileName(stem,{role,ext})` are pure and unit-tested; every
sink writes the identical names. An opt-in **single-file escape hatch** (one
media stream, no features) saves a bare file with no folder.

## Three-tier sink (`sink.ts`, `caps.ts`)

Feature-detected, never UA-sniffed:

1. **directory** — File System Access API `showDirectoryPicker` → a real folder,
   N streamed files. The picked handle is reused from **IndexedDB** (`idb.ts`)
   across takes (one re-grant).
2. **zip** — one `.zip` (lazy `fflate`) = the whole folder, one download. Works
   everywhere; lands in the browser's Downloads folder.
3. **perFile** — per-file `saveBlob` (last resort).

A `directory` request that is cancelled/unsupported degrades to a zip, so a take
is never lost.

## `manifest.json` — the alignment SSOT

```jsonc
{
  "version": 1,
  "startedAt": "2026-07-05T14:30:12.000Z",
  "t0": 92.5,                       // performance.now()/1000 (DAG tick clock) at start
  "instrument": "thoremin",
  "stem": "demo-theremin-2026-07-05T14-30-12",
  "streams": [
    { "file": "….overlay.webm", "kind": "overlayVideo", "mime": "video/webm", "fps": 30 },
    { "file": "….webm", "kind": "audio", "mime": "audio/webm;codecs=opus" },
    { "file": "….features.jsonl", "kind": "features" }
  ]
}
```

Every stream's timestamps (`t` in the feature/annotation JSONL) are relative to `t0`.

## The live-annotation `.annotations.jsonl`

The live-annotation stream (#92, shipped) is **just another stream** written into
the same folder: same `{stem}`, the same `t0`/`ctx.time` clock, the same JSONL
line-per-event convention (`kind: "annotations"` in the manifest). No restructuring
was needed — it dropped in.

## What is verified vs. browser-only

Pure logic (naming, plan, manifest, schema, feature tap, sink selection) is
unit-tested (`test/recording_*.test.ts`). The browser capture paths
(`MediaRecorder` wiring, sink I/O, the alpha canvas, IndexedDB handle reuse) are
build-checked and structured with feature detection + graceful fallback; they
require a real browser + camera to exercise end-to-end.
