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
import { EXTENSION_TOOL_DECLS } from './extensions';

/** The core tools followed by the extensions' (validated, `kind: 'panel'`). Throws on a clash. */
export function withExtensionTools(core: readonly Tool[], decls: readonly ExtensionToolDecl[]): Tool[] {
  const out = [...core];
  const ids = new Set(core.map((t) => t.id));
  for (const d of decls) {
    if (ids.has(d.id)) throw new Error(`extensions.json: an extension declares the tool "${d.id}", which another tool already uses`);
    ids.add(d.id);
    out.push(ToolSchema.parse({ ...d, kind: 'panel' }));
  }
  return out;
}

export const SHELL_TOOLS: readonly Tool[] = withExtensionTools(TOOLS, EXTENSION_TOOL_DECLS);

export const shellToolById = (id: string): Tool | undefined => SHELL_TOOLS.find((t) => t.id === id);
