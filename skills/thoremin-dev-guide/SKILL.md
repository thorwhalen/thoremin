---
name: thoremin-dev-guide
description: >-
  Keeping thoremin's guides true. The PLAYER guide (in the app, served at /thoremin/guide/, sources in
  guide/, built to public/guide/) must change whenever a player can find something new or different: a new
  or renamed instrument (seed), a new tool or shell control, a new or removed section of the instrument
  editor, a behaviour a player would notice. Use when you add or change a seed in SEED_INSTRUMENTS or an
  extension's `instruments`, add a tool (src/app/tools/tools.ts, a slice's tool.ts), add an editor section
  (an extension's `panels`), change what an instrument does, see test/guide_coverage.test.ts fail, or are
  asked to "update the guide / docs / user guide / how-to-play page / screenshots". Triggers on "player guide",
  "guide page", "guide:media", "npm run guide", "shipping rule 4", "guide entry". The private RESEARCH guide
  (research, ADRs, horizon) has its own section below: "research guide", "a research doc / ADR / decision
  landed", "update guide.json", "npm run research-guide", "staleness report".
metadata:
  audience: developers
---

# thoremin-dev-guide: the guides, and how they stay true

## Which guide

- **Player guide** (this repo, public, in the app): what works today and how to play it. Linked from the app's Tools menu ("Guide", two clicks from a cold load) and from each instrument's editor ("Guide: how to play this"). Sources `guide/`, built to `public/guide/`, served at `<base>guide/`.
- **Research guide** (private, for the maintainer only): research, ADRs, experiments, the horizon. Never deployed with the app. Its section is below.

## Player guide

### The rule (shipping rule 4 in CLAUDE.md)

A feature a player can find has a guide entry. `test/guide_coverage.test.ts` enforces it in `npm test`: every seed, every tool and shell control, and every section of the instrument editor must have an entry, and every instrument and tool page must have its picture. A new one without an entry fails CI with a message saying what to add.

### Adding an entry

1. **A new instrument (seed).** Create `guide/instruments/<slug>.md` (the slug of its name: `Chord Map + Face` is `chord-map-face`; `guideSlug` in `src/app/guide/links.ts`):

   ```
   ---
   seed: Chord Map + Face          # the exact name in SEED_INSTRUMENTS
   area: chords                    # field | air | chords | sign (guide/areas.json)
   do:                             # the two or three things to do, plain words
     - Point at a chord with your left hand.
     - Smile to turn the chord major.
   settings: Chord map, Face       # editor section names; each must be a section of guide/settings.md
   ---
   One short paragraph: what it is, in the player's words.

   :::details How it works
   ...
   :::
   ```
2. **A new tool or shell control.** `guide/tools/<id>.md` with `tool: <id>` (the tool's id), `title:`, `do:` (as above). Links out of the app (the manual, the guide) need no page.
3. **A new editor section** (an extension's `panels`, or a core section): add `## <Name> {#<slug>}` to `guide/settings.md` and say what the section is for. A removed section loses its heading.
4. **Links between pages**: `[text](instrument:Name)`, `(tool:id)`, `(settings:Name)`, `(area:id)`, `(manual:)`, `(app:)`. The builder fails on a link that names nothing.
5. `npm run guide` (writes `public/guide/*.html`; `npm run guide:check` fails when the committed pages are stale; the coverage test runs the same check). Commit the generated pages with the sources.
6. **The picture**: `npm run build`, then `npm run guide:media -- --only "<Instrument name>"` (or `--only tool:<id>`). It captures the BUILT app on the synthetic sources and writes `public/guide/pics/<slug>.jpg` (`tool-<id>.jpg` for tools). Per-scene knobs (extra query, settle time, a clip) are data in `smoke/guide_scenes.json`. Commit the picture.

### Media rules

- Generated from the app, on synthetic sources only (`?slot.source=synthetic-hands`, `slot.body=synthetic-body`, `?carve.source=synthetic`): never a real person, never a screenshot from a real camera.
- Small: a picture is a JPEG about 960 wide, a clip a short silent webm. The whole `public/guide/pics/` has a budget (6 MB, in the coverage test); say the total in the PR.
- Regenerate pictures when what they show changes (a redesigned panel), not on every commit. Never hand-edit a generated page: change the source, rebuild.

### Voice

Player-facing, plain words, second person ("Hold a hand up"), short sentences. No jargon: say "chord", "pitch", "the camera", not "DAG", "node", "slice", "extension" or issue numbers. Each page: what to do in three lines first, then "How it works" and "Settings" collapsed (`:::details`). Say what is NOT possible honestly (needs Chrome, needs a mic). No hard-wrapped lines in `.md` (one paragraph, one line).

### When to update it

New or renamed seed; new or removed tool; a section added or removed; a visible behaviour changed (a gesture, a default, what a setting does); a browser limit found. Also when a "needs X" statement becomes false. A change to internals does not need a guide change.

### Where the pieces live

`guide/` sources (`areas.json`, `index.md`, `settings.md`, `troubleshooting.md`, `instruments/`, `tools/`, `guide.css`); `scripts/lib_guide.ts` (the builder) and `scripts/gen_guide.ts` (`npm run guide`); `smoke/guide_media.mjs` and `smoke/guide_scenes.json` (`npm run guide:media`); `src/app/guide/` (the address functions and the editor's link); `test/guide_coverage.test.ts` (the guard). `docs/USER_GUIDE.md` is a pointer to the guide.

## Research guide

The owner's PRIVATE guide to thoremin's research, experiments, ADRs, decisions and horizon (epics, open issues by theme, what waits on the owner). Built outside the repo and published to annals; never deployed with the app, never committed. Details: `scripts/research_guide/README.md`.

When a research doc (`docs/research/`), a design doc or ADR (`docs/design/`), a measured experiment (a PR whose body states a number and a verdict) or a decision (a choice on #168, #602, #614 or another decision issue) lands:

1. Add or update its record in `scripts/research_guide/guide.json` (the schema is `scripts/research_guide/schema.ts`): a doc entry (area, a one-paragraph abstract written from the doc, status, 1-4 key numbers, issues, PRs), an experiment (headline number, verdict), or a decision (status, what it decided). Public material only: `test/research_guide.test.ts` fails on a `private:` path or an absolute local path. A private working note goes in the overlay `private.json` in the guide's home instead.
2. Rebuild and republish: `npm run research-guide -- --publish` (with `THOREMIN_GUIDE_SESSION=<your session name>`). It prints the staleness report: NEW, CHANGED, UNCURATED (no entry yet: the guide shows it as "new, needs an abstract"), MISSING docs, decision issues updated since the last build, new manual-task issues. An UNCURATED or CHANGED line is the to-do list for step 1.
3. Once annals has `--replace` (thorwhalen/annals#10), the publish replaces the same document, so the owner keeps one link; the id is kept in the guide's `state.json`.

thoremin-iq rebuilds after every deploy with the same command. `--offline` reuses the cached GitHub data (for a copy fix).
