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
import type { ToolDeriveContext } from '@thoremin/sdk/instruments/extension';
/**
 * What the derivation needs to know about the build it runs in: which branch ids exist,
 * and each extension's own derivation. A PARAMETER, never an import: this package stays
 * free of the app's extension list (the host binds it once, `branchIdsFor` in
 * `src/app/graph.ts`), and a caller that forgets the extensions fails to typecheck rather
 * than silently deriving a graph without them.
 */
export interface DerivationTable {
  knownBranchIds: ReadonlySet<string>;
  extensions: readonly { id: string; derive: (settings: DerivationSettings, context: { implied: ReadonlySet<string> }) => readonly string[]; toolDerive?: (settings: DerivationSettings, context: ToolDeriveContext) => readonly string[] }[];
  /** The build's branches, as far as the derivation reads them. Their declared `demands` (#600
   *  S17): one is implied while a live claim (the Lab's shown groups, a tool's demand) wants any
   *  group it declares; a source branch says what it measures, nothing names it to turn it on.
   *  Their `requires` (#697): a branch that requires one this build does not ship is dropped. */
  implying?: readonly { id: string; demands?: readonly string[]; requires?: readonly string[] }[];
}

/** The ids a branch requires, transitively, that the build does not know (#697): empty when it
 *  can compose. A cycle is the composer's error to report, not this one's. */
function unmetRequirements(id: string, table: DerivationTable): string[] {
  const requires = new Map((table.implying ?? []).map((b) => [b.id, b.requires ?? []] as const));
  const missing = new Set<string>();
  const seen = new Set<string>();
  const visit = (at: string): void => {
    if (seen.has(at)) return;
    seen.add(at);
    for (const r of requires.get(at) ?? []) {
      if (table.knownBranchIds.has(r)) visit(r);
      else missing.add(r);
    }
  };
  visit(id);
  return [...missing];
}

/** The unmet requirements already reported, so the selector's every-change run warns once each. */
const reportedUnmet = new Set<string>();

/**
 * The branches that can compose in this build (#697): a branch whose requirement another extension
 * provides (the air extension's chord chart requires the conductor slice's `conductor`) is dropped,
 * with one warning, when the build leaves that extension out. Like an unknown id, an unmet
 * requirement must not take the app down (`composeGraph` would throw); the instrument plays without
 * that branch, and the extension hides what needs it.
 */
function composable(ids: readonly string[], table: DerivationTable): string[] {
  return ids.filter((id) => {
    const missing = unmetRequirements(id, table);
    if (missing.length === 0) return true;
    const key = `${id}<-${missing.join(',')}`;
    if (!reportedUnmet.has(key)) {
      reportedUnmet.add(key);
      console.warn(`[thoremin] the branch "${id}" requires ${missing.map((m) => `"${m}"`).join(', ')}, which this build does not ship: it is left out`);
    }
    return false;
  });
}

/** The groups a live claim wants: the demand (the Lab claims its shown groups there while it is
 *  open, #600 S16a, as the Trainer does for a running cue). */
function claimedGroups(ctx: DerivationContext): Set<string> {
  return new Set<string>(ctx.demanded ?? []);
}

/** The branches whose declared `demands` meet `groups`. */
function impliedBy(groups: ReadonlySet<string>, table: DerivationTable): Set<string> {
  const out = new Set<string>();
  if (groups.size === 0) return out;
  for (const b of table.implying ?? []) if (b.demands?.some((g) => groups.has(g))) out.add(b.id);
  return out;
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
  /** Extension dial slices (`airDrum`, …), prefs and transients (the song's, #600 S15): read by
   *  each extension's own `derive` / `toolDerive`. */
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
}

export interface DerivationContext {
  /** The union of live feature-group claims (`appFeatureDemand.groups()`). */
  demanded?: DemandedGroups;
  /**
   * The instrument spec's EXPLICIT branch set, when it declares one (PR 4). It replaces the
   * settings-derived set; what a live tool demands (the face or body source for a claim or
   * a Lab meter) is still unioned in, because a tool's need is not the instrument's to veto.
   */
  explicit?: readonly string[] | null;
}

/**
 * The branch ids `settings` and `ctx` imply, in no particular order (the composer orders).
 * The trunk is implied by the composer and not listed here.
 */
export function deriveBranchIds(settings: DerivationSettings, ctx: DerivationContext, table: DerivationTable): string[] {
  const ids: string[] = [];
  const add = (id: string, on: boolean): void => {
    if (on && !ids.includes(id)) ids.push(id);
  };
  // What the extensions' TOOLS need (#600 S15), on either path: unioned into an explicit set
  // too, after everything else, so each sees the ids implied so far.
  const addToolNeeds = (): void => {
    const implying = (groups: readonly string[]): string[] => [...impliedBy(new Set(groups), table)];
    for (const ext of table.extensions) for (const id of ext.toolDerive?.(settings, { composed: [...ids], implying }) ?? []) add(id, table.knownBranchIds.has(id));
  };
  // What a live claim implies (the Lab, a tool's demand): each source branch by its `demands`.
  const claimed = impliedBy(claimedGroups(ctx), table);
  if (ctx.explicit) {
    // Unknown ids (a stale saved record, a branch an extension no longer ships) are dropped
    // rather than thrown: the derivation runs inside the host's selector and must not take
    // the app down. `composeGraph` would refuse them; here they simply compose nothing.
    for (const id of ctx.explicit) add(id, table.knownBranchIds.has(id));
    for (const id of claimed) add(id, true);
    // What a tool needs, also into an explicit set (the body conductor's pose, a dancer leading
    // the song: the conductor and song slices' tool needs, #600 S15/S18).
    addToolNeeds();
    return composable(ids, table);
  }

  // The hand voices default ON: a settings object with no hand map yet (mid-migration) is a
  // field instrument until told otherwise, which is also what the seeds' defaults say.
  const fieldVoices = (settings.handMap?.maxGain ?? 1) > 0;
  add('field-voices', fieldVoices);

  for (const id of claimed) add(id, true);
  const faceMapping = settings.faceMapping ?? 'none';
  add('face-source', faceMapping !== 'none');
  // The timbre branch colours the hand voices; without them it has nothing to colour.
  add('face-timbre', faceMapping === 'timbre' && fieldVoices);
  add('face-chord', faceMapping === 'chord');
  add('face-controls', faceMapping === 'controls');


  // The extensions' branches: each manifest says which of its branches its dials imply.
  // An id the table does not know (a typo in a manifest) is dropped, like an unknown
  // explicit id: the derivation must not take the app down.
  for (const ext of table.extensions) for (const id of ext.derive(settings, { implied: claimed })) add(id, table.knownBranchIds.has(id));
  addToolNeeds();
  return composable(ids, table);
}

/** A stable key for a branch set, so a host can tell "the set changed" without a deep compare. */
export function branchSetKey(ids: readonly string[]): string {
  return [...ids].sort().join('+');
}
