/**
 * The faces extension's React half, EAGER STUB: the shell tools (Your faces, since #385 E8 Your hand shapes, since #382 Your poses) and the editor section it
 * contributes, as data, so the Tools launcher and the instrument editor list them before
 * anything loads. Their components are `./lazy_ui.tsx`, loaded the first time the tool or the
 * section opens, or a graph names the categorizer node (`docs/design/lazy-extensions.md`). No
 * React import: it is data, plus the carve commands, which are thin calls onto the SDK's capture
 * seam and so run without loading the deferred half (#600 S11).
 */
import type { ExtensionUiStub } from '@thoremin/sdk-ui/types';
import type { ToolEntryPointDecl } from '@thoremin/sdk-ui/tools';
import { FACES_TOOL, HANDS_TOOL, POSES_TOOL } from './tools';
import { CARVE_COMMANDS } from './carveCommandsUi';
import { chordModalityOf, isPersonal, playsPoses, type CategorizerChordsDial, type FaceCategorizerDial, type PoseCategorizerDial } from './schema';

/** The chosen row shows which categorizer the face chords read while one of the player's plays
 *  them (#367); the general model needs no line. */
export const faceReadoutOn = (s: Readonly<Record<string, unknown>>): boolean =>
  s.faceMapping === 'chord' && isPersonal(s.faceCategorizer as Partial<FaceCategorizerDial> | undefined);
/** And which pose categorizer the instrument reads, while it reads one (#367). */
export const poseReadoutOn = (s: Readonly<Record<string, unknown>>): boolean => playsPoses(s.poseCategorizer as Partial<PoseCategorizerDial> | undefined);
/** And which categorizer plays the categorizer chords, while one does (#450). */
export const chordsReadoutOn = (s: Readonly<Record<string, unknown>>): boolean => chordModalityOf((s.categorizerChords as Partial<CategorizerChordsDial> | undefined)?.id) !== null;

// The shell tools, as data in a module with no runtime imports (the reachability smoke imports it).
export { FACES_TOOL, HANDS_TOOL, POSES_TOOL };

/** The Conductor tool's way into "Your poses" with the conductor's default names (#383): shown
 *  while the conductor reads the body. */
export const CONDUCTOR_POSES_ENTRY: ToolEntryPointDecl = {
  id: 'conductor-poses',
  from: 'conductor',
  tool: POSES_TOOL.id,
  label: 'Teach my conducting poses (ready, fermata, cut-off)...',
  when: { 'conductor.source': 'body' },
  carve: { modality: 'body', vocabulary: 'conductor' },
};

export const FACES_UI_STUB: ExtensionUiStub = {
  // The carve commands (#600 S11; core's before), declared in the pure manifest.
  commands: CARVE_COMMANDS,
  id: 'faces',
  // The instrument editor's section (#330 P4): which categorizer the face chords read.
  // And (#384) which saved pose categorizer the instrument reads and conducts with.
  panels: [
    { instrumentId: 'faces', section: 'Face categorizer', readoutOn: faceReadoutOn },
    { instrumentId: 'faces', section: 'Pose categorizer', readoutOn: poseReadoutOn },
    { instrumentId: 'faces', section: 'Categorizer chords', readoutOn: chordsReadoutOn },
  ],
  tools: [FACES_TOOL, HANDS_TOOL, POSES_TOOL],
  entryPoints: [CONDUCTOR_POSES_ENTRY],
};

export default FACES_UI_STUB;
