import { Music } from 'lucide-react';
import { PluginDefinition, PluginContext, PluginInstance } from '../types';
import { AiDjSettings, DEFAULT_AI_DJ_SETTINGS } from './types';
import { ApiKeyDialog } from './ApiKeyDialog';
import { LyriaSessionManager } from './LyriaSession';

export const aiDjPlugin: PluginDefinition<AiDjSettings> = {
  id: 'ai-dj',
  name: 'AI DJ',
  description: 'Lyria Realtime AI music generation steered by vibes',
  icon: Music,
  defaultSettings: DEFAULT_AI_DJ_SETTINGS,
  SetupDialog: ApiKeyDialog,

  activate: async (ctx: PluginContext<AiDjSettings>): Promise<PluginInstance> => {
    const apiKey = localStorage.getItem('thoremin:plugin:ai-dj:apiKey');
    if (!apiKey) {
      throw new Error('No API key configured');
    }

    const session = new LyriaSessionManager(apiKey, ctx.audioContext, ctx.masterGain);

    const { AiDjOverlayPanel } = await import('./AiDjOverlayPanel');

    return {
      deactivate: () => {
        session.disconnect();
      },
      OverlayPanel: () => AiDjOverlayPanel({ session }),
    };
  },
};
