# Command dispatch — the single write path for param-mutations

> **Status:** partially implemented (2026-07, issue #87 — Phase 0 PR #97, Phase 1
> PR #107, Phase 2 PR #98, Phase 3 PR #111). This document is the single source of
> truth for `src/app/commands/`.
>
> **Read the status honestly:** the registry, the palette, the hotkeys, the AI
> assistant and the import firewall all exist and work. The *"single write path"*
> the design promises is **not yet true on main** — only two settings-panel call
> sites dispatch. Completing the sweep is issue **#126**. See
> [Where this is incomplete](#where-this-is-incomplete-126).

## The idea in one line

**Param-mutation is the only thing that is a command.** A command registry becomes the
single write path into the dials model, so every surface that parametrizes the
instrument — keyboard, palette, AI, and eventually gestures — is a *consumer* of one
registry rather than a separate re-description of every dial.

## Why thoremin fits this unusually well

Two properties were already true before #87:

1. **`setDial`/`resetDial` was already the single write path** into settings.
2. **Dials are already Zod schemas** — the parameter types the commands need already
   exist, in one place (`src/settings/dials.ts`).

So the registry did not have to invent a parameter model; it could be *generated* from
the one that existed. That is why #87 was a hard refactor rather than a strangler-fig:
there was nothing to strangle, only a seam to formalize.

## The hard boundary (and why it is a test)

The load-bearing rule:

> A command **never** touches the hot store, the DAG, the nodes, or the audio layer.
> It changes sound **only** by writing a dial. Conversely, nothing in `src/dag/` or
> `src/nodes/` may import the registry.

This keeps human-frequency edits (a click, a keypress, an AI turn) on the dispatch path
and the per-tick / audio path **un-registered and real-time**. Dispatch overhead can
never leak into the audio loop, because the audio loop cannot see the registry.

thoremin lints with `tsc --noEmit` and ships no ESLint, so the boundary the design
requires is enforced as a **test** — `test/commands_firewall.test.ts` — over import
*specifiers* (not raw text, so a comment mentioning a module doesn't trip it):

- Commands get an **allowlist**. Deliberately: a denylist is always one newly-added
  hot-path file behind (host audio lives in `useEngine`/`recorder`/`useAudioEngine`, not
  only `src/nodes`, and a `.ts`-extension specifier can dodge a `$`-anchored name rule).
  With an allowlist, anything unsanctioned is refused by default.
- The DAG and node library get the reverse rule: they may not import the registry.
- The AI assistant gets a **denylist** (hot store / DAG / nodes / audio host) — it is a
  *consumer*, so its legitimate import surface (React, the AI SDK, the registry, the
  dials read-side) is open-ended in a way a command handler's is not.

## The registry (`src/app/commands/`)

| File | What |
|------|------|
| `registry.ts` | `createThoreminRegistry()` (fresh, for test isolation) + the app-wide `registry` singleton. Handlers reach state by **closure capture** of the dials store, so the registry itself stays a pure command index. |
| `dials.ts` | The generic verbs: `dial.set`, `dial.reset`, `dials.patch`. All of them route through `applyDialSet`. |
| `perDial.ts` | **One `dial.<key>.set` command per scalar dial, generated from the dials SSOT.** Each carries the dial's exact typed value schema — so the palette renders a dropdown for an enum and a bounded number input for a numeric one, every dial is searchable by its human label, and there is **zero hand-maintenance**: add a dial to `thoreminDials` and its command appears. |
| `instruments.ts` | `instrument.load` / `.save` / `.create` — discrete actions on a whole dials layer. |
| `confirmation.ts` | The human-in-the-loop gate for the AI assistant (below). |

Generating the per-dial commands from `settingsForm.fields` is the structural
satisfaction of the SSOT rule: a dial and its command cannot drift, because there is
only one of them.

## The consumers

| Surface | How it dispatches |
|---------|-------------------|
| **Keyboard** (#90, `src/app/keyboardShortcuts.ts`) | `tinykeys` → `dial.set`. Uses tinykeys *directly*, not `acture-hotkeys`, because a binding must carry **fixed params** (a specific octave delta), which the hotkeys adapter can't express. |
| **Command palette** (#87 Phase 2, `CommandPaletteOverlay.tsx`) | Cmd/Ctrl-K → headless `cmdk` + `acture-palette-react` + `acture-forms-autoform` over the per-dial commands. |
| **AI assistant** (#87 Phase 3, `src/plugins/assistant/`) | `acture-ai-vercel` exposes the registry as model tools. |
| **Settings panels** | `src/app/dispatchDial.ts` → `dial.set`, with a toast on validation failure. **Two call sites so far** — see below. |
| **Gestures** (#129, open) | Not yet. `gesture-classifier` already emits discrete pose edge events; wiring them to dispatch is the open issue. |

## The confirmation gate (Phase 3)

Risk is an **external convention** (`getRisk`, keyed by command id) so the closed
`CommandRecord` type stays closed; the gate **wraps** `registry.dispatch`.

A **destructive** command (`instrument.load` / `.save` / `.create` — the three that
discard or overwrite *saved* state) dispatched on the **assistant channel**
(`context.channel === 'assistant'`) does not run. It returns a `confirmation_required`
Result — errors-as-data, carrying `{command, params}` and **no token**. The runtime
renders an approve/deny card; only a **human** approval mints a one-use token bound to
that exact `{command, params}`, and only then does the re-dispatch run.

**The token is never handed back to the model, so the model cannot self-approve.**

Human surfaces (palette, hotkeys) never set the assistant channel, so they dispatch
ungated and the gate is invisible to them. Reversible dial edits are `additive` and are
not gated — reloading the instrument undoes them.

## Decision B: continuous sliders deliberately do NOT dispatch

**Discrete** writes (a `<select>`, a mode toggle, a checkbox, a palette entry, an AI
call) go through `registry.dispatch`.

**Continuous** writes — a `type="range"` slider being dragged — stay a direct `setDial`.

This is a decision, not an omission. A live drag fires a write per pointer-move frame;
routing that through an async dispatch (Zod param validation, the confirmation-gate
wrapper, a promise per event) buys nothing and costs latency on the one interaction
where latency is *audible*. The slider's value still lands in the same dials store
through the same `setDial` the command's handler calls — it is the same write, minus
the ceremony. The dial is the boundary; dispatch is the paperwork.

So: **a slider that doesn't dispatch is not a gap in #126.** A `<select>` that doesn't
is.

## Where this is incomplete (#126)

`dispatchDialSet` currently has **two** call sites in `DialsControlsPanel.tsx`:
`face.mapping` and `master.syncHands`. Every other discrete control — voice
sound/root/scale, chord sound/voicing/rendering, overlay position, the rest of the
`<select>`s — still calls `setDial` directly. They were left as a deliberate Phase-1
scope cut ("prove the pattern on two, sweep the rest once it's proven"), and the sweep
has not happened.

Consequences, stated plainly:

- The registry is the *intended* single write path, not the *actual* one.
- An AI or a palette user can set those dials (the per-dial commands are generated for
  **every** dial, so nothing is unreachable) — but a **human clicking the panel**
  bypasses dispatch, so those writes are invisible to anything that observes the
  command stream.
- That invisibility is what blocks **#127** (undo via `acture-undo`, telemetry, command
  export/replay): you cannot replay a command log that is missing half the writes. This
  is why #126 is load-bearing and is the next thing to do on this track.

One more deliberate exception: the non-dial **`muted`** flag (#91) is a store flag, not
a dial, and is toggled directly. It is not a command yet.

## Why `dispatchDial.ts` lives outside `src/app/commands/`

Because it imports the toast store — which the import firewall forbids *inside* a
command. Commands stay pure (they only write a dial); surfacing a validation failure to
the user is a UI-layer concern. The firewall is doing its job here, and the file's
location is the evidence.

## What is verified

`test/commands_dispatch.test.ts`, `commands_perdial.test.ts` (generation from the SSOT),
`commands_instruments.test.ts`, `commands_confirmation.test.ts` (the gate: no token to
the model, one-use, params-bound), `commands_firewall.test.ts` (the boundary itself),
`keyboard_shortcuts.test.ts`.
