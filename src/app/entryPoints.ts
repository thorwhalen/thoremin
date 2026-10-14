/**
 * Entry points into a tool from another tool's panel (#465): what extensions declare
 * (`ToolEntryPointDecl`) as the host's panels list them. The Conductor panel used to name the faces
 * extension's `poses` tool and `body` modality by literal; now it asks for the entry points
 * `from: 'conductor'` and opens whichever the build ships.
 */
import { requestCarve } from '@thoremin/sdk-ui/enroll/carveRequest';
import type { ToolEntryPointDecl } from '@thoremin/sdk-ui/tools';
import { EXTENSION_ENTRY_POINTS } from './extensions';
import { shellToolById } from './shellTools';
import { useTools } from './toolsStore';

/** What a host panel knows that an entry point's `when` may name (`conductor.source`). */
export type EntryContext = Readonly<Record<string, string | number | boolean>>;

/** The entry points listed in tool `from`'s panel now: its tool is in the shell and `when` holds. */
export function entryPointsFrom(from: string, context: EntryContext, all: readonly ToolEntryPointDecl[] = EXTENSION_ENTRY_POINTS): ToolEntryPointDecl[] {
  return all.filter((e) => e.from === from && shellToolById(e.tool) && Object.entries(e.when ?? {}).every(([k, v]) => context[k] === v));
}

/** Follow an entry point: the carve request first (the tool takes it when its session exists),
 *  then the tool opens. */
export function openEntryPoint(e: ToolEntryPointDecl): void {
  if (e.carve) requestCarve(e.carve.modality, { vocabulary: e.carve.vocabulary });
  useTools.getState().openTool(e.tool);
}
