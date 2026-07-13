# Feature Instrumentation Lab — a measuring instrument for face & hand features

> **Status:** implemented (2026-07, issue #119, PR #122); made *reachable* and moved out
> of the instrument in #136. This document is the single source of truth for the feature
> catalog (`src/features/`) and the lab (`src/features/labConfig.ts`, `src/app/lab/`,
> `src/app/LabPanel.tsx`, `src/app/LabControls.tsx`, the `featureLab` overlay element).
> Follow-up work is tracked in #131.

## The idea in one line

Before you can map a gesture to sound, you have to know **which gestures you can
actually make on purpose** — so the lab is a live *measuring* instrument: 248 scalar
face/hand features, each on its own meter, normalized so they are comparable, with a
safe way to invent new ones.

## Why this exists

Every mapping decision so far was made by intuition: "smile → brightness" felt right.
But MediaPipe hands you a 21-point hand and a 478-point face mesh with 52 blendshapes,
and *most* of what you can compute from those is either unusable (nobody can move it
deliberately) or redundant (it is a linear restatement of something else). The lab
makes that visible instead of guessed.

It is deliberately **not** a sound. It produces no audio, changes no dial, and costs
nothing when it is off.

## Where it lives, and how you find it (#136)

The paragraph above was the intent from day one. The first implementation did not honour
it: the lab's config was a sub-object of the `overlay` **dial**, so the Lab *was* a dial —
toggling a meter marked your instrument as having unsaved edits, and loading an instrument
silently reconfigured your meters. And its only control lived inside the per-instrument
settings editor, three clicks and a scroll deep, defaulting to off. The result was a
248-feature subsystem that shipped to production, passed 759 tests, and that nobody —
including its author — could find.

Two corrections, both of which follow from taking "it is a measuring instrument" literally:

1. **The config is a tooling preference, not an instrument parameter.** It lives on the
   hot control store (`useControls.featureLab`), persisted per-device and excluded from
   `SettingsSchema`, exactly like the per-device `faceCalibration` and exactly as
   recording settings were moved out of the instrument in #88. `store-controls` composes
   it into the overlay node's params each tick, so the engine still sees one overlay
   config and the meters keep working. `OverlayDialSchema` is the node's params minus
   `featureLab` and is what the dial and the saved settings use.

2. **It has an entry point.** The Lab is a *tool*, registered in `src/app/tools.ts` and
   opened from the shell's tools bar (bottom-left, alongside the command palette and the
   manual). It opens on an intro that says what the meters measure, because "248
   normalized meters" means nothing to a player who has not read this document.

A third correction falls out of the same principle. The face model used to load only when
`face.mapping !== 'none'`, so you could not look at a face meter without also putting your
face in charge of the sound: a measuring instrument that could not observe without
altering. `faceActive` (webcam_face.ts) now returns true when *either* the mapping wants
the face *or* the Lab is measuring face groups.

**The rule this cost us, stated once:** a feature only findable by someone who read the PR
is not shipped. `test/tools_shell.test.tsx` and `test/app_shell.test.ts` hold the line —
every registered tool has a labelled button in the shell, and every button opens a surface
the shell actually mounts. The pre-existing "every overlay element has a control
descriptor" test passed throughout this bug: a descriptor proves an element is
*controllable*, not that a player can *find* the control.

## The feature catalog (`src/features/`) — data-driven, like the node registry

A feature is a `FeatureDef`: an id, a group, a source, an advisory range, a
**controllability** class, a one-line description, and a pure `compute(ctx) → number`.
That is the whole extension point. Adding a feature is appending an entry to a
sub-catalog; nothing else changes — the same "affordances first, data-driven" rule the
node registry and `OVERLAY_ELEMENTS` follow.

| File | What |
|------|------|
| `types.ts` | `FeatureDef`, `FeatureVector`, `Controllability`, the per-source contexts. |
| `face_catalog.ts` | 113 face features: blendshapes, mesh geometry (eye/mouth/brow/nose/cheek/jaw), gaze, head pose, symmetry, action units. |
| `hand_catalog.ts` | 135 hand features: per-side (finger curls, gaps, spreads, palm orientation…) + two-hand pair features. |
| `catalog.ts` | The facade: assembles both into one flat ordered registry (`ALL_FEATURES`, 25 groups), and builds the pure per-source contexts. |
| `math.ts`, `landmarks.ts` | Vector helpers; the mesh landmark indices + the inter-ocular-distance scale reference. |
| `formula.ts` | The safe formula compiler (below). |
| `normalizer.ts` | The online normalizer (below). |

Two invariants make the catalog safe to consume:

1. **A feature returns `NaN` when it is not measurable this frame** (absent source,
   missing landmark, degenerate scale) — never `Infinity`, never a thrown error.
   The vector nodes drop non-finite values, so they never reach the recorder or the
   normalizer. This matters: **one `NaN` permanently poisons a running mean.**
2. **`compute` is pure.** Same context → same value. So every feature is unit-testable
   headlessly, and the whole catalog is replayable from a recorded fixture.

### `controllability` — the honest column

Each feature declares `easy` | `moderate` | `involuntary`. This is the answer to the
question the lab exists to ask. `browInnerUp` is `easy`; `cheekPuff` is `moderate`;
most eye-blink and gaze micro-features are `involuntary` and should not be load-bearing
in a mapping no matter how nice their meter looks.

## In the graph: two pure taps, zero cost when off

`face-feature-vector` and `hand-feature-vector` are ordinary pure nodes that fan **out**
off the *existing* `webcam-face` / `webcam-hands` outputs (additive fan-out; no new
source, no second model load). They emit a `FeatureVector` (a flat `Record<string, number>`
of finite values only) which feeds the overlay's `featureLab` element.

They emit an **empty vector** unless the lab panel is shown, so the default instrument
pays nothing for them. And because they are ordinary DAG edges, the existing
feature-JSONL recording tap captures them for free — anything you can see in the lab,
you can record and analyze offline.

## The formula compiler — the security constraint is the design

Users can define **derived features** (`(browOuterUpLeft + browOuterUpRight) / 2`).
That means executing a user-authored string, in the browser, every frame. So:

**There is no `eval` and no `new Function`.** `formula.ts` parses with
[`jsep`](https://github.com/EricSmekens/jsep) — a *parse-only* expression AST, ~5 kB,
MIT, which cannot execute anything — and compiles the AST to a closure by recursive
descent. The compiler **rejects**:

- `MemberExpression` — **both** `a.b` and `a[b]`. This is the important one: with no
  member access, a formula cannot reach `constructor`, `__proto__`, or any global.
- Calls to anything but a **whitelisted host helper** (`DEFAULT_HELPERS`: `abs`, `sqrt`,
  `min`, `max`, `clamp01`, trig, …). No arbitrary callee.
- Any **unknown variable**. The only names that resolve are the bound feature safe-names.

So the *entire* value surface a formula can reach is `{bound feature values} ∪ {fixed
math helpers}`. There is nothing to escape to.

**Rejected alternatives, on purpose:**

- **`expr-eval`** — rejected for **CVE-2025-12735**: its evaluator is reachable to RCE.
  It is the obvious pick and it is the wrong one.
- **`expression-eval`** — rejected: it is an insecure sandbox by design (it evaluates
  member expressions), and has a history of prototype-pollution escapes.

**Failure model:** an invalid formula fails at **compile** time with a clear
`FormulaError` (surfaced live in the editor as you type). The compiled closure **never
throws** in the per-frame loop — a divide-by-zero yields `NaN`/`Infinity`, which the
caller drops. A bad formula therefore cannot reach audio; the worst it can do is not
draw a meter.

## The normalizer — why a min/max envelope, not percentiles

Feature magnitudes are wildly heterogeneous: blendshapes are 0..1, finger curls run to
3π radians, gaze offsets are roughly ±1, head pose is in degrees, and pinch/gap ratios
are open-ended. To read them as comparable levels on one grid of meters, each feature is
mapped to 0..1 against statistics accumulated **online**, from the moment the lab turns
on, robust to the performer continuously changing their range.

Per feature, all O(1) per sample:

- a **Welford** cumulative mean/variance (numerically stable baseline);
- an **exponentially-weighted mean + variance** for drift, with the EW factor derived
  from the *actual* frame `dt` (`alpha = 1 - exp(-dt/tau)`) — rAF `dt` is jittery, so a
  constant-fps alpha would itself drift;
- an **EW-decayed min/max envelope** — the default display range;
- interior **quantile estimates** (the tick marks the meter draws), via an *additive*
  Robbins-Monro update, envelope-scaled so it also works for signed / zero-centered
  features where the multiplicative DUMIQE step collapses. Kept monotone across
  quantiles by a read-time guard.

### The design decision: `minmax` is the default mapping

A decaying **min/max envelope** — expands *instantly* to a new extreme, forgets old
extremes *slowly* (note: not a windowed min/max) — beats percentile normalization
**for this use case**, for three reasons:

1. **The peaks are the point.** A percentile mapping compresses the tails by
   construction: everything above p95 saturates to 1. But the top of your reach is
   exactly what you want to map to the loudest note / the brightest timbre. Throwing
   away the extremes throws away the musically interesting part.
2. **The question is "what is my range", not "what is my distribution".** A quantile
   estimate answers how *often* you visit a value. A performer asking "can I drive
   this?" is asking how *far* they can move it. Those are different questions, and the
   envelope answers the one being asked.
3. **It responds immediately.** Push a feature to a new extreme and the bar's full scale
   reflects it on that frame — you get instant feedback that the movement registered.
   A quantile estimator needs a warm-up and is biased by how long you dwell somewhere;
   holding still would quietly rescale everything.

The quantile mapping is still there (`mode: 'quantile'`, crossfaded in after a
warm-up), because for *analysis* — "where does this feature usually sit" — it is the
right tool. It is an option, not the default. `zscore` is offered for the same reason.

**Saturation:** `squash: 'tanh'` softly saturates instead of hard-clipping, so values
past the range stay distinguishable from each other. A musician exploring the top of
their range should not see a row of bars all pinned at exactly 1.

**Guards** (each a real correction, not a formality): NaN/Inf inputs are rejected
*before* they can poison a running mean; a degenerate range never divides to Infinity;
per-feature and global `reset()` re-zero the stats.

The normalizer is pure and headlessly unit-testable — no DOM, no audio, no time source
(`dt` is passed in).

## Saved lab views

A **lab view** is a named snapshot of the lab's config: which groups are shown, the
normalizer mode, the grid columns, the marker/value toggles, and the derived features.
It is its **own** zodal collection (`src/app/lab/`, `LabViewSchema` +
`labViews.ts` over a `DataProvider`), deliberately separate from the instrument presets
and out of the live control store's persist version — a lab view is an *analysis
workspace*, not a sound. Every field carries a `.default(...)`, so a view saved by an
older build still parses.

Loading a view hydrates the live `featureLab` config on the control store (synchronous
zustand); edits debounce-save back. Nothing here is ever awaited in the tick loop.

## What is verified

Pure logic — the catalog, the formula compiler (including its rejection cases), the
normalizer, the vector nodes, the overlay element, the lab views — is unit-tested
(`test/feature_catalog.test.ts`, `test/feature_formula.test.ts`,
`test/feature_normalizer.test.ts`, `test/feature_vector_nodes.test.ts`,
`test/feature_lab_overlay.test.ts`, `test/lab_views.test.ts`). Since #136, so is the
lab's *separation from the instrument* and its *reachability from the shell*
(`test/feature_lab_config.test.ts`, `test/tools_shell.test.tsx`,
`test/app_shell.test.ts`).

## Open follow-up (#131)

The lab shows you *what* you can move. It does not yet tell you what is **redundant**:
two features whose meters move together are one feature. #131 adds invariance labels
(which features are invariant to camera distance / head rotation) and decorrelation
helpers, so the answer to "which channels should I map?" becomes "these, and they are
actually independent".
