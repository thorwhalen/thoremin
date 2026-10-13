# @thoremin/ext-faces

Personal facial-expression categorizers for thoremin ([#330](https://github.com/thorwhalen/thoremin/issues/330)). A player records a take of their own faces; the take is carved into categories (as many as they choose); each category is shown by its faces and named, with defaults from the general expression model matched one-to-one; several categorizers are saved, and an instrument's face chords read one in place of the general model.

This package is phases P2 (the session), P3 (test, correct, tune, import and export), P4 (an instrument chooses its categorizer and the chord each category plays), P5 (shared categorizers) and P6 (the general model is one categorizer) of #330.

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
- **Tune** (at classification time, no retraining; `src/lib/live.ts`). *Sensitivity* scales how far a face is from your resting face (the neutral faces in reject mode, the `neutral` category in partition mode) before it is read: above 1 a smaller face reaches its category. *Reject radius* scales the distance beyond which a face is none of these. Its base is floored, so x1 always accepts at least nine in ten of the categorizer's own faces even when a file carries a tiny radius. In partition mode it is clamped out (nothing is ever rejected). *Distance* takes out what camera distance does to each feature, as the categorizer's own samples show it: the slope of each feature against log face scale within each category, kept only for the features distance explains well (r² at least 0.5). A take recorded at one distance teaches nothing, and the dial says so.
- **Export file**: P1's versioned file (`thoremin.categorizer`, samples, names, feature space), saved as `<name>.categorizer.json`. It is on a fresh carve beside Save (exported under the name typed for Save, else "My faces"; exporting does not save), on every saved row (**Export**, without opening it), and in an open categorizer's test and tune section (#369). No pictures and no tuning: the tuning is about this room and camera, so it stays with the saved record on this device. **Import file** validates, migrates an older version, refuses a newer one, and opens it unsaved, with no pictures.

*Not saved yet* marks a carve, a correction, a merge, an import or a tuning that is not saved; Record, Open, Import and Close the grid ask before dropping it.

Lighting gets no dial: [`docs/research/face-categorizer-lighting-and-distance.md`](../../docs/research/face-categorizer-lighting-and-distance.md) has what was measured.

### Play it: an instrument chooses its categorizer (P4)

In the instrument editor (**Edit** an instrument), the **Face categorizer** section:

- **Reads your face with**: *The general model* (the default, so nothing changes for an existing instrument) or one of your saved categorizers. Choosing one turns the face chords on if the face played nothing yet, and puts every category's chord back to Auto. Three clicks from a cold load: Edit, the section, the categorizer.
- **Or from the tool**: Tools, then Your faces, then **Play it** beside a saved categorizer (#357). It makes the same single `dial.patch` as the select (`chooseCategorizerWrites`) on the current instrument, which is left unsaved like any edit. Once the instrument names it, the row says *Playing* (or *Chosen (face chords off)* when the face plays timbre), since choosing it again would only put its chords back to Auto.
- **Under the section**, one line says what the face chords read with right now: *Reading with* your categorizer, *Loading…*, *Not on this device: the general model plays*, or *The general model*. (The host shows extension readouts under an instrument's row only for the air and sign instruments, so the section is where this one lives; #367.)
- **The chord each of your faces plays**: *Auto* plays the chord this instrument gives the expression the face stands in for (its one-to-one match with the general model, the same match that named it; a face the general model does not recognise takes an expression no other face took). Or pick a degree, or *Silence*.

What plays:

- A face beyond the reject radius for a moment (reject mode) is *none of these* and plays what `neutral` plays: silence by default, like a resting face on the general model. In partition mode the category named `neutral` (the carve's name for the resting face) stands in for `neutral`; rename it and it is a face like any other.
- The instrument keeps the categorizer's **id**, not the model. The model stays in your collection on this device, with its tuning (P3). An instrument that names a categorizer this device does not have plays the general model, and the section says so. A correction saved in the tool reaches the instrument at once.
- The chord choices are kept per category PLACE (`cat-1`, `cat-2`, ...): re-carving or merging into the categorizer can renumber its faces, so check them after one.
- Silence, not hold: a face beyond the reject radius for 8 camera frames (about a quarter second) lets the chord go, so a resting face is quiet as on the general model; a blink is not. The node param `holdOnReject` keeps the last chord instead.
- The general model stays in the graph under yours: it plays until yours has loaded, and whenever the dial names a categorizer that is not there.

How it is built: the dial `faceCategorizer` (`src/schema.ts`: `id`, and a degree per category slot `cat-1`..`cat-12`, Auto by default) composes the branch `face-categorizer`, which **replaces** core's `face-chord` (rule 5 of `composeGraph`) and feeds core's chord renderer (`expression-chord`) the same `face-expression` kind with the player's categories on it (`ExpressionScores.personal`). The node computes the face vector itself from the face frame (no feature claim), and the model arrives on the transient `faceCategorizerModel`, resolved off the tick by the React half's mount effect (`src/app/categorizerPlay.ts`). The node's code loads the first time a composed graph names it.

### Shared categorizers (P5)

Categorizers shipped with the app for every player, listed under **Shared** in *Reads your face with* (the same three clicks from a cold load).

- Each is P1's file, `public/categorizers/<name>.json`, listed in `public/categorizers/index.json` (a label, a line on what it is, and `demo` for a demonstration). The id is `shared:<name>`; a saved categorizer's id is a slug of its name, so the two never collide. The files are fetched the first time the section opens or an instrument names one, so none is in any bundle chunk.
- A shared file that cannot be fetched (offline, a deploy in flight) plays the general model, and the section says so with a **Try again**; a failed fetch is never kept.
- A shared file's categories are given the dial's slot ids (`cat-1`, ...) in order on load, so each one can have its own chord.
- A shared categorizer plays **untuned**: the P3 tuning is about one player's room and camera. **Copy to my categorizers** saves it among your own (under a name none of yours has, by name or by the id the name slugs to, so nothing is replaced) and points the instrument at the copy, keeping the chords you chose. Open the copy in Tools, then Your faces, to tune it or *Retrain on my face*. A copy, not a per-device tuning keyed by the shared id: the tuning dials only make sense next to the live test, which is in the tool, and a model that does not transfer from one face to another needs the retrain anyway, which needs a copy.
- The one shipped today is a **demo** (`demo-smile`), built by `npm run faces:demo` from the repo's own three-second test recording (`test/fixtures/video_face_expressions`) and checked against it by a test. The real shared categorizers are recorded and exported in the app (Tools, Your faces, Export file) and added beside it with an index entry.

### The general model is one categorizer (P6)

The general (shipped) expression model is a categorizer like the others, with the id `general`:

- Its categories are the seven expressions (`happy`, `sad`, `angry`, `surprised`, `fearful`, `disgusted`, `kiss`), each standing in for itself, and `neutral` is its "none of these". Core's `face-expression` emits its readings in the categorizer shape (`ExpressionScores.personal`, from the SDK's `generalReading`).
- The chord renderer and the overlay read only that shape, whichever categorizer made the reading. There is no second, closed-label path. A reading recorded before P6 (no `personal`) is read as the general one (`categorizerReading`).
- Its per-category degrees are the instrument's expression degrees (`faceExpr.degrees`). Each category stands in for itself, so its Auto degree is that map, and no second copy of the map exists. No persisted shape changed, so there is no store migration.
- Instruments play exactly as before: `test/faces/general_categorizer.test.ts` replays the real recording and a scripted face holding all seven expressions. It runs under two degree maps, through `face-chord` and through `face-categorizer` with the dial on `general` or on a missing id, and checks a golden hashed from main before the change.
- The general model stays core's node, not the extension's `face-categorizer`. A build without this extension (`npm run test:core`) must still play the face chords, and an extension node is loaded lazily.

`?faces.source=synthetic` runs the session on a scripted face with a canvas video: no camera and no face model. It is a verification affordance, and the browser smoke drives it.

## Shape

A **lazy** extension ([`docs/design/lazy-extensions.md`](../../docs/design/lazy-extensions.md)). The eager stubs are `index.ts` (the dial, the branch as data, the transient, the derivation; its node type named in `provides`) and `ui.tsx` (the tool and the editor section, as data). The node is `lazy.ts`, loaded the first time a composed graph names it; the React half is `lazy_ui.tsx`, loaded with it or the first time the tool or the section opens.

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
| `src/schema.ts`, `src/dials.ts` | the `faceCategorizer` dial (P4): the categorizer id, a degree per category slot |
| `src/branches.ts` | the `face-categorizer` branch, replacing core's `face-chord` |
| `src/lib/play.ts` | a saved categorizer resolved to play: what each category stands in for, the reading the renderer consumes |
| `src/nodes/face_categorizer.ts` | the node: the face vector, tuned, tracked, read; the general reading passed through without a model |
| `src/app/categorizerPlay.ts` | the dial's id resolved to a model off the tick, published on the transient |
| `src/panels/CategorizerSection.tsx` | the editor section (yours and the shared ones; copy a shared one to your own) |
| `src/lib/shared.ts`, `src/app/sharedModels.ts` | the shared categorizers (P5): ids, the index, the source that fetches them, copy to mine |

The pure pieces that hands will want too are in the SDK. `@thoremin/sdk/enroll/carve` holds `createCarver` and `neutralIndices`. P1 provides the matcher, the exemplars and the file.
