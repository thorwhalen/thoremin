# @thoremin/sdk-ui

The app half of thoremin's extension SDK: what an extension's React side (its editor sections, status hooks, mount effects and the stores behind them) uses. With `@thoremin/sdk` (the pure half) it is everything an extension imports from thoremin, so an extension is a package that never imports the app.

## The host: dependency inversion

An extension does not import the app's hot store or its command registry. It calls seams this package defines, and the app installs their implementations when the modules that own them load:

| Seam | Extension calls | App installs it in |
|---|---|---|
| `controls()` | `get()` (its own dials and transient fields), `setTransient(field, value)`, `setHush(claimer, on)`, `subscribe(listener)`; `controlsStore<S>()` adapts it to `getState`/`subscribe` | `src/app/store.ts` (`provideControls`) |
| `dials` | `dispatchDialSet`, `dispatchDialSetIn`, `dispatchDialPatch` (the same three dispatchers core panels use, the write path the guard checks) | `src/app/dispatchDial.ts` (`provideDials`) |
| dials form | `useDialsSettings()` | `src/app/dials/useDialsSettings.ts` (`provideDialsForm`) |

A seam is resolved when it is called, never at import, so an extension module can be loaded before the app; calling one before the app has provided it throws, naming the module that provides it. `setTransient` refuses a field no listed extension declares.

## Moved here whole (no app dependency)

`primitives` (the settings panels' controls), `types` (`ExtensionUi`, `StatusHook`, `ExtensionPanel`), `namedCollection` (the zodal named-record store facade), `featureDemand` (the app's feature-demand registry), `enroll/{sequenceStore,guidance,click}` (the trainer's sequence collection, guidance sinks and click player). Core imports them from here too, so there is one instance of each.

React is a peer dependency. The `.tsx` files and `types.ts` are outside the strict, React-free typecheck (the project ships no `@types/react`); the rest is checked by it.
