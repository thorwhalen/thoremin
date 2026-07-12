# Instrument library — favorites, tags, system tags, summaries

> **Status:** implemented (2026-07, epic #116 — issues #112 / #113 / #114 / #115,
> PR #121). This document is the single source of truth for the library layer
> (`src/app/library/`). The instruments themselves live in `src/app/dials/instruments.ts`;
> this is the metadata *about* them.

## Vocabulary first (this is where a collision was killed)

- **Sound** = a timbre preset (sine / bell / reed). `src/music/sounds.ts`.
- **Instrument** = a **named saved dials profile** — a complete settings snapshot.
  `src/app/dials/instruments.ts`.
- **Tag** = a keyword on an *instrument*. This file.
- **Annotation** = a live time-anchored mark on a *recording*. `src/app/tagging/`.

Annotations used to also be called "tags" (and shared the same icon). PR #125 renamed
them. Do not re-collide these.

## The idea in one line

Instruments were an unordered list of names. The library makes them **browsable and
self-describing**: star what you use, tag what you make, and let the app derive the
rest — so you can tell two instruments apart without opening either one.

## Layering

```
src/app/dials/instruments.ts     the instruments themselves (a Layer per name)
             ▲
src/app/library/                 metadata ABOUT them — this layer
  model.ts       Zod SSOT: Tag, InstrumentMeta (favorite + tag ids)
  store.ts       persistence (two shapes, see below)
  summarize.ts   Settings -> InstrumentSummary   (pure)
  systemTags.ts  InstrumentSummary -> SystemTag[] (pure)
  derive.ts      the bridge: a saved sparse Layer -> the two above
  emoji.ts       curated pool + keyword search + auto-assign
  *.tsx          the UI (tags editor, tag manager, emoji picker)
```

The pure modules (`summarize`, `systemTags`, `model`, `emoji`) know nothing about the
dials store or React; `derive.ts` is the single place that reaches into both. That is
what keeps the projection unit-testable.

## Decision 1: stable hidden ids, editable labels (#113)

A tag is `{ id, label, emoji }`:

- **`id`** is a stable, hidden slug. It never changes. It is the association key —
  instruments reference tags by `id`.
- **`label`** and **`emoji`** are freely editable.

So **renaming a tag can never orphan an association.** This is the whole reason the id
exists. The naive model (tag = its string label, instruments store label strings) breaks
the moment a user fixes a typo in a tag name: every instrument silently loses it. The
indirection costs one lookup and buys correctness under the single most likely edit.

## Decision 2: system tags are derived-on-read and namespaced (#114)

Some facts about an instrument are worth seeing at a glance but should never be
hand-maintained: its scale quality, whether notes come from the index finger or the
wrist, what the face is doing, whether the voices are split, whether fingers are routed
to effects. These are **system tags**.

- They are **derived on read** from the instrument's parametrization — a pure function.
  A stale system tag is therefore **impossible**; edit the instrument and the tag
  follows on the next render.
- They are **never persisted**. Only *custom* tag ids ever land in an instrument's
  `tagIds`.
- They are namespaced **`sys:*`**, and `TagSchema` has a `.refine` that **refuses** a
  custom tag id using that prefix. So a derived id can never be mistaken for a custom
  one, cannot be renamed or deleted through the tag manager, and a stale persisted id
  (from some future bug) is filtered defensively on read.

They render exactly like custom tags — an emoji chip with a tooltip — so the list stays
one visual language. The emoji glyph pool for custom tags **deliberately excludes** the
system-tag glyphs, so a user's cat emoji can never collide with a derived one in the
same column.

## Decision 3: one summary, two consumers (#114 + #115)

`summarizeInstrument(settings) → InstrumentSummary` is a pure reduction: scale, both
voices, the control sources (note source, face mode, finger FX), and **only the
non-default** master tweaks.

It has two consumers, and that is the point:

- the **parametrization tooltip** (#115) renders it directly;
- the **system tags** (#114) derive from it.

They cannot disagree, because they read the same projection. If the tooltip says
"pentatonic minor", the scale-quality chip *is* the pentatonic-minor chip. Had #114 and
#115 each computed their own view of the settings, they would have drifted the first
time a scale was added.

"More than the list row, less than the settings editor" is the design constraint that
keeps the tooltip a glance rather than a second editor.

## Decision 4: persistence shape follows what the datum *is*

Per the project's zodal rule, both are schema-first — but they are not the same shape:

| Datum | Shape | Why |
|-------|-------|-----|
| **Custom tags** | a `@zodal/store` `DataProvider<Tag>` collection (localStorage adapter in the browser, in-memory in tests) | It is a browsable collection of named things — the tag manager lists / creates / renames / deletes them. This is the canonical zodal collection case, exercised end-to-end. |
| **Per-instrument metadata** (favorite + tag ids, keyed by name) | one Zod-validated JSON blob behind a small localStorage seam | It is an *attribute map*, not a browsable list. Nobody ever "lists all metadata records". Modeling it as a collection would be ceremony. |

The single **default-instrument** pointer stays where it already lived
(`src/app/dials/instruments.ts`) rather than moving here — #112 moved "default" out of
the *star* (it was overloading favorites), not out of its home.

## Decision 5: emoji without a dependency

Tags want emoji: an auto-assigned one for a new tag, and keyword search ("type `cat`,
get 🐱"). The obvious move is to pull in `emojilib` / `node-emoji`.

Instead: a single curated pool of ~110 high-contrast, single-glyph emoji with
hand-written keywords, serving **both** roles. Rationale: it honors the no-backend,
dependency-cautious ethos for what is, after all, a tags feature; and — more usefully —
the pool is **biased toward mutual contrast at small size**, so a row of tag emoji in a
list column stays easy to tell apart. A full emoji set optimizes for coverage; a list
column needs the opposite.

If broad "search any emoji" is ever wanted, swapping the search corpus for a lazy
`emojilib` import is a drop-in change behind `searchEmoji()`; the curated pool stays the
auto-assign source.

## Sparse layers, resolved

A saved instrument is a **sparse** dials `Layer` and may carry the dials `UNSET`
sentinel (a symbol) for keys the user reset. `derive.ts` merges the layer over the flat
dials defaults and drops symbol values, so the projection sees the same **effective**
settings the live engine would — without mutating the live dials store. Every read path
goes through it.

## What is verified

`test/library_model.test.ts` (the id/prefix invariants), `library_store.test.ts` (both
persistence shapes, against an in-memory provider), `library_summarize.test.ts`,
`library_systemtags.test.ts`, `library_derive.test.ts` (sparse + UNSET resolution),
`library_emoji.test.ts`.

## Flagged for sign-off

Two sets are explicit **proposals** in the code, not settled design: the system-tag
emoji/label map (`SCALE_QUALITY_TAGS` et al. — colored circles, with the M/m/P/p letter
cue in the tooltip) and the curated `EMOJI_POOL`. Both are one-line edits.
