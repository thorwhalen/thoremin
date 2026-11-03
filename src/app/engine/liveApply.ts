/**
 * The LIVE graph, and re-wiring a running engine onto it (#392, out of `useEngine`).
 *
 * The graph the player hears is not fixed at build time: it is composed from the hot store (the
 * dials, a tool's feature demand, the Lab) and the slot selection, and re-applied whenever any of
 * those changes. A change may name a LAZY extension's nodes (`docs/design/lazy-extensions.md`),
 * so composing goes through `lazyApply.ts`: what is pending loads first, a failed load leaves its
 * branches out and says so (once per page), and only the latest request against an engine commits.
 *
 * `useEngine` owns the engine and its refs; this module owns what the graph is and how it is
 * applied, so both are testable without mounting the hook (which would boot the webcam and the
 * ML models).
 */
import type { Engine, NodeRegistry } from '@thoremin/dag';
import { ALL_BRANCHES, branchIdsFor, branchIdsWithout, composeInstrumentGraph, type SlotSelection } from '../graph';
import { branchSetKey } from '@/instruments/derive';
import { branchClosureIds, type Composed } from '@/instruments/compose';
import {
  deriveHandCount,
  foldHandPreferences,
  HAND_PREFERENCE_OPTIONS,
  initialHandPreferenceState,
  parseHandsOverride,
  stepHandPreference,
  type HandCount,
  type HandPreferenceOptions,
  type ObservedHands,
} from '@/instruments/hands';
import { deriveReadsCamera, type CameraReadContext } from '@/instruments/camera';
import type { GraphBranch } from '@thoremin/sdk/instruments/branch';
import type { DemandedGroups } from '@thoremin/sdk/features/demand';
import type { HandPreference } from '@thoremin/sdk/nodes/player_hands';
import { TRUNK, TRUNK_ID } from '@thoremin/sdk/instruments/trunk';
import { SOURCE_SLOT_OUTPUT } from '@/nodes/sources/source_contract';
import { CONTRIBUTIONS } from '@/host/contributions';
import { featureDemandResource } from '@thoremin/sdk-ui/featureDemand';
import { useControls } from '../store';
import { useToasts } from '../shell/toasts';
import { ensureLazyTypes } from './extensionLoad';
import { makeLazyApplier, type LazyApplyDeps } from './lazyApply';

/** How long (ms) the "an add-on could not load" toast stays up. */
const LOAD_FAILURE_TOAST_MS = 6000;

/**
 * The branch set the live state implies: the dials plus what a tool demands (the
 * instruments-as-graphs ADR, PR 3). A spec's EXPLICIT branch set (PR 4) is persisted and
 * assembled but not read here yet: honouring it at runtime needs a writer, and that writer
 * must be a dial or a command (a command changes sound only by writing a dial), restored on
 * undo and on reload. The PR that adds the writer wires `ctx.explicit` here.
 */
export function liveBranchIds(controls: ReturnType<typeof useControls.getState>, demanded = featureDemandResource()): string[] {
  // The spread gives the store's interface the index signature `DerivationSettings` declares
  // for extension dial slices (an interface has none implicitly); a shallow copy of one
  // object per store change.
  return branchIdsFor({ ...controls }, { demanded });
}

const BRANCH_BY_ID = new Map(ALL_BRANCHES.map((b) => [b.id, b]));

/** The `?hands=` override of this page, read once (a verification affordance, #325). */
const HANDS_OVERRIDE: HandCount | null = typeof location === 'undefined' ? null : parseHandsOverride(location.search);

/**
 * The live readers of the camera streams: the composed branches (the trunk and every
 * requirement in) and what the shell reads, as the store says now. One reading for the hand
 * count (#325) and for whether the camera is read at all (#869), so the two never disagree on
 * who reads.
 */
function liveReaders(controls: ReturnType<typeof useControls.getState>, demanded: DemandedGroups): { branches: GraphBranch[]; ctx: CameraReadContext; preference?: HandPreference } {
  const ids = branchClosureIds([TRUNK_ID, ...liveBranchIds(controls, demanded)], ALL_BRANCHES);
  const settings = controls as unknown as Readonly<Record<string, unknown>>;
  const { preference, conflict } = foldedPreferences(settings, new Set(ids));
  return {
    branches: ids.flatMap((id) => BRANCH_BY_ID.get(id) ?? []),
    ctx: {
      demanded,
      gesturesEnabled: controls.gestures?.enabled,
      skeletonShown: controls.overlay?.landmarks?.show,
      videoShown: controls.overlay?.video?.show,
      // Two one-hand readers that want different hands read two hands (#784).
      twoHandsRead: CONTRIBUTIONS.readsTwoHands.some((reads) => reads(settings)) || conflict,
    },
    ...(preference ? { preference } : {}),
  };
}

/** The hand preferences of the extensions whose one-hand branch is composed, folded (#784). */
const foldedPreferences = (settings: Readonly<Record<string, unknown>>, composed: ReadonlySet<string>) =>
  foldHandPreferences(CONTRIBUTIONS.prefersHand.filter((p) => p.branches.some((b) => composed.has(b))).map((p) => p.prefers(settings)));

/**
 * How many hands the hand model should look for right now (#325): what the live branch set
 * (requirements included) and the shell's hand readers need, unless the page says
 * `?hands=`. Read by `webcam-hands` through the host's `handCount` resource.
 */
export function liveHandCount(
  controls: ReturnType<typeof useControls.getState>,
  demanded = featureDemandResource(),
  override: HandCount | null = HANDS_OVERRIDE,
): HandCount {
  return liveCameraReading(controls, demanded, override).handCount;
}

/**
 * Whether the live instrument or the shell reads the camera right now (#869): the host opens
 * the camera when this turns true, and never for an instrument that only listens.
 */
export function liveReadsCamera(controls: ReturnType<typeof useControls.getState>, demanded = featureDemandResource()): boolean {
  return liveCameraReading(controls, demanded).readsCamera;
}

/** Both answers from one reading of the readers: what the host's store selector asks on every
 *  store change, so the branch closure is computed once, not once per answer. */
export interface CameraReading {
  handCount: HandCount;
  readsCamera: boolean;
}

export function liveCameraReading(
  controls: ReturnType<typeof useControls.getState>,
  demanded = featureDemandResource(),
  override: HandCount | null = HANDS_OVERRIDE,
): CameraReading {
  const { branches, ctx } = liveReaders(controls, demanded);
  return { handCount: override ?? deriveHandCount(branches, ctx), readsCamera: deriveReadsCamera(branches, ctx) };
}

/** Which hand the live instrument's one-hand readers want when two are in view (#784), if any:
 *  from the same reading of the readers as the hand count. */
export function liveHandPreference(controls: ReturnType<typeof useControls.getState>, demanded = featureDemandResource()): HandPreference | undefined {
  return liveReaders(controls, demanded).preference;
}

/**
 * {@link liveHandPreference} over the hot store and the live demand, recomputed only when either
 * changes: the resource reads it once per camera frame, and composing the branch set is not free.
 */
function memoLivePreference(): () => HandPreference | undefined {
  let last: { controls: unknown; demand: string; value: HandPreference | undefined } | undefined;
  return () => {
    const controls = useControls.getState();
    const demanded = featureDemandResource();
    const demand = demanded === null ? '*' : [...demanded].sort().join('|');
    if (!last || last.controls !== controls || last.demand !== demand) last = { controls, demand, value: liveHandPreference(controls, demanded) };
    return last.value;
  };
}

/** What the live hand count reads of a running engine: one node's output. */
export type HandsReader = Pick<Engine, 'getOutput'>;

export interface LiveHandCountOptions {
  /** The derived count (`liveCameraReading(...).handCount`, which the host keeps current in a ref). */
  derived: () => HandCount;
  /** The running engine, read for the hand source's last frame (`cam.hands`); null before it runs. */
  engine: () => HandsReader | null;
  /** The live preference; default {@link liveHandPreference} over the hot store and the demand. */
  preference?: () => HandPreference | undefined;
  /** The page's `?hands=` override: a pin, so the preference never moves it. */
  override?: HandCount | null;
  /** How quickly the count follows the hands in view. */
  options?: Readonly<HandPreferenceOptions>;
}

/** The hand source's last frame, when it is one. */
function observedHands(engine: HandsReader | null): ObservedHands | undefined {
  const v = engine?.getOutput(TRUNK.cam, SOURCE_SLOT_OUTPUT.name) as Partial<ObservedHands> | undefined;
  return v && Array.isArray(v.hands) ? (v as ObservedHands) : undefined;
}

/**
 * The host's `handCount` resource (#325, #784): the derived count, raised to two while a one-hand
 * reader's preferred hand is not the one tracked (`stepHandPreference`, over the hand source's last
 * frame). `webcam-hands` calls it once per camera frame; it keeps the policy's small state.
 */
export function createLiveHandCount({ derived, engine, preference = memoLivePreference(), override = HANDS_OVERRIDE, options = HAND_PREFERENCE_OPTIONS }: LiveHandCountOptions): () => HandCount {
  let state = initialHandPreferenceState();
  return () => {
    if (override) return derived();
    state = stepHandPreference(state, derived(), preference(), observedHands(engine()), options);
    return state.count;
  };
}

/** The live branch set as a key, for "did it change since the build?". */
export function currentBranchKey(): string {
  return branchSetKey(liveBranchIds(useControls.getState()));
}

/**
 * The graph the LIVE instrument needs right now, composed for the slot selection. The
 * caller writes the composed overlay element set to the hot store when the graph commits
 * (`applyLive`), so the overlay reads it through `store-controls` and never as a param.
 */
export function liveGraph(selection: SlotSelection, registry: NodeRegistry, without: ReadonlySet<string> = new Set()): Composed {
  return composeInstrumentGraph(branchIdsWithout(liveBranchIds(useControls.getState()), without), selection, registry);
}

/** The lazy node types whose failed load has already been toasted in this page. */
const toastedLoadFailures = new Set<string>();

/**
 * How the live graph is composed against a registry that may hold LAZY extension nodes
 * (`docs/design/lazy-extensions.md`): what is pending is loaded first, and a load that fails
 * leaves that extension's branches out and says so, so the instrument keeps playing.
 */
export function lazyDeps(selection: () => SlotSelection, registry: NodeRegistry, isLive: () => boolean = () => true): Omit<LazyApplyDeps<Composed>, 'commit'> {
  return {
    compose: (without) => liveGraph(selection(), registry, without),
    typesOf: (g) => g.spec.nodes.map((n) => n.type),
    pending: (types) => registry.pending(types),
    ensure: (types) => ensureLazyTypes(registry, types),
    onLoadError: (types, err) => {
      if (!isLive()) return; // a torn-down engine's late failure is nobody's news
      console.error(`[thoremin] could not load the code of ${types.join(', ')}; playing without it`, err);
      // Once per page: a failed import() is never refetched before a reload, so every later
      // graph change that still names these types fails again, and says nothing new.
      const fresh = types.filter((t) => !toastedLoadFailures.has(t));
      if (fresh.length === 0) return;
      for (const t of fresh) toastedLoadFailures.add(t);
      useToasts.getState().push('An add-on could not load. Check your connection, then reload the page (your instrument is kept).', LOAD_FAILURE_TOAST_MS, 'error');
    },
  };
}

/** What `applyLive` needs of an engine: the live re-wire. */
export type LiveEngine = Pick<Engine, 'applyGraph'>;

export interface LiveApplyOptions {
  /** The slot selection, read when the graph is composed (the hook's ref, so a selection that
   *  changes during a lazy load is the one committed). */
  selection: () => SlotSelection;
  /** The registry the live engine was built against: `applyGraph` must resolve node types
   *  against the SAME one. */
  registry: NodeRegistry;
  /** The hook's engine ref: null once torn down, another engine after a rebuild. */
  live: () => LiveEngine | null;
  /** The node ids an apply removed, once it commits: the host resets the status stores that
   *  mirror them, so a panel never shows a node that no longer exists. */
  onRemoved?: (removed: readonly string[]) => void;
  /** The live graph without the given types; default {@link liveGraph} over the hot store and
   *  `selection`. A seam for tests, which compose a graph naming their own lazy types. */
  compose?: (without: ReadonlySet<string>) => Composed;
}

/**
 * Report a failed re-wire — unless the engine was torn down while the swap was
 * still preparing. `applyGraph` rejects that case by design (it releases what it
 * built rather than committing onto a dead engine), and it is the ordinary
 * unmount / StrictMode remount path, so logging it would cry wolf on every
 * teardown that happens to overlap a swap. `live` is the hook's engine ref: it is
 * nulled by the same cleanup that disposes, so a mismatch means "we were torn
 * down", which is exactly the case to stay quiet about.
 */
function reportApplyFailure(engine: LiveEngine, live: LiveEngine | null, err: unknown): void {
  if (live !== engine) return;
  console.error('[thoremin] could not apply the instrument graph', err);
}

/** One lazy applier per engine: only the latest request against an engine commits. */
const appliers = new WeakMap<LiveEngine, () => void | Promise<void>>();

/**
 * Re-wire a RUNNING engine onto the live graph. The overlay's element set is written when
 * the apply COMMITS (never at plan time: during the seconds a face or body model prepares,
 * the old graph is still playing and must keep its own elements; and a rejected apply must
 * leave the store describing the graph that is actually running). Nodes the apply removed
 * are handed to `onRemoved`.
 *
 * The applier is built on an engine's FIRST call and reused after, so the options of later
 * calls against the same engine are not read: every caller passes the same refs.
 */
export function applyLive(engine: LiveEngine, { selection, registry, live, onRemoved, compose }: LiveApplyOptions): void {
  let apply = appliers.get(engine);
  if (!apply) {
    apply = makeLazyApplier<Composed>({
      // `applyLive` only runs once the engine is live, so a null ref means it was torn down.
      ...lazyDeps(selection, registry, () => live() === engine),
      ...(compose ? { compose } : {}),
      commit: (next) => {
        void engine
          .applyGraph(next.spec, registry)
          .then((change) => {
            const now = live();
            if (now !== null && now !== engine) return;
            useControls.getState().setGraphElements(next.elements);
            onRemoved?.(change.removed);
          })
          .catch((err) => reportApplyFailure(engine, live(), err));
      },
    });
    appliers.set(engine, apply);
  }
  void apply();
}
