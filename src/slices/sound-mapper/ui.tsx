/**
 * The sound mapper's React half: the Sound mapper tool (its panel, running detached while it
 * plays, with the bar's stop control).
 */
import { Drum } from 'lucide-react';
import type { ExtensionUi } from '@thoremin/sdk-ui/types';
import SoundMapperPanel from './panels/SoundMapperPanel';
import { SOUND_MAPPER_TOOL } from './tool';
import { useSoundMapper } from './app/store';
import { SOUND_MAPPER_EXTENSION_ID } from './index';

export const SOUND_MAPPER_UI: ExtensionUi = {
  id: SOUND_MAPPER_EXTENSION_ID,
  panels: [],
  statusHooks: [],
  onMount: [],
  tools: [
    {
      ...SOUND_MAPPER_TOOL,
      Panel: SoundMapperPanel,
      icon: Drum,
      // It plays on with its panel closed: the bar shows it running and can stop it.
      detached: { useRunning: () => useSoundMapper((s) => s.playing), stop: () => useSoundMapper.getState().play(false), hint: 'stop the sound mapper' },
    },
  ],
};

export default SOUND_MAPPER_UI;
