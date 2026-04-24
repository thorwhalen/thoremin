import React from 'react';

export type PluginId = string;

export type PluginStatus = 'disabled' | 'activating' | 'active' | 'error';

export interface PluginDefinition<TSettings = Record<string, unknown>> {
  id: PluginId;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  defaultSettings: TSettings;
  activate: (ctx: PluginContext<TSettings>) => Promise<PluginInstance>;
  SetupDialog?: React.ComponentType<SetupDialogProps<TSettings>>;
}

export interface PluginContext<TSettings = Record<string, unknown>> {
  audioContext: AudioContext;
  masterGain: GainNode;
  getSettings: () => TSettings;
  updateSettings: (patch: Partial<TSettings>) => void;
}

export interface PluginInstance {
  deactivate: () => void | Promise<void>;
  SettingsPanel?: React.ComponentType;
  OverlayPanel?: React.ComponentType;
}

export interface SetupDialogProps<TSettings = Record<string, unknown>> {
  settings: TSettings;
  updateSettings: (patch: Partial<TSettings>) => void;
  onSetupComplete: () => void;
  onCancel: () => void;
}
