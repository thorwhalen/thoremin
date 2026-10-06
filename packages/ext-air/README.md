# @thoremin/ext-air

thoremin's air instruments as an extension: the **air drum** (strike the air, hear a drum at the strike, on pads you lay out), the **air bass** (the fretting hand's distance from the plucking hand picks the note), the **air guitar** (strum chords you enrolled) and the **air flute** (enrolled finger lifts choose the note, an enrolled blowing mouth sounds it).

It is the first extension, and the proof of the manifest: one `Extension` (`src/index.ts`, pure: nodes, branches, dial slices, transient ports, shipped instruments, training routes, the branch derivation) and one `ExtensionUi` (`src/ui.tsx`: editor sections, status hooks, mount effects). The app lists it in `extensions.json`; a build that leaves it out ships none of its code (`npm run test:core` checks that).

It imports only packages:

- `@thoremin/sdk`: the manifest and branch types, the trainer's pure core, the feature catalog, music theory;
- `@thoremin/sdk-ui` (React side only): the hot store through `controlsFor<typeof AIR_EXTENSION>()` (typed by this manifest; `src/app/controls.ts`), the dial write path, the panel primitives;
- `@thoremin/dag`, `@thoremin/ictus` (musical time), zod, zustand, `@zodal/store`, React.

Its pure side (`src/nodes`, `src/lib`, the root `.ts` files) never imports `@thoremin/sdk-ui`: the real-time path cannot reach the hot store or the command dispatch.

Layout: `nodes/` (the four instruments and their two sinks), `lib/` (vocabulary, fingering charts and prior, note names, hand shape, guitar voicings, drum patterns, General MIDI drums, the pattern fit and play), `app/` (status stores, taps, enrolment and training components, pattern and pad collections, starter sequences), `panels/` (the editor sections). The research behind it is `docs/research/air-instruments.md` in the app repository.
