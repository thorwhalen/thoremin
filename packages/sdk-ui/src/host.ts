/**
 * The host: what the app provides to an extension's React side, by dependency inversion. An
 * extension imports this package, never the app; the app installs the implementations when
 * the modules that own them load (the hot store registers `controls`, the dial write path
 * registers `dials`). So the package depends on nothing of the app's, and an extension built
 * against it runs in any host that provides these two seams.
 *
 * Calls are resolved at USE time, never at import: an extension module can be imported before
 * the host is installed (a test, a lazy chunk), and only calling a seam before the app has
 * loaded its implementation is an error, one that names what is missing.
 */

/** The live control store (the app's hot store), as an extension may use it. */
export interface ControlsHost {
  /** The current state: every dial and transient field by key. An extension reads its OWN
   *  keys and knows their types (its dial slices and transient ports declare them). */
  get(): Readonly<Record<string, unknown>>;
  /** Replace one of the extension's transient fields (a learned model, a pattern in play). */
  setTransient(field: string, value: unknown): void;
  /** Take (`on`) or release a hush claim: the instrument goes quiet while a tool needs the room. */
  setHush(claimer: string, on: boolean): void;
  /** Subscribe to every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** The settings write path (the command registry) and the dials form, as an extension's panel
 *  uses them. The writes are fire-and-forget; a refused value is shown by the host. */
export interface DialsHost {
  /** One scalar dial (`dial.set`). */
  set(key: string, value: unknown): void;
  /** One scalar leaf of a structured dial, by dotted path (`airDrum.pads.p1.sound`). */
  setIn(path: string, value: unknown): void;
  /** Several dials atomically: all or nothing. */
  patch(writes: ReadonlyArray<readonly [string, unknown]>): void;
}

/** The dials FORM, a React hook over the live dials store (see `DialsSettings`). A seam of its
 *  own because its implementation is React, which the write path is not. */
export interface DialsFormHost {
  useSettings(): import('./dials').DialsSettings;
}

let controlsHost: ControlsHost | null = null;
let dialsHost: DialsHost | null = null;
let dialsFormHost: DialsFormHost | null = null;

/** Installed by the app's hot store module. */
export function provideControls(host: ControlsHost): void {
  controlsHost = host;
}

/** Installed by the app's dial write path. */
export function provideDials(host: DialsHost): void {
  dialsHost = host;
}

/** Installed by the app's dials-form hook module. */
export function provideDialsForm(host: DialsFormHost): void {
  dialsFormHost = host;
}

const missing = (seam: string, owner: string): Error =>
  new Error(`@thoremin/sdk-ui: no ${seam} host. The app installs it when ${owner} loads; import the app (or that module) before calling an extension's UI.`);

/** The live control store. Throws, naming the module, if the app has not provided it. */
export function controls(): ControlsHost {
  if (!controlsHost) throw missing('controls', 'its hot store (src/app/store.ts)');
  return controlsHost;
}

/** The dial write path. Throws, naming the module, if the app has not provided it. */
export function dials(): DialsHost {
  if (!dialsHost) throw missing('dials', 'its dial write path (src/app/dispatchDial.ts)');
  return dialsHost;
}

/** The dials form hook. Throws, naming the module, if the app has not provided it. */
export function dialsForm(): DialsFormHost {
  if (!dialsFormHost) throw missing('dials form', 'its dials hook (src/app/dials/useDialsSettings.ts)');
  return dialsFormHost;
}

/**
 * The controls as a minimal store: `getState` and a `subscribe` that hands the listener the
 * state, the shape an extension's sync loops take as an injectable (so a test passes a fake).
 * Typed by the extension's own view of ITS keys; resolved per call, like every seam here.
 */
export function controlsStore<S>(): { getState(): S; subscribe(listener: (state: S) => void): () => void } {
  return {
    getState: () => controls().get() as unknown as S,
    subscribe: (listener) => controls().subscribe(() => listener(controls().get() as unknown as S)),
  };
}

