/**
 * A saved POSE categorizer made ready to play in an instrument (#384, body-movement B4), and what
 * the `pose-categorizer` node emits from its reading. The face's counterpart is `./play.ts`; a
 * pose stands in for no expression, so its reading leaves the node as the generic
 * `CategoryScores` the overlay's category cues draw, not as `ExpressionScores`.
 *
 * - **Live**: the same live model as the tool's live test (`./live.ts`, under the record's tuning):
 *   the categorizer's own reader (the mirror holds a side, #382), "cannot see you" below the
 *   trained features' coverage, the classifier and its hysteresis.
 * - **Transport** (#387 B5: the conductor's rules by default, a pose category as the player's
 *   override): the categories named `ready`, `fermata` and `cut-off` (#383's conductor
 *   vocabulary; case-insensitive, with `hold` and `cutoff` too) ADD their role to the
 *   conductor's rules (A5's `transportPose` seam): while one of them is the settled category its
 *   role is stated TRUE, and nothing else is ever stated. A stated false would not mean "not in
 *   that pose" to A5's machine: `ready: false` disarms a prepared start (the upbeat leaves the
 *   ready pose before the downbeat), and any stated `cutoff` switches off the stop when the
 *   player leaves the camera. So outside a named pose (the rest, an unnamed category, out of
 *   view) the rules decide, as without poses.
 *
 * Pure: no store, no DOM.
 */
import type { PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { bodyModality } from '@thoremin/sdk/features/modalities/body';
import type { CategoryScores } from '@thoremin/sdk/nodes/domain';
import { liveModel, type LiveModel, type LiveReading, type Tuning } from '@thoremin/sdk/enroll/live';

/** The conductor's transport predicates (A5's `transportPose` input): a stated one replaces its
 *  rule's geometry, an absent one leaves the rule in charge. */
export interface PoseTransport {
  ready?: boolean;
  hold?: boolean;
  cutoff?: boolean;
}

export type TransportRole = keyof PoseTransport;

/** The category names that state each role (lower case, trimmed). */
export const TRANSPORT_NAMES: Readonly<Record<TransportRole, readonly string[]>> = {
  ready: ['ready'],
  hold: ['fermata', 'hold'],
  cutoff: ['cut-off', 'cutoff', 'cut off'],
};

/** A pose categorizer resolved for the DAG: what the `pose-categorizer` node reads (a transient). */
export interface PoseCategorizerPlay {
  /** The saved record's id: the node plays this model only while the dial still names it. */
  id: string;
  name: string;
  live: LiveModel;
  /** The category id that states each transport role, by role (absent: the rule keeps it). */
  roles: Partial<Record<TransportRole, string>>;
}

/** Which category states each transport role: the first one named for it. */
export function transportRolesOf(categorizer: Pick<PersonalCategorizer, 'categories'>): Partial<Record<TransportRole, string>> {
  const out: Partial<Record<TransportRole, string>> = {};
  for (const role of Object.keys(TRANSPORT_NAMES) as TransportRole[]) {
    const c = categorizer.categories.find((x) => TRANSPORT_NAMES[role].includes(x.label.trim().toLowerCase()));
    if (c) out[role] = c.id;
  }
  return out;
}

/** A saved pose categorizer, resolved to play under its own tuning. */
export function posePlay(record: { id: string; name: string; categorizer: PersonalCategorizer; tuning?: Partial<Tuning> }): PoseCategorizerPlay {
  return {
    id: record.id,
    name: record.name,
    live: liveModel(record.categorizer, record.tuning ?? {}, { modality: bodyModality }),
    roles: transportRolesOf(record.categorizer),
  };
}

/** No reading (no body in view, or too little of it): absent, every category at 0. */
export function absentPoseScores(play: PoseCategorizerPlay): CategoryScores {
  const cats = play.live.model.categories;
  return { present: false, label: null, labels: cats.map((c) => c.label), scores: cats.map(() => 0), title: play.name };
}

/** One reading as the overlay's `CategoryScores`: the settled category named, each category's
 *  membership as its bar. Neutral (the rest) names nothing. */
export function toPoseScores(play: PoseCategorizerPlay, reading: Pick<LiveReading, 'label' | 'memberships'>): CategoryScores {
  return {
    present: true,
    label: reading.label,
    labels: reading.memberships.map((m) => m.label),
    scores: reading.memberships.map((m) => m.value),
    title: play.name,
  };
}

/** The transport predicate of one reading: the role whose category is the settled one, stated
 *  true; undefined (nothing stated: the rules decide) otherwise. */
export function poseTransport(play: PoseCategorizerPlay, categoryId: string | null): PoseTransport | undefined {
  if (categoryId === null) return undefined;
  for (const [role, id] of Object.entries(play.roles) as [TransportRole, string][]) if (id === categoryId) return { [role]: true };
  return undefined;
}
