import { PluginDefinition } from './types';
import { aiDjPlugin } from './ai-dj/definition';

export const pluginRegistry: PluginDefinition<any>[] = [
  aiDjPlugin,
];
