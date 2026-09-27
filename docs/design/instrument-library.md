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
  category.ts    the air instruments + the list's groups (pure, #249)
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

## Decision 6: one place to choose any instrument; categories are derived (#249)

The maintainer's rule: *the air instruments are instruments like the others, of a different category, and there is one place to choose instruments from.* The air drum shipped first as a shell **tool** (#233, a tools-bar panel with a Start button); #249 retired that panel. It is now the shipped **Air Drum** instrument, listed in the Instruments view under an **Air instruments** group and chosen by the same click as any theremin.

- **The category is derived, like a system tag.** `category.ts` holds `AIR_INSTRUMENTS` (id, label, emoji, and the predicate that reads the instrument's dial). An instrument that plays any of them is in the `air` class, otherwise `field`, shown as **Field instruments** (`INSTRUMENT_CLASSES`: id, label, emoji, colour). Nothing is persisted, so a player who ticks "Drum in the air" on their own theremin and saves it finds it with the air instruments, and a stale category is impossible.
- **An air instrument wins.** A theremin with a drum added is listed with the air instruments: the drum is the less discoverable part, and it is what the player would look for.
- **Air instruments tag and describe themselves.** Each gets a system tag (🥁 for the drum), first in the row. An air instrument that silences the theremin voices (hand-map max gain 0, as the Air Drum seed does) drops the tags and tooltip rows that describe those voices (scale, note source, split voices, finger FX, range, magnetism, octave shift). The Air Drum seed also hides the note grid and the note names on the hands.
- **The air instrument's settings are its section of the editor.** The editor opens an air instrument's section first and open when the instrument being edited is that air instrument. This is decided once, when the editor opens, from the saved category, so ticking the box or saving never makes the section jump. The live readout the retired panel carried (floors learned, hits, the last hit's lead) lives in that section. It also shows under the chosen row whenever that air instrument is live, including a drum left on over a theremin. The pad editor (#245) builds on the drum's section.
- **Pure and React halves.** `category.ts` (React-free) says which air instruments exist; `src/app/dials/panels/air.tsx` (`AIR_UI`) gives each one its editor section and readout. The `satisfies Record<AirInstrumentId, …>` makes a new category entry fail to typecheck until it has UI, so neither `InstrumentsPanel` nor `DialsControlsPanel` names an air instrument.
- **No wrong group on load.** The list is grouped only once every name it shows has been derived (`useLibrary().derivedReady`), so the Air Drum never flashes under the field instruments.
- **No instrument is a tool.** `tools.ts` is for things you use *on* the instrument; `test/air_instruments_view.test.tsx` is the reachability walk (cold load → Air instruments → Air Drum → one click plays it) and guards that no tool shadows an air instrument.

- **Why "Field instruments".** Every non-air instrument plays through `voice_mapping.ts`: the hand's x is the scale-snapped pitch, its y the volume, so the hand plays a note field laid across the screen (the grid the scale guide draws). An air instrument instead mimes a real instrument's action (strike, pluck, strum, finger and blow) and sounds on the event. The maintainer chose the label on 2026-09-27 over "Theremins" (a real theremin is unquantised), "Glide" and "Position" instruments. The id is `field` (it was `theremin` until PR 2 of the instruments-as-graphs ADR); `normaliseClassId` maps the old id forward at the read boundary, and nothing persists a class id yet, so the rename was code-only.
- **An air instrument may play the scale.** The air bass's neck is quantised to the instrument's own scale (the Sound section), so its entry says `usesScale: true` and the list keeps its scale tag and the tooltip's Scale and Range rows even with the theremin voices silent. The drum says `false`.

Adding an air instrument (guitar, bass, flute) is one `AIR_INSTRUMENTS` entry, one `AIR_UI` entry and a seed. The air bass (PR 2 of #249) is the worked example: `src/nodes/music/air_bass.ts` (the neck and the pluck), `src/nodes/output/pluck_out.ts` (plucked notes on the audio clock), `src/app/dials/panels/airBass.tsx`, `src/app/airBassStatus.ts`, and the `airBass` dial.

- **An air instrument may need an enrolment step, and it lives in the instrument's own section.** The air guitar (PR 3) plays only the chords the player has shown it (a chord is not a hand shape across players, `docs/research/air-instruments.md` §6.4). Its section opens on "Your chords": type a name, press Learn, hold the shape for two seconds. The samples are a zodal collection (`src/app/air/vocabularyStore.ts`, one record per air instrument, per browser: it describes the player's hands, not an instrument profile); the classifier is derived from them (`src/air/vocabulary.ts`) and reaches the DAG through the hot store's transient `airGuitarModel`, like the conductor's score. The samples come from the node's own `shape` output, so enrolment and play see the same numbers.
- **The flute has two enrolment steps in the same component.** The air flute (PR 4) enrols its fingerings by note name (both hands) and, unless its Breath is "fingers only", two FIXED mouth states, blowing and resting (`VocabularyEnrolment`'s `fixedLabels`). Three vocabularies now live in the one collection (`guitar`, `flute-fingers`, `flute-mouth`), each a `createVocabularyState` call; `loadAirVocabularies()` reads them all at app start. The flute's sustained voice joins the others at the synth merge (its fifth input), so the synth, MIDI out and the overlay get it too.

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
`library_emoji.test.ts`, `library_category.test.ts` (categories, air summaries and tags), `air_instruments_view.test.tsx` (the reachability walk and the readout), `air_seed_upgrade.test.ts` (a version-3 browser gains the Air Drum).

## Flagged for sign-off

Two sets are explicit **proposals** in the code, not settled design: the system-tag
emoji/label map (`SCALE_QUALITY_TAGS` et al. — colored circles, with the M/m/P/p letter
cue in the tooltip) and the curated `EMOJI_POOL`. Both are one-line edits.
