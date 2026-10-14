/**
 * The faces extension's React half, EAGER STUB: the shell tools (Your faces, since #385 E8 Your hand shapes, since #382 Your poses) and the editor section it
 * contributes, as data, so the Tools launcher and the instrument editor list them before
 * anything loads. Their components are `./lazy_ui.tsx`, loaded the first time the tool or the
 * section opens, or a graph names the categorizer node (`docs/design/lazy-extensions.md`). No
 * React import: it is data.
 */
import type { ExtensionUiStub } from '@thoremin/sdk-ui/types';
import type { ExtensionToolDecl } from '@thoremin/sdk-ui/tools';
import { isPersonal, playsPoses, type FaceCategorizerDial, type PoseCategorizerDial } from './schema';

/** The chosen row shows which categorizer the face chords read while one of the player's plays
 *  them (#367); the general model needs no line. */
export const faceReadoutOn = (s: Readonly<Record<string, unknown>>): boolean =>
  s.faceMapping === 'chord' && isPersonal(s.faceCategorizer as Partial<FaceCategorizerDial> | undefined);
/** And which pose categorizer the instrument reads, while it reads one (#367). */
export const poseReadoutOn = (s: Readonly<Record<string, unknown>>): boolean => playsPoses(s.poseCategorizer as Partial<PoseCategorizerDial> | undefined);

/** The face session's shell tool, as data (the deferred half `./lazy_ui.tsx` adds its panel). */
export const FACES_TOOL: ExtensionToolDecl = {
  id: 'faces',
  label: 'Your faces',
  description: 'Record your own faces and carve them into categories you name and keep: the face categorizer.',
  group: 'mode',
  defaultPinned: false,
};

/** The hand-shape session's shell tool (#385 E8): the same carve over one hand's shape. */
export const HANDS_TOOL: ExtensionToolDecl = {
  id: 'hand-shapes',
  label: 'Your hand shapes',
  description: 'Record your own hand shapes and carve them into categories you name and keep; each one can fire a command.',
  group: 'mode',
  defaultPinned: false,
};

/** The pose session's shell tool (#382 = #385 E9): the same carve over held body poses. */
export const POSES_TOOL: ExtensionToolDecl = {
  id: 'poses',
  label: 'Your poses',
  description: 'Record your own body poses and carve them into categories you name and keep; each one can fire a command.',
  group: 'mode',
  defaultPinned: false,
};

export const FACES_UI_STUB: ExtensionUiStub = {
  id: 'faces',
  // The instrument editor's section (#330 P4): which categorizer the face chords read.
  // And (#384) which saved pose categorizer the instrument reads and conducts with.
  panels: [
    { instrumentId: 'faces', section: 'Face categorizer', readoutOn: faceReadoutOn },
    { instrumentId: 'faces', section: 'Pose categorizer', readoutOn: poseReadoutOn },
  ],
  tools: [FACES_TOOL, HANDS_TOOL, POSES_TOOL],
};

export default FACES_UI_STUB;
