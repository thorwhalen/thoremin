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
import type { DemandedGroups } from '@/features/demand';
import { demandWantsBody, demandWantsFace, labWantsBody, labWantsFace, type FeatureLabConfig } from '@/features/labConfig';
import { ALL_BRANCH_IDS } from './branches';

const KNOWN_BRANCH_IDS: ReadonlySet<string> = new Set(ALL_BRANCH_IDS);

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
  conductor?: { enabled?: boolean };
  midi?: { enabled?: boolean };
  steer?: { enabled?: boolean };
  airDrum?: { enabled?: boolean };
  airBass?: { enabled?: boolean };
  airGuitar?: { enabled?: boolean };
  airFlute?: { enabled?: boolean };
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
  conductor: { enabled: boolean };
  midi: { enabled: boolean };
  steer: { enabled: boolean };
  airDrum: { enabled: boolean };
  airBass: { enabled: boolean };
  airGuitar: { enabled: boolean };
  airFlute: { enabled: boolean };
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

/**
 * The branch ids `settings` and `ctx` imply, in no particular order (the composer orders).
 * The trunk is implied by the composer and not listed here.
 */
export function branchIdsFor(settings: DerivationSettings, ctx: DerivationContext = {}): string[] {
  const demanded = ctx.demanded ?? NO_DEMAND;
  const ids: string[] = [];
  const add = (id: string, on: boolean): void => {
    if (on && !ids.includes(id)) ids.push(id);
  };

  if (ctx.explicit) {
    // Unknown ids (a stale saved record, a branch an extension no longer ships) are dropped
    // rather than thrown: the derivation runs inside the host's selector and must not take
    // the app down. `composeGraph` would refuse them; here they simply compose nothing.
    for (const id of ctx.explicit) add(id, KNOWN_BRANCH_IDS.has(id));
    add('face-source', labWantsFace(ctx.featureLab) || demandWantsFace(demanded));
    add('body-source', labWantsBody(ctx.featureLab) || demandWantsBody(demanded));
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
  add('body-source', bodyWanted);
  // The router modulates the hand voices: it needs the body AND the voices.
  add('body-route', bodyWanted && fieldVoices && bodyMapRoutesAnything(settings.bodyMap));

  add('conductor', on(settings.conductor));
  add('midi-out', on(settings.midi));
  add('generative', on(settings.steer));
  add('air-drum', on(settings.airDrum));
  add('air-bass', on(settings.airBass));
  add('air-guitar', on(settings.airGuitar));
  add('air-flute', on(settings.airFlute));
  return ids;
}

/** A stable key for a branch set, so a host can tell "the set changed" without a deep compare. */
export function branchSetKey(ids: readonly string[]): string {
  return [...ids].sort().join('+');
}
