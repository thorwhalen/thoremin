# @thoremin/ext-harmony

thoremin's chord instruments as an extension, the **harmony slice** (#674, H5 of #613):

- the **chord map**: a key's chords on the screen, and the chord hand pointing at one. It holds the chord while the other hand plays a melody on its tones, or strums it. It can follow a MIDI keyboard or the microphone instead of the hand.
- the **chord wheel**: the chord in force sits in the centre, with one move per wedge; push the hand toward a move. The face can steer it.
- the **chord chart**: a conducted piece's chords, played voice-led on the conductor's beat. It needs the conductor slice, and a build without it withholds the chart (#697).

It moved out of the air extension (`@thoremin/ext-air`), which keeps the drum, the bass, the guitar and the flute. Its dial keys (`chordMap`, `chordWheel`, `chordChart`), their versions, the branch ids and every node's params are what they were, so stored settings and saved instruments read back unchanged and every shipped instrument still loads. For now its catalog rows are listed under the air extension's class, "Air instruments"; a class of its own is #705.

It is one `Extension` (`src/index.ts`, pure: nodes, branches, dial slices, transients, overlay elements, shipped instruments, catalog rows, the branch derivation) and one `ExtensionUi` (`src/ui.tsx`: editor sections, status hooks, the MIDI and microphone listeners). It imports only packages:

- `@thoremin/sdk`: the manifest and branch types; the harmony layers (chords, spaces, layouts, navigation, coloration, voicing, clocks); and the pieces it shares with the air guitar: the strum detector and `strumNotes`, the guitar voicing, the note events, the plucked-string sink and the player's hands.
- `@thoremin/sdk-ui` (React side only): the hot store through `controlsFor<typeof HARMONY_EXTENSION>()`, the dial write path and the panel primitives.
- `@thoremin/dag`, zod, zustand and React.

Layout: `nodes/` (the chord map, the chord wheel, the chord chart), `lib/` (the map's layouts and cell tracker, the chart's reduction, MIDI and microphone readings), `app/` (status stores, the MIDI and microphone listeners, the typed controls), `panels/` (the editor sections). The design is `docs/design/harmonic-layers.md` in the app repository.
