/**
 * Sections an extension contributes to another tool's panel (#600 S15; `ExtensionToolSection`), as
 * the host panels show them. Entry points (`./entryPoints.ts`) are links into a tool; a section is
 * a piece of one: the Conductor panel shows "Conduct a recording" from whichever extension plays
 * recordings, and raises its Start and Stop to it inside the click, without naming the song.
 */
import type { ExtensionToolSection, ToolSectionContext } from '@thoremin/sdk-ui/types';
import { UI_CONTRIBUTIONS } from '../host/contributions';

/** The sections tool `from`'s panel shows now: `when` holds over its context. */
export function toolSectionsFrom(from: string, context: ToolSectionContext, all: readonly ExtensionToolSection[] = UI_CONTRIBUTIONS.toolSections): ExtensionToolSection[] {
  return all.filter((s) => s.from === from && Object.entries(s.when ?? {}).every(([k, v]) => context[k] === v));
}

/** Raise a panel event (`start`) to every section contributed to `from`, shown or not, synchronously:
 *  called inside the click, so a section's handler counts as the user's gesture. A throwing handler
 *  is reported and skips no other. */
export function raiseToolEvent(from: string, event: string, context: ToolSectionContext, all: readonly ExtensionToolSection[] = UI_CONTRIBUTIONS.toolSections): void {
  for (const s of all) {
    if (s.from !== from) continue;
    try {
      s.on?.[event]?.(context);
    } catch (e) {
      console.error(`tool section "${s.id}" failed on "${event}"`, e);
    }
  }
}

/** The sections of tool `from`'s panel, in `extensions.json`'s order. */
export function ToolSections({ from, context }: { from: string; context: ToolSectionContext }) {
  return (
    <>
      {toolSectionsFrom(from, context).map(({ id, Section }) => (
        <Section key={id} context={context} />
      ))}
    </>
  );
}
