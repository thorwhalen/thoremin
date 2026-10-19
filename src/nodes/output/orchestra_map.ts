/**
 * The orchestra's map from a score to a General MIDI synth (#187 PR 5): which sections
 * exist, which GM program belongs to which, which programs the shipped soundfont holds,
 * and how a document's parts are laid onto the 16 MIDI channels.
 *
 * Why a module of its own. Three readers need the same answers and must not disagree:
 * the `orchestra` node (program changes, per-section volume), the Conductor panel (one
 * volume slider per section) and the offline cut script (`scripts/orchestra/`), which
 * keeps exactly {@link BANK_PROGRAMS} when it trims MuseScore_General. A part whose
 * program the cut bank does not hold is played by the nearest program it does hold in
 * the same GM family, else by {@link DEFAULT_PROGRAM}, so a player's own MIDI file
 * never plays a piano where a horn was written. (Percussion parts are the exception: the
 * cut bank has no drum kit, so the node leaves them out rather than play drum keys on a
 * violin; #334.)
 *
 * Pure and Node-safe: no audio, no DOM.
 */
import type { ScorePart } from '@thoremin/sdk/score/schema';
import { type Section } from './orchestra_map.schema';
export { SECTIONS } from './orchestra_map.schema';
export type { Section } from './orchestra_map.schema';

/** The program a part with no program plays (GM 49, String Ensemble 1, zero-based 48). */
export const DEFAULT_PROGRAM = 48;

/**
 * The GM programs (zero-based) the shipped soundfont keeps: every program the shipped
 * scores name (`public/scores/`: Beethoven 5's winds, timpani and strings; the Haydn
 * quartet's strings) plus {@link DEFAULT_PROGRAM}. D10 on #168 is the rule: cut to what
 * the shipped scores use. Adding a shipped score that names another program means
 * adding it here and re-running the cut (`scripts/orchestra/cut_soundfont.ts`); a test
 * pins that every shipped score's programs are in this list.
 */
export const BANK_PROGRAMS: readonly number[] = [40, 41, 42, 43, 47, 48, 68, 69, 70, 71, 73];

/** GM drum channel (zero-based 9). */
export const PERCUSSION_CHANNEL = 9;
/** MIDI has 16 channels. */
export const CHANNEL_COUNT = 16;

/** The section a GM program (zero-based) belongs to. */
export function sectionOf(program: number, percussion = false): Section {
  if (percussion) return 'percussion';
  if (program >= 40 && program <= 46) return 'strings'; // violin..harp
  if (program === 47) return 'percussion'; // timpani
  if (program >= 48 && program <= 55) return 'strings'; // ensembles, choir
  if (program >= 56 && program <= 63) return 'brass';
  if (program >= 64 && program <= 79) return 'woodwinds'; // reeds + pipes
  return 'other';
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

/** One part's place in the synth. */
interface PartChannel {
  partId: string;
  channel: number;
  /** The program sent to the channel (already mapped onto the bank). */
  program: number;
  section: Section;
}

/**
 * Lay the parts onto channels. Parts that play the same program share a channel (a
 * symphony's first and second violins, the two horns), which is how a 16-channel synth
 * holds a full orchestra; percussion parts share the GM drum channel; the rest take the
 * melodic channels in order. When there are more distinct programs than melodic
 * channels (15), the overflow shares the channel of the last one in the same section,
 * else the last channel: a surplus part plays with a neighbour's sound, it is never
 * dropped.
 */
export function allocateChannels(parts: readonly Pick<ScorePart, 'id' | 'program' | 'percussion'>[], bank: readonly number[] = BANK_PROGRAMS): PartChannel[] {
  const melodic = Array.from({ length: CHANNEL_COUNT }, (_, c) => c).filter((c) => c !== PERCUSSION_CHANNEL);
  const byProgram = new Map<number, number>();
  const lastInSection = new Map<Section, number>();
  const channelProgram = new Map<number, number>();
  const out: PartChannel[] = [];
  for (const part of parts) {
    if (part.percussion) {
      out.push({ partId: part.id, channel: PERCUSSION_CHANNEL, program: 0, section: 'percussion' });
      continue;
    }
    const wanted = bankProgramFor(part.program, bank);
    const section = sectionOf(wanted);
    let channel = byProgram.get(wanted);
    if (channel === undefined && byProgram.size < melodic.length) {
      channel = melodic[byProgram.size];
      byProgram.set(wanted, channel);
      channelProgram.set(channel, wanted);
    }
    // Overflow: share a channel, and so its program (a channel holds one).
    channel ??= lastInSection.get(section) ?? melodic[melodic.length - 1];
    lastInSection.set(section, channel);
    const program = channelProgram.get(channel) ?? wanted;
    out.push({ partId: part.id, channel, program, section: sectionOf(program) });
  }
  return out;
}
