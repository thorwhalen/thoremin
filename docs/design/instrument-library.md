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

## Decision 7: the instrument spec is a join, and the derivation stays authoritative (the instruments-as-graphs ADR, PR 4)

The ADR's `InstrumentSpec` (`src/instruments/spec.ts`) is what the library lists, what the UX stream's collection and gallery are built on, and what the trainer reads its per-instrument link from. It is **one Zod schema describing one record**, but it is **not a third store**: an instrument stays persisted where it already was, in two places keyed by the same name.

| Field | Lives in | Why there |
|---|---|---|
| `settings` (the Layer) | the dials profile store (`src/app/dials/instruments.ts`) | what the instrument sounds like; unchanged, every saved instrument keeps working |
| `tags`, `starred` | this library's metadata record | as before (Decisions 1 and 4) |
| `class` | the metadata record, as a **cache** | `useLibrary().categoryOf` answers from it before the derivation has run (the list still waits for `derivedReady`); rewritten by the library whenever the derivation disagrees, once both the record and the derivation are loaded; **never a vote against it** ("an air instrument wins", Decision 6) |
| `branches` | the metadata record, **optional** | an explicit branch set; absent means "derive from the dials" (`branchIdsFor`), which is what every instrument saved before PR 4 does; an EMPTY list is explicit (a trunk-only, silent instrument). Only ids the branch table knows are written, and the derivation drops unknown ones rather than throwing |
| `emoji`, `starred` | the metadata record | the card's glyph and the favourite flag the gallery needs |
| `training` | the metadata record, optional | where "train this instrument" goes; the trainer stream resolves the route |
| `image` | the metadata record, optional | a REFERENCE for the gallery (a URL, an app-relative path, a store key), never bytes |
| `features` | derived | the facet the view filters on besides class and tags: the instrument's branch ids |

`assembleSpec(parts)` joins the three sources and is the only place that knows the rule for each field; `useLibrary().specOf(name)` exposes the result once the instrument has been derived, next to `branchesOf` / `setBranches`, `trainingOf` / `setTraining`, `imageOf` / `setImage`. `features` is the closure of the branches (requirements included) minus the trunk, so a spec naming `face-chord` is found under `face-source` too.

**Explicit branches at runtime are deferred, on purpose.** `branchIdsFor(settings, { explicit })` honours an explicit set and still unions what a live tool demands (a Trainer claim on a face group brings the face source in: a tool's need is not the instrument's to veto). The engine host does not pass `explicit` yet. A first cut carried the set into the hot store as a transient field on `selectInstrument`; the review showed it going stale on "Save as new", on undo of `instrument.load`, and on reload, and it changed the sound through something that is not a dial. So the runtime hook lands with the first UI that writes branches, as a dial or a command, restored on undo and reload. Until then every instrument composes from its dials, exactly as PR 3 left it.

A record is kept in the blob while it says anything a default record does not (`metaHasInformation`): the first cut pruned on stars and tags alone, and starring one instrument wiped every other's branches, training link and image.

Why a join rather than a new collection: the metadata record already IS the "attribute map" of Decision 4, and the four new fields are attributes; a new collection would have replaced the profile store's contract that every instrument test exercises directly, for no gain in behaviour. No migration was needed: the record's Zod defaults heal an old record, and the class cache is written by the library once both the record and the derivation are loaded, then rewritten whenever the derivation disagrees. The pure model tests (`test/instruments/spec.test.ts`) pin the rules; nothing exports or imports instruments yet, and when something does it serialises this record and applies `normaliseClassId` on the way in.

## Decision 8: the view is a rendering of a zodal collection (Round 4, Discussion #272)

The maintainer's rule: *zodal objects specify the affordances of the collection abstractly, and its rendering is a separate thing.* So the Instruments view no longer filters and sorts by hand.

- **The declaration** is `src/app/library/instrumentsCollection.ts`: `defineCollection(InstrumentSpecSchema, …)` declares the search (the name today), the sort orders (`INSTRUMENT_SORTS`: library order, starred first, by name), the grouping by `class` (collapsible, open by default), the field affordances (the settings Layer is never listed, searched or sorted; `image` is a small reference, so metadata), and the operations (play, edit, star, make default; save the current sound as a new instrument).
- **The data** reaches a view through a `DataProvider` over the library's assembled specs (`createSpecsSource`). It is read-only: writes stay with the library and the profile store, which own them (Decision 7).
- **The query state** is `@zodal/ui`'s generated zustand slice (`instrumentsCatalog.ts`). A view hands over the specs, the search text and the sort, and reads `items`.
- **The rendering** is `InstrumentsPanel`'s list. It is a temporary in-repo stand-in for zodal's collection-view renderer ([i2mint/zodal#14](https://github.com/i2mint/zodal/issues/14)), as the remembered view choices will be for [i2mint/zodal#15](https://github.com/i2mint/zodal/issues/15); both are tracked in [#283](https://github.com/thorwhalen/thoremin/issues/283). Facet counts come from `@zodal/groups-core`'s `facetPanel` (no stand-in needed).

What follows on this seam, each an addition rather than a rewrite:

- **Option A (shipped).** One line per instrument: the name, its tags inline, the star and the gear, with a stripe down the row in its class's colour (`INSTRUMENT_CLASSES[].colour`, the class registry's SSOT) and a swatch on the class heading. Each class heading collapses its class (the collection declares `groupBy.collapsible`, open by default). A collapsed class keeps its count and names the instrument being played when it is in there, so the list never hides what you hear. The collapsed classes are remembered per browser: a Zod-schema'd record through a `DataProvider` (`instrumentsViewPrefs.ts`), the stand-in for [i2mint/zodal#15](https://github.com/i2mint/zodal/issues/15). The help paragraph under the list is gone; each row's tooltip says what the instrument does. All 17 shipped instruments fit at 1440x900 with no scrolling.
- **Option B (shipped).** One search box finds an instrument by its name and by what it is: its class, its tags (custom and system), its tooltip's summary ("note source: wrist") and what it uses (the branches it composes). The item is the spec plus a derived `searchText` (`InstrumentListItemSchema`, searched, never shown; built by `instrumentsListing.ts`), so `INSTRUMENT_SEARCH_FIELDS` is `['name', 'searchText']` and the provider still does the matching. A row matched on something other than its name says what, in grey. Behind a **Filters** toggle, chips in four families (class, starred, tags, uses) narrow the list, with live counts from `@zodal/groups-core`'s `facetPanel` (`instrumentsFacets.ts`):
  - selections are OR within a family and AND across families;
  - each family's counts ignore its own selection (the N+1 rule), so an unpicked chip never reads 0.

  The chips stay open while any filter is on, so what is filtered is always visible. A selected chip stays (at 0) even when no instrument has that value any more, so it can always be undone. Chips keep a fixed order (classes in the registry's order, the rest by label), so none moves under the pointer as counts change. "Uses" leaves out what another facet already says (`field-voices` is the Field class, an air branch is its air instrument's tag). The search matches values, not the label words, so "class" or "tag" match nothing. The selection lasts one visit on purpose: a filter remembered across visits would hide instruments from a player who has forgotten setting it. If the filters hide the instrument being played, the list says so. ("All 17 fit" in option A is with the Filters closed.)
- **The gallery (shipped).** A second rendering of the same collection: the collection declares `views: ['list', 'grid']`, and a toggle in the panel header switches between them. The choice is remembered in the same view-prefs record as the collapsed classes, so the next visit opens on the view chosen last; the default is the collection's `defaultView`, the list.
  - Each instrument gets a card: its picture, its name, its tags, the star and the gear. The class colour runs across the card's top edge, and the same groups, search and filters apply.
  - The picture is the spec's `image`, a reference (a URL, or a path under the app's `public/`), set from a Picture field in the instrument's editor through `useLibrary().setImage`.
  - It loads the frontend-UX way (`InstrumentPicture.tsx`): a shimmer the instant the source changes, a fade-in on load, a fresh element per source, and the tile on error.
  - An instrument without a picture gets a tile in its class colour, with a glyph that tells it apart: its own emoji, else its air instrument's (🥁 🎸 🤘 🪈), else its initials. A gallery of identical glyphs would say nothing.
  - The panel widens for the gallery, up to 40rem, but never so far that it runs under the left-hand tool panels on a tablet (`smoke/tests/occlusion.smoke.ts` checks 820x1180 with each panel open). The columns follow the width.
  - The picture field refuses `data:`/`blob:` pictures and caps a reference at 2048 characters. A pasted multi-megabyte data URL would be bytes in the metadata record, and would fill localStorage until the library silently stopped saving.
  - A card says what a row says: the "(default)" and "edited" markers, and why it matched a search.

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
