# @thoremin/ext-faces

Personal facial-expression categorizers for thoremin ([#330](https://github.com/thorwhalen/thoremin/issues/330)). A player records a take of their own faces; the take is carved into categories (as many as they choose); each category is shown by its faces and named, with defaults from the general expression model matched one-to-one; several categorizers are saved.

This package is phases P2 (the session) and P3 (test, correct, tune, import and export) of #330. Using a saved categorizer in an instrument is P4.

## In the app

Tools, then **Your faces**, then **Record my faces**: a few seconds of rest, then each face you want the instrument to know, holding each for a moment. **Stop and carve** shows the grid:

- **Neutral**, stated plainly. *Neutral means "none of these"* (the default): faces close to your resting face are set aside and read as nothing, so k counts only your expressions. *Every face is a category*: your resting face is a category too, so k counts it (expressions + 1). The line under the switch says which one is in use.
- **How many**: a slider starting at the suggested k. Moving it re-divides the same take, with no new recording.
- **Names**: one click on a name to edit it. A name you typed is kept when k changes; the others are proposed again, one-to-one, by the general model (`neutral` for the resting category in partition mode, `expression n` when nothing fits).
- **Pictures**: per category, the most typical face first, then less typical ones. They are grabbed from the take's video, kept in memory until you save; then they are filed in IndexedDB.
- **Save** under a name. Saving under an existing name replaces that categorizer. Saved ones can be reopened (k is fixed without the take) or deleted.

Nothing leaves the browser. The take's video is never written to disk, and only the small stills of a saved categorizer are kept.

### Test, correct and tune a saved one (P3)

**Open** a saved categorizer (or **Import file**). Under its grid:

- **Test with my face**: a live readout of what it reads. The settled category (with a short hysteresis), each category's membership, and *None of these* when a face is beyond the reject radius (reject mode). The instrument stays quiet while testing.
- **Correct it**. *This face is X* adds the face you are holding (the last quarter second, raw) to X as a new sample. The menu under each picture moves that face to another category, or out of every category (reject mode, where it then counts as neutral). A category keeps at least one face. Every correction re-derives the model from the samples (`modelFromCategorizer`), so it is a retrain, not a patched centroid.
- **Add faces**. *Add more of my faces* records a short take and merges it in (P1's `mergeSession`, seed `samples`): each new face joins its nearest category and everything already there stays. *Retrain on my face* (seed `centroids`) keeps only which category is which and learns every category again from your take; it is for a categorizer someone else made.
- **Tune** (at classification time, no retraining; `src/lib/live.ts`). *Sensitivity* scales how far a face is from your resting face (the neutral faces in reject mode, the `neutral` category in partition mode) before it is read: above 1 a smaller face reaches its category. *Reject radius* scales the distance beyond which a face is none of these. Its base is floored, so x1 always accepts at least nine in ten of the categorizer's own faces even when a file carries a tiny radius. In partition mode it is clamped out (nothing is ever rejected). *Distance* takes out what camera distance does to each feature, as the categorizer's own samples show it: the slope of each feature against log face scale within each category. A take recorded at one distance teaches nothing, and the dial says so.
- **Export file**: P1's versioned file (`thoremin.categorizer`, samples, names, feature space). No pictures and no tuning: the tuning is about this room and camera, so it stays with the saved record on this device. **Import file** validates, migrates an older version, refuses a newer one, and opens it unsaved, with no pictures.

*Not saved yet* marks a carve, a correction, a merge, an import or a tuning that is not saved; Record, Open, Import and Close the grid ask before dropping it.

Lighting gets no dial: [`docs/research/face-categorizer-lighting-and-distance.md`](../../docs/research/face-categorizer-lighting-and-distance.md) has what was measured.

`?faces.source=synthetic` runs the session on a scripted face with a canvas video: no camera and no face model. It is a verification affordance, and the browser smoke drives it.

## Shape

A **lazy, tool-only** extension ([`docs/design/lazy-extensions.md`](../../docs/design/lazy-extensions.md)). The eager stubs total about 0.5 kB: `index.ts`, which ships no node, dial or branch, and `ui.tsx`, which declares the tool as data. Everything else is in `lazy_ui.tsx`, which loads the first time the tool opens.

| Path | What |
|---|---|
| `src/lib/take.ts` | the take as a pure state machine (rest, then faces, then a built session) |
| `src/lib/carving.ts` | the grid for one carve: model at k in a mode, names, exemplars; a saved categorizer's grid |
| `src/lib/synthetic.ts` | the scripted face |
| `src/app/sessionStore.ts` | the session's state, every dependency injected |
| `src/app/faceSession.ts` | that store over the browser's dependencies |
| `src/app/sources.ts` | the input seam: live (the trainer's tap and the raw camera) or synthetic |
| `src/app/videoTake.ts`, `thumbnails.ts` | the in-memory video; stills grabbed by seeking it, and their IndexedDB store |
| `src/app/models.ts` | the saved categorizers: a zodal named collection of P1's versioned file, plus the take id and the live tuning |
| `src/lib/live.ts` | a categorizer read live: the tuning (sensitivity, floored and clamped reject radius, distance residual) and the reader |
| `src/lib/corrections.ts` | the corrections as edits of the samples (add a live face, move a sample) |
| `src/app/testStore.ts` | the live test: polls the source, feeds the reader, publishes at UI rate, holds its own claim |
| `src/panels/TestAndTune.tsx` | try it, correct it, add faces, tune it, export; the import button |
| `src/panels/FaceSessionPanel.tsx` | the panel |

The pure pieces that hands will want too are in the SDK. `@thoremin/sdk/enroll/carve` holds `createCarver` and `neutralIndices`. P1 provides the matcher, the exemplars and the file.
