/**
 * The extension manifest: everything an instrument class (or one instrument) contributes to
 * the app, as ONE object the app folds over (`docs/design/instruments-as-graphs-and-extensions.md`
 * §4.2; PR 5a). Before this, a new air instrument touched six hand-listed registries in 21
 * files; with it, the registries are folds over `EXTENSIONS`.
 *
 * Two halves, mirroring the two SDK entry points the ADR names:
 *
 *  - {@link Extension} is PURE (no React, no DOM): nodes, branches, the dials slice, the
 *    transient hot-store fields it wants as `store-controls` ports, and the derivation of
 *    its branches from the settings. The engine, the composer, the settings schema and the
 *    UI bridge read this half.
 *  - {@link ExtensionUi} is the React half: the editor sections per instrument, the status
 *    hooks that mirror a node's outputs into a React store each tick (and reset when the
 *    node leaves the graph), and mount-time effects (a demand claim, a vocabulary load).
 *    `DialsControlsPanel`, `useEngine` and `App` read this half.
 *
 * In PR 5a the air instruments are registered through a manifest at their CURRENT paths;
 * the physical move (5b) followed, and since the follow-ups to PR 6 the air extension is the `@thoremin/ext-air` package; the original note: the move follows once the trainer stream is done
 * with `src/air`. The manifest is what makes the move a `git mv`.
 */
import type { z } from 'zod';
import type { NodeDef } from '@thoremin/dag';
import type { GraphBranch } from './branch';
import type { CarveModality } from '../enroll/modality';

/**
 * A whole-object dial the extension owns: one top-level key of the settings schema.
 * Generic in its key and schema so the `Settings` TYPE can be computed from the manifests
 * ({@link ExtensionsSettingsShape}); build one with {@link dialSlice} to keep the literal key.
 */
export interface DialSlice<K extends string = string, S extends z.ZodTypeAny = z.ZodTypeAny> {
  /** The settings key (`airDrum`), also the `store-controls` port name. */
  key: K;
  /** The Zod object schema of the dial, with its `.default(...)`: its defaults are the
   *  dial's defaults, and a settings blob saved before the extension existed stays valid. */
  schema: S;
  /** The `store-controls` port kind (`air-drum-config`). */
  kind: string;
  /** The dials metadata the settings form and the palette show. */
  meta: { facets: string[]; title: string; description: string };
  /** This slice's own schema version (#600 S9; default 1). Bump it with a migration when the
   *  stored shape changes; the host records it per slice beside the hot store's global version. */
  version?: number;
  /** `[n]` takes a version-n stored value to version n + 1 (a NEW value; never edit the old).
   *  The host runs the chain on rehydrate, before healing, from the stored version to
   *  {@link version}. A value an older blob lacks is not migrated (the heal fills it). `stored`
   *  is the whole stored object it came from (the hot store's blob, or a saved instrument's
   *  layer), read-only, for a step that moves a value in from another dial. A step must be
   *  IDEMPOTENT (leave what is already there): a saved instrument records no slice version, so
   *  the host runs the chain on one whose dial lacks a current field, which may be newer. */
  migrations?: Readonly<Record<number, SliceMigration>>;
  /** Settings paths this slice ADOPTS on read when its own key is absent (an expand step that
   *  moves a value out of another dial: `'overlay.drumPads'`). The first present one is the
   *  slice's stored value, at version 1; its migrations then reshape it. */
  legacyKeys?: readonly string[];
  /**
   * How the dial is laid out in the dials (#600 S13). `object` (the default, and the only shape a
   * new extension uses): one dial, `key`, whose value is the whole object, as `airDrum`. `flat`: each
   * top-level field is its OWN dial, keyed `key.field` (`midi.enabled`), with its own metadata,
   * per-dial command and saved-instrument entry, and healed field by field. It exists for the
   * built-in features that became slices (#600 Phase E) and already had flat keys, so a saved
   * instrument and a bound command keep theirs; the host refuses it for any other key, and from
   * any extension but the feature's own (`FLAT_SLICES`). A flat slice's schema is a `z.object`
   * whose every field has a default.
   */
  layout?: 'object' | 'flat';
  /** A flat slice's fields whose dial key is not `key.field` (#600 S13): a built-in feature whose
   *  field had another key keeps it (`{ config: 'steerConfig' }`). */
  flatKeys?: Readonly<Record<string, string>>;
  /** A flat slice's fields completed after healing (#600 S14): a PARTIAL value (the shape an older
   *  build saved) filled from the default, in the hot store and in a saved instrument alike, so
   *  the two halves of the dirty compare can never differ by a key nobody edited. Returns the
   *  value itself when nothing is missing. */
  complete?: Readonly<Record<string, (value: unknown) => unknown>>;
  /**
   * `store-controls` ports derived from the dial (#600 S13), beside the whole-dial port `key`: each
   * reads one value out of the dial (healed, so never undefined), for a node whose live inputs
   * predate the slice (`midiEnabled` = the dial's `enabled`), so moving a feature into a slice
   * leaves its graph as it was.
   */
  ports?: readonly DialPort[];
}

/** What a derived port may read besides its dial (#600 S14): the host's live state it needs. */
export interface DialPortHost {
  /** A tool holds the room (the trainer, the carve): an output that must go quiet reads it. */
  claimed: boolean;
}

/** One `store-controls` port a dial slice derives (see {@link DialSlice.ports}). */
export interface DialPort {
  name: string;
  kind: string;
  /** The port's value, from the dial's value (and, when it needs one, the host's state). */
  read: (dial: never, host: DialPortHost) => unknown;
}

/** One step of a slice's migration chain (see {@link DialSlice.migrations}). */
export type SliceMigration = (old: unknown, stored: Readonly<Record<string, unknown>>) => unknown;

/**
 * A command an extension contributes, as DATA (#600 S11): what the palette, the assistant and a
 * binding can list before the extension's code has loaded (VS Code's `contributes.commands`). The
 * implementation is in the extension's React half (`ExtensionUi.commands`); for a lazy extension
 * the host registers a stand-in under this id that loads the extension when the command runs.
 * Ids already shipped stay as they are (a saved binding names them); a new one is namespaced
 * `<extension>.<verb>`.
 */
/**
 * One thing an extension keeps in the browser (#600 S12). `collection`: a named collection, one
 * localStorage key holding every record (reached through the host's storage seam); `item`: one raw
 * localStorage value (a flag, a remembered list); `database`: an IndexedDB database.
 */
export interface StoreDecl {
  /** Its name within the extension (`pad-layouts`), for messages and the registry. */
  name: string;
  kind: 'collection' | 'item' | 'database';
  /** The key (or database name) it is kept under, exactly the one shipped: nothing moves. */
  legacyKey: string;
  /** One line: what it holds. */
  description: string;
}

export interface CommandDecl {
  id: string;
  title: string;
  description: string;
  category: string;
  /** Its parameters' schema (a Zod object). */
  params: z.ZodTypeAny;
  /** It writes the dials, so undo takes it back (#600 S14; see `ExtensionCommand.writesDials`). */
  writesDials?: boolean;
}

/**
 * A per-DEVICE preference an extension keeps in the hot store (#600 S9): persisted with the
 * player's other device prefs, NEVER saved in an instrument (the difference from a dial slice).
 * Versioned and migrated like a dial slice; healed through its schema on rehydrate.
 */
export interface PrefSlice<K extends string = string, S extends z.ZodTypeAny = z.ZodTypeAny> {
  /** The hot-store field. Shares one namespace with dial keys and transient fields. */
  key: K;
  /** Its schema, with a `.default(...)`: the default is the pref's value on a first load. */
  schema: S;
  version?: number;
  migrations?: Readonly<Record<number, SliceMigration>>;
  /** `store-controls` ports derived from the pref (#600 S15), read from its value (or its default)
   *  each tick and always emitted, as a dial slice's {@link DialSlice.ports}: how a node that read
   *  a device pref field by field (the song's level and rate) keeps its inputs once the pref is an
   *  extension's. The names share the bridge's port namespace (a clash is refused). */
  ports?: readonly DialPort[];
}

/** A {@link DialSlice} with its key kept literal (`'airDrum'`, not `string`). */
export function dialSlice<const K extends string, S extends z.ZodTypeAny>(slice: DialSlice<K, S>): DialSlice<K, S> {
  return slice;
}

/** The settings an extension's `derive` reads: the whole settings object, typed opaquely here
 *  because its core keys are core's business. An extension reads its OWN dials from it (it
 *  knows their types: they are its dial slices). */
export type ExtensionDerivationSettings = Readonly<Record<string, unknown>>;

/** A reason the instrument's own voices go quiet (#600 S18a): while `while` holds, the hand voices
 *  and the strikes are hushed (the player's mute and `muted` are left alone), and the shell's quiet
 *  badge says `reason` ("while conducting"). The conductor's score is the music while it runs. */
export interface HushDecl {
  id: string;
  /** How the shell's badge ends "Instrument quiet ...": `while conducting`. */
  reason: string;
  while: (state: ExtensionDerivationSettings) => boolean;
}

/** An extension's candidates for one of the shell's slots (#600 S17). */
export interface SlotCandidates {
  /** The shell's slot name (`body`). */
  slot: string;
  /** Node types of this extension that fill it (each must satisfy the slot's contract). */
  types: readonly string[];
  /** The slot's default, when this extension provides it (one of `types`). */
  default?: string;
}

/** What else an extension's `derive` may read beside the settings (#600 S17). */
export interface ExtensionDerivationContext {
  /** The branches a live feature claim implies by their declared `demands`. */
  implied: ReadonlySet<string>;
}

/** What an extension's `toolDerive` reads beside the settings (#600 S15, S17). */
export interface ToolDeriveContext {
  /** The branch ids implied so far (a recording led by a composed conductor rides `conductor`). */
  composed: readonly string[];
  /** The branches that measure these feature groups (by their declared `demands`): how a tool's
   *  need names what it reads (`body.rhythm`), never a source branch. */
  implying: (groups: readonly string[]) => readonly string[];
}

/** A transient hot-store field the extension reads through a `store-controls` port
 *  (a learned model, a status): always emitted, `null` when absent, so a clear reaches
 *  the node. */
export interface TransientPort<F extends string = string, T = unknown> {
  /** The hot-store field name, also the port name. */
  field: F;
  kind: string;
  /** Phantom: the field's value type (never set at runtime), so the hot store's TYPE can carry
   *  the field without core naming it. Build with {@link transientPort}. */
  readonly __value?: T;
  /** Its value before anything sets it (#600 S14; default `null`): a built-in feature's transient
   *  keeps the initial value it had in core (the generative transport, `false`). */
  initial?: T;
}

/** A {@link TransientPort} with its field name literal and its value type kept:
 *  `transientPort<TrainedModel>()('airGuitarModel', 'shape-model')`. */
export function transientPort<T>() {
  return <const F extends string>(field: F, kind: string, initial?: T): TransientPort<F, T> => (initial === undefined ? { field, kind } : { field, kind, initial });
}

/**
 * A shipped instrument an extension contributes: a name and a PATCH over the default settings,
 * deep-merged by core's seeder (objects merge key by key, anything else replaces), then
 * validated by the settings schema. A patch, not a full snapshot, because the defaults are
 * core's: the extension states only what its instrument changes.
 */
export interface ExtensionInstrument {
  name: string;
  patch: Readonly<Record<string, unknown>>;
  /** The branches it needs, another extension's included (#697): a build that does not ship one
   *  of them does not seed it. */
  requires?: readonly string[];
}

/** Where "train this instrument" goes (`src/app/training/routes.ts` resolves a spec to one). */
export interface TrainingRoute {
  id: string;
  /** What the link says. */
  label: string;
  /** One line under it. */
  hint: string;
  /** A section route: the settings section's `data-section` label and the trainer's DOM id. */
  section?: { label: string; anchor: string };
  /** A tool route: the shell tool to open. */
  tool?: string;
  /** The route for an instrument no branch leads to a route (the Trainer's, #600 S16c); the first
   *  listed wins, and with none an instrument offers no training link. */
  fallback?: boolean;
}

/** The training an extension's instruments offer: its routes, and which of its branches leads
 *  to which route, in the order a lead instrument is looked for. */
export interface ExtensionTraining {
  routes: readonly TrainingRoute[];
  byBranch: readonly (readonly [branch: string, route: string])[];
}

/**
 * An overlay element an extension contributes, as DATA (#600 S5; `docs/design/vertical-slices.md`
 * §4.2): the overlay grows one input port per declared input, named
 * {@link overlayPortName}(extension, element, input), and lists the element under
 * {@link overlayElementId}(extension, element) in the composed element set. The drawing code is
 * {@link OverlayElementImpl}, in the extension's node half (eager: {@link Extension.overlayElements};
 * lazy: {@link ExtensionNodes.overlayElements}), so a lazy element's code loads with its nodes and
 * a frame drawn before that simply leaves it out.
 */
export interface OverlayElementDecl {
  /** Unique within the extension; the host namespaces it. No `.` or `/` (they build the ids). */
  name: string;
  category: 'input' | 'output' | 'guide' | 'backdrop';
  /** A HUD cue, laid out at an edge with the core cues (its impl's `measure` / `positionOf`),
   *  instead of an in-scene drawing. */
  cue?: boolean;
  /** The element's inputs; a branch wires each to its generated overlay port. */
  inputs: readonly { name: string; kind: string }[];
  /** Draw just beneath this core element (its z-order and, for a cue, its place in the edge's
   *  stack), instead of above every core in-scene element or at the end of the cues: an element
   *  moved out of core keeps the place it had. */
  drawBefore?: string;
  /** The extension dial slice that holds the element's options (its show flag among them): it
   *  arrives as the input `config`. The host wires it whenever the element is composed (no branch
   *  writes that edge, and one that feeds the `config` port is refused). `config` is therefore a
   *  reserved input name. */
  config?: { dialKey: string };
}

/** What an extension's overlay element sees of the frame: its size, the engine time, and a cue's origin. */
export interface OverlayFrame {
  W: number;
  H: number;
  /** The engine time of this frame (seconds): for an element that animates (a hit's flash). */
  t: number;
  /** A cue's top-left corner, from the shared cue layout; absent for an in-scene element. */
  origin?: { x: number; y: number };
  /** True while drawing the overlay-only take (a transparent canvas recorded without the video):
   *  an element that paints a backdrop leaves it out then. */
  overlayOnly?: boolean;
}

/**
 * An overlay element's drawing code (#600 S5). It sees ONLY its declared inputs (by input name,
 * `config` among them when declared), and the frame: never the overlay's other inputs, never the
 * hot store.
 */
export interface OverlayElementImpl {
  /** Matches an {@link OverlayElementDecl.name} of the same extension. */
  name: string;
  /** `memo` is this element's own state in this overlay (kept between frames, one per overlay
   *  instance), for a drawing that remembers something (when each pad was last struck). */
  draw(g: CanvasRenderingContext2D, frame: OverlayFrame, inputs: Readonly<Record<string, unknown>>, memo: Record<string, unknown>): void;
  /** Called ONCE per tick before any drawing (#600 S16b), for an element that keeps running
   *  statistics (the Feature Lab's normalizer): `draw` may run twice in a tick (the overlay-only
   *  take redraws), so a statistic folded in `draw` would count each frame twice. Keep the result
   *  in `memo` for `draw`. `frame.t` is the engine time; it runs while the element is composed. */
  update?(frame: OverlayFrame, inputs: Readonly<Record<string, unknown>>, memo: Record<string, unknown>): void;
  /** A cue's box, or null while it has nothing to show. */
  measure?(frame: OverlayFrame, inputs: Readonly<Record<string, unknown>>): { w: number; h: number } | null;
  /** A cue's edge (default `right`). */
  positionOf?(frame: OverlayFrame, inputs: Readonly<Record<string, unknown>>): 'left' | 'right' | 'top' | 'bottom';
}

/** The id an extension's overlay element has in a branch's `overlay` list and the element set. */
export const overlayElementId = (extension: string, element: string): string => `${extension}/${element}`;

/** The overlay input port an extension element's input arrives on (a branch's edge targets it). */
export const overlayPortName = (extension: string, element: string, input: string): string => `${extension}.${element}.${input}`;

/**
 * What is wrong between an extension's overlay declarations and its drawing code (empty when
 * nothing): a declared element with no impl (it would silently never draw), an impl nobody
 * declared, an impl given twice. The host checks an eager extension when it folds the list and a
 * lazy one when its node half arrives.
 */
export function overlayImplProblems(decls: readonly OverlayElementDecl[], impls: readonly OverlayElementImpl[]): string[] {
  const declared = new Set(decls.map((d) => d.name));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of impls) {
    if (seen.has(i.name)) out.push(`the overlay element "${i.name}" has two implementations`);
    else if (!declared.has(i.name)) out.push(`the overlay element implementation "${i.name}" matches no declared element`);
    seen.add(i.name);
  }
  for (const d of decls) if (!seen.has(d.name)) out.push(`the overlay element "${d.name}" is declared but has no implementation`);
  return out;
}

/** One class of instrument: the grouping, tint and glyph the Instruments view shows (#600 S8:
 *  core has `field`; an extension contributes its own, as the air instruments do `air`). */
export interface InstrumentClass {
  id: string;
  label: string;
  emoji: string;
  /** A CSS colour the view may tint a class's cards with. */
  colour: string;
}

/**
 * A row of the instrument catalog (#600 S8): an instrument an extension contributes, detected
 * from the settings, never stored (a category is a fact about the parametrization, Decision 2 of
 * `docs/design/instrument-library.md`). Its id and emoji become a system tag; the first row an
 * instrument plays decides the class it is listed under.
 */
export interface CatalogEntry {
  id: string;
  /** The system tag's tooltip and the parametrization tooltip. */
  label: string;
  emoji: string;
  /** The class an instrument playing it is listed under (core's `field`, or a contributed one). */
  class: string;
  /** Whether it plays the instrument's scale (the Sound section's scale, root and range). */
  usesScale: boolean;
  /** True when these settings play it. Pure and cheap: it runs on every settings change. */
  on: (settings: ExtensionDerivationSettings) => boolean;
  /** The branches it needs, another extension's included (#697: the chord chart needs the
   *  conductor slice's `conductor`): a build that does not ship one of them withholds the row, and
   *  the editor section of the same id with it. */
  requires?: readonly string[];
}

/** What a LAZY extension's deferred half provides (`docs/design/lazy-extensions.md`): its node
 *  definitions, exactly the types its stub {@link Extension.provides}, and the drawing code of
 *  the overlay elements its stub declares. */
export interface ExtensionNodes {
  nodes: readonly NodeDef<unknown>[];
  overlayElements?: readonly OverlayElementImpl[];
}

export interface Extension<D extends readonly DialSlice[] = readonly DialSlice[], Tr extends readonly TransientPort[] = readonly TransientPort[]> {
  /** Stable id (`air`). */
  id: string;
  /** Node definitions registered into the app registry (an EAGER extension). A lazy one
   *  leaves this out and names its node types in {@link provides} instead. */
  nodes?: readonly NodeDef<unknown>[];
  /** A LAZY extension's node types: declared at once (a composer may name them), their code
   *  loaded by {@link load} the first time a graph names one. */
  provides?: readonly string[];
  /** Loads the deferred half. Never written by the extension: the host's build generates it
   *  from the `lazy` entry of `extensions.json` (a dynamic `import()`), so the deferred
   *  module is its own chunk. Present exactly when {@link provides} is. */
  load?: () => Promise<ExtensionNodes>;
  /** Branches the composer may name; their ids join the branch table. */
  branches: readonly GraphBranch[];
  /** The settings keys this extension owns, one per whole-object dial. */
  dials: D;
  /** Its per-device preferences (#600 S9): persisted, never part of an instrument. */
  prefs?: readonly PrefSlice[];
  transient?: Tr;
  /** The instruments it ships, appended to core's seeds in this order. */
  instruments?: readonly ExtensionInstrument[];
  /** Its training routes; a `fallback` one answers for an instrument no branch leads elsewhere (the Trainer's). */
  training?: ExtensionTraining;
  /** The commands it contributes, as data (#600 S11); listed before a lazy extension loads. */
  commandDecls?: readonly CommandDecl[];
  /** The carve modalities it contributes (#600 S11): body parts a player carves categories from,
   *  beside the SDK's face, hand and body. */
  modalities?: readonly CarveModality[];
  /** What it keeps in the browser (#600 S12): every localStorage key and IndexedDB database it
   *  writes, each with the key it uses (verbatim; nothing is renamed). The host lists them with
   *  core's in one registry and refuses a key two owners claim; a `collection` reaches its provider
   *  through the storage seam (`@thoremin/sdk-ui/storage`), never by building one. */
  stores?: readonly StoreDecl[];
  /** Instrument classes it contributes (#600 S8); ids unique across core and extensions. */
  classes?: readonly InstrumentClass[];
  /** Its rows of the instrument catalog (#600 S8), in display order. */
  catalog?: readonly CatalogEntry[];
  /** When it hushes the instrument's own voices (#600 S18a), and why. */
  hushes?: readonly HushDecl[];
  /** Whether, with these settings, a branch of its that declares one hand reads two at once
   *  (#600 S18a; the conductor's split with the hands alone): the hand model then looks for two. */
  readsTwoHands?: (settings: ExtensionDerivationSettings) => boolean;
  /** Candidates for the shell's slots (#600 S17): node types of its own that can fill a slot the
   *  shell declares (`body`, `source`, ...), and, for at most one extension per slot, the
   *  slot's default. The shell keeps the slot and its contract; a URL picks a candidate
   *  (`?slot.body=synthetic-body`). */
  slotCandidates?: readonly SlotCandidates[];
  /** Overlay elements it contributes, as data (#600 S5): ports, category, config. */
  overlay?: readonly OverlayElementDecl[];
  /** An EAGER extension's overlay drawing code (a lazy one's arrives with {@link load}). */
  overlayElements?: readonly OverlayElementImpl[];
  /**
   * Which of this extension's branches the settings imply (the derivation column of the ADR,
   * §3.4, for this extension). Called by `branchIdsFor` when no explicit set is given.
   * `context.implied` holds the branches a live claim (the Lab, a tool's demand) implies by
   * their declared `demands` (#600 S17): already composed; read it when one of this
   * extension's branches depends on a source being there for a reason other than its dial.
   */
  derive: (settings: ExtensionDerivationSettings, context?: ExtensionDerivationContext) => readonly string[];
  /**
   * Which of this extension's branches a TOOL's need implies (#600 S15): the player's per-device
   * prefs or live state (a loaded song, a follow switch), never the instrument's dials. Unlike
   * {@link derive} it is also unioned into an instrument's EXPLICIT branch set, as the Lab's and a
   * feature claim's needs are: a tool's need is not the instrument's to veto. Called last, with the
   * branch ids implied so far (`context.composed`), so a need that rides another branch (a recording
   * led by a composed conductor) can say so; what it needs measured it names as feature groups,
   * resolved to the branches that declare them (`context.implying(['body.rhythm'])`, #600 S17).
   */
  toolDerive?: (settings: ExtensionDerivationSettings, context: ToolDeriveContext) => readonly string[];
  /**
   * Its branches EVERY instrument composes, as the composer composes the trunk (#600 S15): not
   * derived and never listed in a branch set, so a saved set, a derivation and a branch-set key
   * are what they were. For what was a trunk node before it became an extension's (the song
   * player: idle, an early return per tick, until its tool gives it work). Each id must be one of
   * {@link branches}.
   */
  trunk?: readonly string[];
}

/** An {@link Extension} with its dial slices' types kept, so the settings type can read them. */
export function defineExtension<const D extends readonly DialSlice[], const Tr extends readonly TransientPort[] = readonly []>(ext: Extension<D, Tr>): Extension<D, Tr> {
  return ext;
}

type UnionToIntersection<U> = (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void ? I : never;
type SliceShape<S> = S extends DialSlice<infer K, infer Z> ? { [P in K]: Z } : never;
/** `true` for a slice whose key widened to `string` (declared without {@link dialSlice}). */
type LooseSlice<S> = S extends DialSlice<infer K, z.ZodTypeAny> ? (string extends K ? true : never) : never;

/** What a loosely typed manifest folds to: not a shape, so `CoreSettingsSchema.extend(...)` fails
 *  to typecheck, loudly, instead of the whole `Settings` type silently widening to `unknown`. */
export interface LooseExtensionDials {
  error: 'an extension dial key widened to string: build the slices with dialSlice() and the manifest with defineExtension()';
}

/**
 * The settings-schema SHAPE a list of extensions contributes (`{ airDrum: <its schema>, ... }`),
 * computed from the manifests' TYPES: what `SettingsSchema` extends the core shape with, and
 * so what the `Settings` type knows. An empty list contributes `{}`.
 */
export type ExtensionsSettingsShape<Es extends readonly Extension[]> = [Es[number]['dials'][number]] extends [never]
  ? Record<never, never>
  : [LooseSlice<Es[number]['dials'][number]>] extends [never]
    ? UnionToIntersection<SliceShape<Es[number]['dials'][number]>>
    : LooseExtensionDials;

type TransientShape<P> = P extends TransientPort<infer F, infer T> ? (string extends F ? never : { [K in F]: T | null }) : never;
type TransientsOf<E> = E extends Extension<readonly DialSlice[], infer Tr> ? Tr[number] : never;

/**
 * The hot-store fields a list of extensions declares as transient (`{ airGuitarModel:
 * TrainedModel | null, ... }`), computed from the manifests' TYPES like the settings shape. Each
 * is `null` when absent. An empty list (or a port declared without {@link transientPort})
 * contributes nothing.
 */
export type ExtensionsTransients<Es extends readonly Extension[]> = [TransientShape<TransientsOf<Es[number]>>] extends [never]
  ? Record<never, never>
  : UnionToIntersection<TransientShape<TransientsOf<Es[number]>>>;

/** The runtime value of {@link ExtensionsSettingsShape}: one entry per dial slice, keyed by its key. */
export function extensionsSettingsShape<Es extends readonly Extension[]>(extensions: Es): ExtensionsSettingsShape<Es> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const slice of extensions.flatMap((e) => e.dials)) {
    if (slice.key in shape) throw new Error(`extensions: the dial key "${slice.key}" is declared twice`);
    shape[slice.key] = slice.schema;
  }
  return shape as ExtensionsSettingsShape<Es>;
}

/** The ids of the extension's branches, for validation and the `features` facet. */
export function extensionBranchIds(ext: Extension): string[] {
  return ext.branches.map((b) => b.id);
}
