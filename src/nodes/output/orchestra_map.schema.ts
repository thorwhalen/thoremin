/**
 * The `orchestra_map` node's CONTRACT (#600 S6, the `<node>.schema.ts` pattern): its settings schema,
 * defaults and types, importable without the node's implementation. The node imports them from
 * here and re-exports them, so existing imports of the node keep working; code outside
 * `src/nodes` imports this module.
 */


import type { ScorePart } from '@thoremin/sdk/score/schema';

/** The orchestra's sections, in the order the panel lists them. */
export const SECTIONS = ['strings', 'woodwinds', 'brass', 'percussion', 'other'] as const;
export type Section = (typeof SECTIONS)[number];

/** The program a part with no program plays (GM 49, String Ensemble 1, zero-based 48). */
export const DEFAULT_PROGRAM = 48;

/**
 * The GM programs (zero-based) the shipped soundfont keeps: the research map's orchestral
 * set (#334 option b), strings and harp (40 to 46), timpani (47), the string ensembles
 * (48, 49), brass (56 to 61) and winds (68 to 73), so a player's own MIDI file names a
 * horn and hears one. It is a superset of what the shipped scores use (D10 on #168 cut to
 * that; the 15 MB self-hosting threshold is the rule now: this cut is 6.0 MB). The piano (0)
 * is left out on purpose: its samples alone are 15 MB, so a piano part plays the string
 * ensemble. Adding a program means adding it here and re-running the cut
 * (`scripts/orchestra/cut_soundfont.ts`) and stating the size; a test pins that every
 * shipped score's programs are in this list.
 */
export const BANK_PROGRAMS: readonly number[] = [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 56, 57, 58, 59, 60, 61, 68, 69, 70, 71, 72, 73];

/** What each kept program sounds like, for the panel (zero-based GM numbers; the cut's own names). */
export const BANK_PROGRAM_NAMES: Readonly<Record<number, string>> = {
  40: 'violin', 41: 'viola', 42: 'cello', 43: 'contrabass', 44: 'tremolo strings', 45: 'pizzicato strings', 46: 'harp', 47: 'timpani',
  48: 'string ensemble', 49: 'slow strings', 56: 'trumpet', 57: 'trombone', 58: 'tuba', 59: 'muted trumpet', 60: 'horns', 61: 'brass section',
  68: 'oboe', 69: 'English horn', 70: 'bassoon', 71: 'clarinet', 72: 'piccolo', 73: 'flute',
};

/**
 * What a part is played by when the bank lacks its program (a stand-in, #334): the name of the
 * kept program that plays it, else null (the program is kept, the part names none, or it is
 * percussion, which the cut has no kit for and so is left out rather than played by something else).
 */
export function standInFor(part: Pick<ScorePart, 'program' | 'percussion'>, bank: readonly number[] = BANK_PROGRAMS): string | null {
  if (part.percussion || part.program === undefined || bank.includes(part.program)) return null;
  return BANK_PROGRAM_NAMES[bankProgramFor(part.program, bank)] ?? null;
}

/** The program the bank plays for a requested one: itself when kept, else the nearest
 *  kept program in the same GM family of eight, else {@link DEFAULT_PROGRAM}. */
export function bankProgramFor(program: number | undefined, bank: readonly number[] = BANK_PROGRAMS): number {
  if (program === undefined) return DEFAULT_PROGRAM;
  if (bank.includes(program)) return program;
  const family = Math.floor(program / 8);
  let best: number | null = null;
  for (const p of bank) {
    if (Math.floor(p / 8) !== family) continue;
    if (best === null || Math.abs(p - program) < Math.abs(best - program)) best = p;
  }
  return best ?? DEFAULT_PROGRAM;
}

