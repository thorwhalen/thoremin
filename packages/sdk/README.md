# @thoremin/sdk

The pure half of thoremin's extension SDK: everything an extension's nodes, libraries and manifest may import. It is the module set an extension actually needs, cut along the boundary the extension guard used to keep by test (`SDK_SURFACE` in `test/extensions_boundary.test.ts`), so the package boundary now enforces it.

- `instruments/{extension,branch,trunk,derive}`: the `Extension` manifest (`defineExtension`, `dialSlice`), `GraphBranch` (`defineBranch`), and the trunk's node names to wire to.
- `nodes/domain`: the port kinds and the stream types (hands, faces, voices); `nodes/music/drum_{pads,anchor}`: the drum geometry the overlay also draws.
- `features/*`: the feature catalog and feature demand; `enroll/*`: the trainer's pure core (cues, noise units, sampling, sufficiency, classification); `music/*`: theory, sounds, notes, fingerings, drum patterns, General MIDI drums; `drums/*`: pattern fit and play; `score/schema`: the `ScoreDoc`.

Pure and browser-safe: no React, no DOM, no `@/` import of the app (`test/packages_purity.test.ts`). The React half (the hot store, the dial dispatchers, the panel primitives) is `@thoremin/sdk-ui`.

Import a module by its path, as the `exports` map lists it: `import { defineExtension } from '@thoremin/sdk/instruments/extension'`.

Why these modules and not fewer: the extension's imports, closed over what they import. The music, trainer and feature libraries are here because the air extension is their second consumer (the rule that made `ictus` a package). See `docs/design/instruments-as-graphs-and-extensions.md` §4.4.
