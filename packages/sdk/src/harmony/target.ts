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

/** The target a stored string names; '' or anything unknown is the degree. */
export function parseTarget(raw: string | undefined | null): Target {
  if (!raw) return { kind: 'degree' };
  const [kind, value] = raw.split(':', 2);
  if (kind === 'move' && value && RELATIONS.has(value)) return { kind: 'move', relation: value };
  if (kind === 'fn' && (RIEMANN_FUNCTIONS as readonly string[]).includes(value)) return { kind: 'function', riemann: value as 'T' | 'S' | 'D' };
  if (kind === 'ctl' && (TARGET_CONTROLS as readonly string[]).includes(value)) return { kind: 'control', control: value as 'seventh' };
  return { kind: 'degree' };
}

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
