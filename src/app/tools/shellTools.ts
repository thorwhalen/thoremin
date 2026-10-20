/**
 * Every tool the shell lists: the app's own registry (`tools.ts`, React-free and core) and the
 * tools each extension declares (#330: the face categorizer session is the first). The Tools
 * launcher, the bar and the panel host read this list; `tools.ts` stays the core registry the
 * Node tests and the smoke import.
 *
 * An extension's tool is validated against the same {@link ToolSchema} as the app's, always
 * opens a panel, and may not reuse an id: a clash fails at load, loudly, rather than one tool
 * silently shadowing the other in `useTools.open`.
 */
import { ToolSchema, TOOLS, type Tool } from './tools';
import type { ExtensionToolDecl } from '@thoremin/sdk-ui/tools';
import { UI_CONTRIBUTIONS } from '../host/contributions';

/** The core tools followed by the extensions' (validated, `kind: 'panel'`), each placed before the
 *  tool it names (`before`) when the list has it. Throws on a clash. */
export function withExtensionTools(core: readonly Tool[], decls: readonly ExtensionToolDecl[]): Tool[] {
  const out = [...core];
  const ids = new Set(core.map((t) => t.id));
  for (const d of decls) {
    if (ids.has(d.id)) throw new Error(`extensions.json: an extension declares the tool "${d.id}", which another tool already uses`);
    ids.add(d.id);
    const tool = ToolSchema.parse({ ...d, kind: 'panel' });
    const at = d.before === undefined ? -1 : out.findIndex((t) => t.id === d.before);
    if (at < 0) out.push(tool);
    else out.splice(at, 0, tool);
  }
  return out;
}

export const SHELL_TOOLS: readonly Tool[] = withExtensionTools(TOOLS, UI_CONTRIBUTIONS.toolDecls);

export const shellToolById = (id: string): Tool | undefined => SHELL_TOOLS.find((t) => t.id === id);
