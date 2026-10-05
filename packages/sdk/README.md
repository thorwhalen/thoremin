# @thoremin/sdk

The pure half of thoremin's extension SDK: everything an extension's nodes, libraries and manifest may import. It is the module set an extension actually needs, cut along the boundary the extension guard used to keep by test (`SDK_SURFACE` in `test/extensions_boundary.test.ts`), so the package boundary now enforces it.

- `instruments/{extension,branch,trunk}`: the `Extension` manifest (`defineExtension`, `dialSlice`, `transientPort`), `GraphBranch` (`defineBranch`), and the trunk's node names to wire to.
- `nodes/domain`: the port kinds and the stream types (hands, faces, voices); `nodes/music/drum_{pads,anchor}`: the drum geometry the overlay also draws.
- `features/*`: the feature catalog and feature demand; `enroll/*`: the trainer's pure core (cues, noise units, sampling, sufficiency, classification); `music/{theory,sounds}`; `score/schema`: the `ScoreDoc`.

What is NOT here, on purpose: a library only one extension uses lives in that extension (the drum patterns, the fingering charts and note names are the air extension's), and core's own machinery stays in the app (the branch derivation, the Feature Lab config). A module joins the SDK when an extension and core both need it.

Pure and browser-safe: no React, no DOM, no `@/` import of the app (`test/packages_purity.test.ts`). The React half (the hot store, the dial dispatchers, the panel primitives) is `@thoremin/sdk-ui`.

Import a module by its path, as the `exports` map lists it: `import { defineExtension } from '@thoremin/sdk/instruments/extension'`.

Why these modules and not fewer: what an extension imports that core uses too, closed over what those modules import (the rule that made `ictus` a package: a second consumer). See `docs/design/instruments-as-graphs-and-extensions.md` §4.4.
