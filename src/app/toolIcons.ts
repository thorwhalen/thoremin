/**
 * The icon per tool id, for the bar and the launcher. Kept out of `tools.ts` so the
 * registry stays React-free and importable from plain Node tests. A tool with no icon
 * still renders — label-only is fine, an icon-only button is not.
 */
import { FlaskConical, Command, BookOpen, Hand, Music2, GraduationCap, Bot, type LucideIcon } from 'lucide-react';

export const TOOL_ICONS: Record<string, LucideIcon> = {
  lab: FlaskConical,
  commands: Command,
  gestures: Hand,
  conductor: Music2,
  trainer: GraduationCap,
  assistant: Bot,
  manual: BookOpen,
};
