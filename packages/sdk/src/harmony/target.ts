/**
 * Targets: what a category (a face expression, a hand shape, a sign) stands for in a harmonic
 * instrument (`docs/design/harmonic-layers.md` §2.5 and §5.4, H6 of #613). A category can choose
 * a chord (today's degree tables), make a MOVE from the chord in force, choose a FUNCTION (the
 * space picks the chord), or set a realization CONTROL while it is held.
 *
 * Stored as one short string per category, so every value stays a scalar leaf of a dial (the
 * command layer dispatches scalars, and a stored blob stays readable):
 *
 *   ''            the category's degree, from the instrument's degree table (today's meaning)
 *   'move:dia+3'  apply a relation (`./space` RELATIONS) to the chord in force
 *   'fn:T'        choose the nearest chord with that Riemann function (T, S or D)
 *   'ctl:seventh' keep the chord in force and add the key's seventh while held
 *
 * An unknown string reads as '' (the degree), so a value written by a newer build never breaks
 * an older one. Pure.
 */
import { z } from 'zod';
import { RELATIONS } from './space';

export type Target =
  | { kind: 'degree' }
  | { kind: 'move'; relation: string }
  | { kind: 'function'; riemann: 'T' | 'S' | 'D' }
  | { kind: 'control'; control: 'seventh' };

export const TARGET_CONTROLS = ['seventh'] as const;
export const RIEMANN_FUNCTIONS = ['T', 'S', 'D'] as const;

/** A stored target string's schema: any string (unknown values read as the degree). */
export const TargetStringSchema = z.string();

/** The target a stored string names; '' or anything unknown is the degree. `moves` limits which
 *  relations an instrument accepts (the face chord: the key's diatonic moves); any other move is
 *  read as the degree, so what is shown and what plays agree. */
export function parseTarget(raw: string | undefined | null, { moves }: { moves?: (relation: string) => boolean } = {}): Target {
  if (!raw) return { kind: 'degree' };
  const [kind, value] = raw.split(':', 2);
  if (kind === 'move' && value && RELATIONS.has(value) && (!moves || moves(value))) return { kind: 'move', relation: value };
  if (kind === 'fn' && (RIEMANN_FUNCTIONS as readonly string[]).includes(value)) return { kind: 'function', riemann: value as 'T' | 'S' | 'D' };
  if (kind === 'ctl' && (TARGET_CONTROLS as readonly string[]).includes(value)) return { kind: 'control', control: value as 'seventh' };
  return { kind: 'degree' };
}

/** A personal category's target: its own when it has one, else none when it has a degree of its
 *  own (that degree is the category's choice), else the target of the expression it stands in
 *  for. One rule, so what plays and what the overlay names agree. */
export function categoryTarget(
  id: string,
  standsFor: string | undefined,
  { own, degrees, expressions }: { own?: Record<string, string>; degrees?: Record<string, number>; expressions?: Partial<Record<string, string>> },
): string | undefined {
  return own?.[id] || (id in (degrees ?? {}) ? '' : expressions?.[standsFor ?? 'neutral']);
}

/** The diatonic moves (`dia+-k`): what a target in a one-key instrument may name. */
export const isDiatonicMove = (relation: string): boolean => /^dia[+-][1-3]$/.test(relation);

/** A few characters for a target, where a chord name would go (a bar's label): the move's own
 *  label, the function's letter, '+7'; '' for the degree. */
export function targetText(t: Target): string {
  switch (t.kind) {
    case 'degree':
      return '';
    case 'move':
      return RELATIONS.get(t.relation)?.label ?? t.relation;
    case 'function':
      return t.riemann;
    case 'control':
      return '+7';
  }
}

/** What a one-key category instrument offers as targets, with the words its editors show: its
 *  degree, the key's six diatonic moves, the three functions, the seventh. One list, so the face
 *  chord's editor and the personal categorizers' say the same thing. */
export const TARGET_CHOICES: readonly { value: string; label: string }[] = [
  { value: '', label: 'plays its chord' },
  ...['dia+3', 'dia-3', 'dia+2', 'dia-2', 'dia+1', 'dia-1'].map((m) => ({ value: `move:${m}`, label: `moves a ${RELATIONS.get(m)?.label ?? m}` })),
  { value: 'fn:T', label: 'goes to a tonic chord' },
  { value: 'fn:S', label: 'goes to a subdominant chord' },
  { value: 'fn:D', label: 'goes to a dominant chord' },
  { value: 'ctl:seventh', label: 'adds the seventh' },
];

/** The stored string's choice, as the editors show it (a move outside the key reads as the degree). */
export const targetChoice = (raw: string | undefined | null): string => formatTarget(parseTarget(raw, { moves: isDiatonicMove }));

/** The string a target is stored as. */
export function formatTarget(t: Target): string {
  switch (t.kind) {
    case 'degree':
      return '';
    case 'move':
      return `move:${t.relation}`;
    case 'function':
      return `fn:${t.riemann}`;
    case 'control':
      return `ctl:${t.control}`;
  }
}
