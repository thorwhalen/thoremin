# Command dispatch — the single write path for param-mutations

> **Status:** implemented (2026-07, issue #87 — Phase 0 PR #97, Phase 1 PR #107,
> Phase 2 PR #98, Phase 3 PR #111; the settings-panel sweep, issue #126). This
> document is the single source of truth for `src/app/commands/`.
>
> **The claim is now true, with one named exception.** Every *discrete* param
> mutation in the app — a keypress, a palette entry, an AI tool call, and (since
> #126) **every discrete settings-panel control** — goes through
> `registry.dispatch`. The one deliberate bypass is a `type="range"` slider being
> dragged, which writes the dial directly for latency: that is
> [Decision B](#decision-b-continuous-sliders-deliberately-do-not-dispatch), and it
> is the *only* one. `test/dials_write_path.test.ts` enforces exactly that split, so
> the exception cannot quietly widen.

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
| `dials.ts` | The generic verbs: `dial.set`, `dial.setIn`, `dial.reset`, `dial.patch`. All of them route through `applyDialSet` / `applyDialSetIn`. |
| `paths.ts` | The **leaf keyspace of the structured dials**, derived from the dials SSOT — what makes `overlay` / `handMap` / `faceExpr.*` dispatchable at all (below). |
| `perDial.ts` | **One `dial.<key>.set` command per scalar dial, generated from the dials SSOT.** Each carries the dial's exact typed value schema — so the palette renders a dropdown for an enum and a bounded number input for a numeric one, every dial is searchable by its human label, and there is **zero hand-maintenance**: add a dial to `thoreminDials` and its command appears. Structured dials are skipped here (they are not a single settable scalar) and reached by `dial.setIn` instead. |
| `instruments.ts` | `instrument.load` / `.save` / `.create` — discrete actions on a whole dials layer. |
| `confirmation.ts` | The human-in-the-loop gate for the AI assistant (below). |

Generating the per-dial commands from `settingsForm.fields` is the structural
satisfaction of the SSOT rule: a dial and its command cannot drift, because there is
only one of them.

## `dial.setIn` — how a structured dial becomes writable (#126)

Four of the dials do not hold a scalar. `overlay` and `handMap` hold a nested object;
`faceExpr.degrees` and `faceExpr.sensitivity` hold a record. They have no per-dial
command (`perDial.ts` skips them — there is no single value to set), and the generic
verbs cannot carry them either, because **a command's value is deliberately scalar**:

> `DIAL_VALUE = z.union([z.string(), z.number(), z.boolean()])`

That is not laziness. An object-shaped param emits a JSON Schema that **Gemini's
function-calling validator rejects** (the same class of failure that forced
`z.unknown()`/`z.tuple()` out of the params in Phase 3). So "just let the value be an
object" is not available, and before #126 there was simply **no dispatchable write path**
for the overlay, the hand map or the expression maps — which is why every one of their
panel controls bypassed the registry.

The resolution is to keep the value scalar and move the structure into the **address**:

```
dial.setIn({ path: 'overlay.video.alpha',              value: 0.5   })
dial.setIn({ path: 'handMap.fingers.index.target',     value: 'vibrato' })
dial.setIn({ path: 'faceExpr.degrees.happy',           value: 4     })
```

The handler resolves the path, deep-sets the leaf **immutably**, and runs the resulting
whole object through the *same* `invalidWritesReason` → `setDial` contract as
`dial.set` — so an out-of-range leaf or a bad enum member is refused as data, never
landing in the dials layer while the audio keeps the old value.

Three things make this hold together:

1. **The path set is DERIVED, never hand-listed** (`paths.ts`). It walks each structured
   dial's Zod schema, recursing into objects; for a `ZodRecord` — which declares no keys
   — the dial's **default value** is the SSOT for which members exist (the shipped
   expression map is what says `happy` is an expression). Add a field to the overlay
   schema and its path appears in the command, the palette and the AI tool with zero
   hand-maintenance — the same structural SSOT guarantee `perDial.ts` gives the scalars.
2. **`path` is a `z.enum` of those derived paths**, not a free string. The emitted JSON
   Schema stays a plain string-enum (Gemini-safe), every valid path is *discoverable* to
   the palette and the model, and a typo is refused at the param layer.
3. **A path that resolves to a dial but names no declared leaf is refused**
   (`unknown_path`). This is load-bearing, not defensive noise: Zod strips unknown object
   keys, so `overlay.bogus.show` would deep-set a junk key, still *parse*, and land in the
   dials layer as silent garbage.

One subtlety worth knowing: dial keys are **themselves dotted** (`faceExpr.degrees`), so
a path is resolved by **longest-prefix match** against the declared keyspace. Splitting on
the first dot would hand back a phantom `faceExpr` dial.

`dial.patch` gets one related concession: its per-write `value` is **optional**. The
sync-hands mirror copies the source hand's fields onto the other hand, and the #63 octave
range (`rangeLow`/`rangeHigh`) is legitimately *absent* on a pre-#63 instrument — the
mirror must be able to propagate that absence, and omitting the key is the JSON-Schema-safe
way to say "no value". A clear is refused on any dial that declares a `.default(...)`
(`CLEARABLE_DIALS` in `commands/paths.ts` derives the clearable set from the schema — today
exactly the four `#63` range dials). This is a guard, not a formality: `SettingsSchema` would
happily re-fill a cleared dial's default, so the command would report `ok` while the audio
silently reset, and the dials layer would keep the `undefined` for the panel to dereference —
`dial.patch({writes:[{key:'handMap'}]})` would wipe the hand mapping, report success, and
crash the Hand panel on its next render. It is AI-reachable, because an optional field in the
emitted JSON Schema is one the model may simply omit.

## The consumers

| Surface | How it dispatches |
|---------|-------------------|
| **Keyboard** (#90, `src/app/keyboardShortcuts.ts`) | `tinykeys` → `dial.set`. Uses tinykeys *directly*, not `acture-hotkeys`, because a binding must carry **fixed params** (a specific octave delta), which the hotkeys adapter can't express. |
| **Command palette** (#87 Phase 2, `CommandPaletteOverlay.tsx`) | Cmd/Ctrl-K → headless `cmdk` + `acture-palette-react` + `acture-forms-autoform` over the per-dial commands. |
| **AI assistant** (#87 Phase 3, `src/plugins/assistant/`) | `acture-ai-vercel` exposes the registry as model tools. |
| **Settings panels** (#126) | `src/app/dispatchDial.ts` → `dispatchDialSet` (`dial.set`), `dispatchDialSetIn` (`dial.setIn`), `dispatchDialPatch` (`dial.patch`), each with a toast on validation failure. **Every discrete control**, in all six panel sections. |
| **Gestures** (#129, open) | Not yet. `gesture-classifier` already emits discrete pose edge events; wiring them to dispatch is the open issue. |

Why three panel dispatchers rather than one: a control's *gesture* and its *write* are not
always 1:1. A `<select>` on a scalar dial is one write (`dial.set`). A control on a
structured dial is one write to a leaf (`dial.setIn`). And two controls are genuinely
several writes at once — the sync-hands voice edit (which mirrors the whole non-sound voice
onto the other hand, via `voiceEditWrites`) and the chord-source flip (which seeds
`chordRoot`/`chordType` so the mode change is inaudible). Those dispatch one **atomic**
`dial.patch`, because a half-applied voice — one hand's scale changed, the other's not —
must not be a reachable state.

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

So: **a slider that doesn't dispatch was never a gap in #126.** A `<select>` that doesn't
is — and there are none left.

The exception is *named*, not vibes-based. `test/dials_write_path.test.ts` parses each
panel's AST, taints every local helper that transitively reaches the dials setter, and
fails on any reference to one that is not inside an `input[type="range"]` handler. So a
slider's fast path is legal, a helper it shares with a toggle is not, and the rule cannot
be re-widened by accident.

## What the panels look like now (#126)

All **21** discrete control sites dispatch, in three classes:

| Class | Where | Verb |
|---|---|---|
| Scalar `<select>` (5 sites) | chord sound / voicing / rendering / chord-root / chord-scale | `dial.set` |
| Multi-write gesture (4 sites) | the chord-source flip; the 3 voice selects (sound/root/scale), which mirror across synced hands | `dial.patch` (atomic) |
| Structured-dial control (12 sites) | the hand map (note source, 4 toggles, per-finger target/mode/invert), the overlay (show + sub-toggles + position), the expression→degree map | `dial.setIn` |

The **11** `type="range"` sliders keep their direct write (Decision B).

What this unblocks: **#127** (undo via `acture-undo`), telemetry and command
export/replay all assume mutations pass through one place. Until #126 they did not, so any
of those features would have been silently partial — you cannot replay a command log that
is missing half the writes.

Two things remain deliberately outside the registry, and both are honest:

- The non-dial **`muted`** flag (#91) is a store flag, not a dial. It is toggled directly
  and is not a command yet.
- The **Feature Lab** (#136) writes the control store, not a dial — it measures the
  instrument rather than being part of it, so its config is a per-device tooling
  preference. Nothing there is a param mutation.

## Why `dispatchDial.ts` lives outside `src/app/commands/`

Because it imports the toast store — which the import firewall forbids *inside* a
command. Commands stay pure (they only write a dial); surfacing a validation failure to
the user is a UI-layer concern. The firewall is doing its job here, and the file's
location is the evidence.

## What is verified

`test/commands_dispatch.test.ts`, `commands_perdial.test.ts` (generation from the SSOT),
`commands_instruments.test.ts`, `commands_confirmation.test.ts` (the gate: no token to
the model, one-use, params-bound), `commands_firewall.test.ts` (the import boundary),
`keyboard_shortcuts.test.ts`, and — from #126 — `commands_paths.test.ts` (the derived leaf
keyspace, longest-prefix resolution, immutable deep-set, and `dial.setIn`'s write
contract), `dispatch_dial.test.ts` (the three panel dispatchers actually land the write and
surface a refusal), and `dials_write_path.test.ts` (the panel write-path guard above).
