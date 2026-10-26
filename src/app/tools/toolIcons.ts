/**
 * The icon per tool id, for the bar and the launcher. Kept out of `tools.ts` so the
 * registry stays React-free and importable from plain Node tests. A tool with no icon
 * still renders — label-only is fine, an icon-only button is not. An extension's tool brings its
 * own (#600 S15: `ExtensionTool.icon`), folded in here.
 */
import type { ComponentType } from 'react';
import { Command, BookOpen, Hand, Bot, FileUp } from 'lucide-react';
import { UI_CONTRIBUTIONS } from '../host/contributions';

export const TOOL_ICONS: Record<string, ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  commands: Command,
  gestures: Hand,
  replay: FileUp,
  assistant: Bot,
  manual: BookOpen,
  ...Object.fromEntries(UI_CONTRIBUTIONS.toolIcons.map((t) => [t.id, t.icon])),
};
