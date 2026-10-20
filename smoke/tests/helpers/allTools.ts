/**
 * THE list of tools every tool-driven smoke sweeps: core's (`src/app/tools.ts`) and every shipped
 * slice's or extension's (each a panel the shell frames). One list, imported by `reachability` and
 * `occlusion`, so a tool that moves into a slice cannot silently drop out of one sweep while the
 * other grows (the live smoke fell 85 -> 80 -> 77 that way). A slice that brings a tool adds its
 * data module HERE; the launcher-equals-swept guard in each smoke fails until it does.
 * The modules are plain data with no runtime imports, so the list cannot drift from the shell's.
 */
import { TOOLS } from '../../../src/app/tools';
import { SONG_TOOL } from '../../../src/slices/song/tool';
import { CONDUCTOR_TOOL } from '../../../src/slices/conductor/tool';
import { LAB_TOOL } from '../../../src/slices/lab/tool';
import { TRAINER_TOOL } from '../../../src/slices/trainer/tool';
import { FACES_TOOL, HANDS_TOOL, POSES_TOOL } from '../../../packages/ext-faces/src/tools';

/** A tool as the sweeps need it: core's entries, and a slice's (always a panel). */
export type SweptTool = Pick<(typeof TOOLS)[number], 'id' | 'label' | 'kind' | 'defaultPinned'>;

/** Every shipped slice's or extension's tools. */
export const EXTENSION_TOOLS: readonly SweptTool[] = [CONDUCTOR_TOOL, TRAINER_TOOL, SONG_TOOL, LAB_TOOL, FACES_TOOL, HANDS_TOOL, POSES_TOOL].map((t) => ({
  id: t.id,
  label: t.label,
  kind: 'panel' as const,
  defaultPinned: t.defaultPinned,
}));

/** Core's tools and the extensions'. */
export const ALL_TOOLS: readonly SweptTool[] = [...TOOLS, ...EXTENSION_TOOLS];
