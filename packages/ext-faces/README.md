# @thoremin/ext-faces

Personal facial-expression categorizers for thoremin ([#330](https://github.com/thorwhalen/thoremin/issues/330)). A player records a take of their own faces; the take is carved into categories (as many as they choose); each category is shown by its faces and named, with defaults from the general expression model matched one-to-one; several categorizers are saved.

This package is phase P2 of #330: the session. Using a saved categorizer in an instrument is P4.

## In the app

Tools, then **Your faces**, then **Record my faces**: a few seconds of rest, then each face you want the instrument to know, holding each for a moment. **Stop and carve** shows the grid:

- **Neutral**, stated plainly. *Neutral means "none of these"* (the default): faces close to your resting face are set aside and read as nothing, so k counts only your expressions. *Every face is a category*: your resting face is a category too, so k counts it (expressions + 1). The line under the switch says which one is in use.
- **How many**: a slider starting at the suggested k. Moving it re-divides the same take, with no new recording.
- **Names**: one click on a name to edit it. A name you typed is kept when k changes; the others are proposed again, one-to-one, by the general model (`neutral` for the resting category in partition mode, `expression n` when nothing fits).
- **Pictures**: per category, the most typical face first, then less typical ones. They are grabbed from the take's video, kept in memory until you save; then they are filed in IndexedDB.
- **Save** under a name. Saving under an existing name replaces that categorizer. Saved ones can be reopened (k is fixed without the take) or deleted.

Nothing leaves the browser. The take's video is never written to disk, and only the small stills of a saved categorizer are kept.

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
| `src/app/models.ts` | the saved categorizers: a zodal named collection of P1's versioned file |
| `src/panels/FaceSessionPanel.tsx` | the panel |

The pure pieces that hands will want too are in the SDK. `@thoremin/sdk/enroll/carve` holds `createCarver` and `neutralIndices`. P1 provides the matcher, the exemplars and the file.
