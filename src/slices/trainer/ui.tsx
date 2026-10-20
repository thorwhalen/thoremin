/**
 * The Trainer slice's React half (#600 S16d): the Trainer tool (its own frame: a banner above every
 * panel while a routine runs; its icon; its hush named by the tool's data) and the mount effect
 * that keeps the HUD snapshot transient in step with the trainer's store.
 */
import { GraduationCap } from 'lucide-react';
import type { ExtensionUi } from '@thoremin/sdk-ui/types';
import TrainerPanel from './panels/TrainerPanel';
import { TRAINER_TOOL } from './tool';
import { installTrainerHud } from './app/hud';
import { TRAINER_EXTENSION_ID } from './index';

export const TRAINER_UI: ExtensionUi = {
  id: TRAINER_EXTENSION_ID,
  panels: [],
  statusHooks: [],
  onMount: [() => installTrainerHud()],
  tools: [{ ...TRAINER_TOOL, Panel: TrainerPanel, icon: GraduationCap, frame: 'own' }],
};

export default TRAINER_UI;
