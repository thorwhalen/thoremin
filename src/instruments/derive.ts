/**
 * Which branches an instrument's settings and the live feature demand imply — the
 * derivation column of `docs/design/instruments-as-graphs-and-extensions.md` §3.4, and
 * seam 1 of its table: until an instrument spec carries an explicit `branches` field
 * (PR 4), the branch set is COMPUTED from the dials `Layer` a saved instrument already is,
 * so every instrument in every player's browser keeps the graph it had.
 *
 * Two inputs, both read synchronously at the moment of a switch (never per tick):
 *
 *  - the resolved settings (the hot store's mirror of the dials), which say what the
 *    instrument IS: the hand voices are on iff `handMap.maxGain > 0` (the air seeds' own
 *    way of silencing them: never the class, a field instrument with a drum added still
 *    plays its hands); the face mapping picks the face branches; each `enabled` dial its
 *    branch;
 *  - the live feature demand plus the Feature Lab's shown groups, which say what a TOOL
 *    needs right now: a face-group claim (the Trainer on a face cue, the flute's breath)
 *    or a face group shown in the Lab implies the face source, the body likewise. The
 *    Lab is folded in here because it is not a demand claim (it never calls `claim`),
 *    and dropping it would leave the Lab measuring an absent node.
 *
 * Pure: no store, no engine, no React. The union it computes is exactly what the model
 * gates in `webcam-face` / `webcam-body` used to compute per tick; those gates go once the
 * node is simply absent when unwanted.
 */
import type { DemandedGroups } from '@thoremin/sdk/features/demand';
import { demandWantsBody, demandWantsFace, labWantsBody, labWantsFace, type FeatureLabConfig } from '../features/labConfig';
/**
 * What the derivation needs to know about the build it runs in: which branch ids exist,
 * and each extension's own derivation. A PARAMETER, never an import: this package stays
 * free of the app's extension list (the host binds it once, `branchIdsFor` in
 * `src/app/graph.ts`), and a caller that forgets the extensions fails to typecheck rather
 * than silently deriving a graph without them.
 */
export interface DerivationTable {
  knownBranchIds: ReadonlySet<string>;
  extensions: readonly { id: string; derive: (settings: DerivationSettings) => readonly string[] }[];
}

/**
 * The slice of the settings the derivation reads. Structural, so tests need no full
 * Settings, and every field optional at the type level: the hot store is read inside a
 * zustand selector on EVERY store change, including mid-migration of an older persisted
 * state, and a missing sub-object must derive "off", never throw and take the app down.
 */
export interface DerivationSettings {
  handMap?: { maxGain?: number };
  faceMapping?: string;
  body?: { enabled?: boolean };
  bodyMap?: { routes?: Record<string, { target?: string; feature?: string } | undefined> };
  conductor?: { enabled?: boolean; conducts?: string; source?: string; expression?: string; orchestra?: { enabled?: boolean } };
  midi?: { enabled?: boolean };
  steer?: { enabled?: boolean };
  /** The per-device song pref (#186 PR H): `follow` composes the pace branch. */
  songPrefs?: { follow?: boolean };
  /** The loaded song (transient): following needs one. Only its presence is read. */
  songHandle?: unknown;
  /** Extension dial slices (`airDrum`, …): read by each extension's own `derive`. */
  [extensionKey: string]: unknown;
}

/**
 * The same slice with every field REQUIRED: what the hot store must actually provide. Not
 * used at runtime (the derivation reads the optional shape so a partial state cannot
 * throw); it exists so a test can pin, at typecheck time, that a dial rename in the store
 * is caught rather than silently deriving "off".
 */
export interface StrictDerivationSettings {
  handMap: { maxGain: number };
  faceMapping: string;
  body: { enabled: boolean };
  bodyMap: { routes: Record<string, { target: string; feature: string }> };
  conductor: { enabled: boolean; conducts: string; source: string; expression: string; orchestra: { enabled: boolean } };
  midi: { enabled: boolean };
  steer: { enabled: boolean };
  songPrefs: { follow: boolean };
}

export interface DerivationContext {
  /** The union of live feature-group claims (`appFeatureDemand.groups()`). */
  demanded?: DemandedGroups;
  /** The Feature Lab's config: shown groups imply their source while the Lab is open. */
  featureLab?: FeatureLabConfig;
  /**
   * The instrument spec's EXPLICIT branch set, when it declares one (PR 4). It replaces the
   * settings-derived set; what a live tool demands (the face or body source for a claim or
   * a Lab meter) is still unioned in, because a tool's need is not the instrument's to veto.
   */
  explicit?: readonly string[] | null;
}

const NO_DEMAND: DemandedGroups = new Set();

/** Whether any body route is live (a target other than `none`, with a feature). */
export function bodyMapRoutesAnything(bodyMap: DerivationSettings['bodyMap']): boolean {
  return Object.values(bodyMap?.routes ?? {}).some((r) => !!r && r.target !== undefined && r.target !== 'none' && !!r.feature);
}

const on = (x: { enabled?: boolean } | undefined): boolean => x?.enabled === true;

/** Whether the song follows the dancer: following is on and a song is loaded. A tool's
 *  need like the Lab's (a per-device pref, not the instrument's), so an explicit branch
 *  set does not veto it. */
export function songFollows(settings: Pick<DerivationSettings, 'songPrefs' | 'songHandle'>): boolean {
  return settings.songPrefs?.follow === true && settings.songHandle != null;
}

/** Whether the conductor leads the recording (#187 PR 7): conducting is on, it conducts
 *  the recording, and a song is loaded. It replaces following the dancer meanwhile. */
export function songConducted(settings: Pick<DerivationSettings, 'conductor' | 'songHandle'>): boolean {
  return settings.conductor?.enabled === true && settings.conductor.conducts === 'recording' && settings.songHandle != null;
}

/** Whether the conductor reads the body (#375): its source is `body`, or the body shapes its
 *  expression (#378, `expression: body` while a hand beats). The body source is
 *  then composed with the conductor branch, whenever that branch is (so the pose model
 *  loads before the first beat, as the orchestra's soundfont does). */
export function conductorReadsBody(settings: Pick<DerivationSettings, 'conductor'>): boolean {
  return settings.conductor?.source === 'body' || settings.conductor?.expression === 'body';
}

/**
 * The branch ids `settings` and `ctx` imply, in no particular order (the composer orders).
 * The trunk is implied by the composer and not listed here.
 */
export function deriveBranchIds(settings: DerivationSettings, ctx: DerivationContext, table: DerivationTable): string[] {
  const demanded = ctx.demanded ?? NO_DEMAND;
  const ids: string[] = [];
  const add = (id: string, on: boolean): void => {
    if (on && !ids.includes(id)) ids.push(id);
  };

  if (ctx.explicit) {
    // Unknown ids (a stale saved record, a branch an extension no longer ships) are dropped
    // rather than thrown: the derivation runs inside the host's selector and must not take
    // the app down. `composeGraph` would refuse them; here they simply compose nothing.
    for (const id of ctx.explicit) add(id, table.knownBranchIds.has(id));
    add('face-source', labWantsFace(ctx.featureLab) || demandWantsFace(demanded));
    // The conductor is the instrument's (an explicit set lists it); the recording it leads
    // is the player's, like the dancer's song.
    const conducted = songConducted(settings) && ids.includes('conductor');
    const dancerLeads = songFollows(settings) && !conducted;
    // As below: only while the conductor (or its orchestra) is on, not for a saved set
    // that merely lists an idle conductor.
    const bodyConducts = conductorReadsBody(settings) && ids.includes('conductor') && (on(settings.conductor) || on(settings.conductor?.orchestra));
    add('body-source', labWantsBody(ctx.featureLab) || demandWantsBody(demanded) || dancerLeads || bodyConducts);
    add('song-pace', dancerLeads || conducted);
    return ids;
  }

  // The hand voices default ON: a settings object with no hand map yet (mid-migration) is a
  // field instrument until told otherwise, which is also what the seeds' defaults say.
  const fieldVoices = (settings.handMap?.maxGain ?? 1) > 0;
  add('field-voices', fieldVoices);

  const faceMapping = settings.faceMapping ?? 'none';
  const faceWanted = faceMapping !== 'none' || labWantsFace(ctx.featureLab) || demandWantsFace(demanded);
  add('face-source', faceWanted);
  // The timbre branch colours the hand voices; without them it has nothing to colour.
  add('face-timbre', faceMapping === 'timbre' && fieldVoices);
  add('face-chord', faceMapping === 'chord');
  add('face-controls', faceMapping === 'controls');

  const bodyWanted = on(settings.body) || labWantsBody(ctx.featureLab) || demandWantsBody(demanded);
  // Following the dancer (#186 PR H) needs the body; it does not make the body ROUTE
  // anything onto the voices, so `bodyWanted` (which gates the router) leaves it out.
  // A conductor leading the song replaces the dancer (one leader for one song): the pace
  // node prefers his time, and the body is not started for a dancer nobody follows.
  const dancerLeads = songFollows(settings) && !songConducted(settings);
  add('body-source', bodyWanted || dancerLeads);
  add('song-pace', dancerLeads || songConducted(settings));
  // The router modulates the hand voices: it needs the body AND the voices.
  add('body-route', bodyWanted && fieldVoices && bodyMapRoutesAnything(settings.bodyMap));

  // The orchestra (#187 PR 5) lives in the conductor branch: switching it on composes the
  // branch (the conductor idles until Start), so the soundfont loads before the first beat.
  const conducting = on(settings.conductor) || on(settings.conductor?.orchestra);
  add('conductor', conducting);
  // The body conductor (#375) reads the pose stream: the body source comes with him. It
  // routes nothing onto the voices (`bodyWanted` gates the router and leaves this out).
  add('body-source', conducting && conductorReadsBody(settings));
  add('midi-out', on(settings.midi));
  add('generative', on(settings.steer));
  // The extensions' branches: each manifest says which of its branches its dials imply.
  // An id the table does not know (a typo in a manifest) is dropped, like an unknown
  // explicit id: the derivation must not take the app down.
  for (const ext of table.extensions) for (const id of ext.derive(settings)) add(id, table.knownBranchIds.has(id));
  return ids;
}

/** A stable key for a branch set, so a host can tell "the set changed" without a deep compare. */
export function branchSetKey(ids: readonly string[]): string {
  return [...ids].sort().join('+');
}
