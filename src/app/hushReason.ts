/**
 * Why the instrument is quiet without the player having muted it, in words (the shell's quiet
 * badge): an open tool that hushes and holds its claim (`Tool.hushes`, #600 S16c: the Trainer says
 * "while the Trainer is open"), else the first extension hush that holds (`Extension.hushes`, S18a:
 * the conductor's score), else nothing. A hush claim no tool names a reason for (a carve tool's
 * quiet) says nothing, as before.
 */
import type { HushDecl } from '@thoremin/sdk/instruments/extension';

export function hushReason(
  state: Readonly<Record<string, unknown>> & { hushedBy: readonly string[] },
  { tools, hushes }: { tools: readonly { id: string; hushes?: string }[]; hushes: readonly HushDecl[] },
): string | null {
  const tool = tools.find((t) => t.hushes && state.hushedBy.includes(t.id));
  if (tool?.hushes) return tool.hushes;
  return hushes.find((h) => h.while(state as Parameters<HushDecl['while']>[0]))?.reason ?? null;
}
