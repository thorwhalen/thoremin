/**
 * Catalog — introspect a {@link NodeRegistry} into a structured, serializable
 * description of every node: its purpose, ports, and params. This is the SSOT
 * for the user-facing manual (rendered to markdown / a standalone HTML page /
 * a future in-app "node browser"), so the manual can never drift from the code.
 *
 * Pure + Node-safe (just reads node metadata + introspects Zod schemas), so it
 * is unit-testable headlessly.
 */
import type { NodeRegistry } from '@/dag';
import type { NodeDef, PortSpec, Role } from '@/dag';

export interface PortInfo {
  name: string;
  kind?: string;
  description?: string;
  default?: unknown;
}

export interface ParamInfo {
  name: string;
  type: string;
  default?: unknown;
}

export interface CatalogEntry {
  type: string;
  title: string;
  description: string;
  /** Advisory role tag(s) on the node def (see {@link Role}); [] if untagged. */
  roles: Role[];
  inputs: PortInfo[];
  outputs: PortInfo[];
  params: ParamInfo[];
}

const portInfo = (p: PortSpec): PortInfo => ({
  name: p.name,
  kind: p.kind,
  description: p.description,
  default: p.default,
});

/* eslint-disable @typescript-eslint/no-explicit-any */
// Zod 4 introspection: `_def.type` is a lowercase tag ('number'|'string'|'object'|
// 'enum'|'default'|'optional'|…). Wrapper types expose `.innerType`; a `.refine()`/
// `.superRefine()` on an object stays `type: 'object'` (no ZodEffects wrapper in v4).
const TYPE_TAGS: Record<string, string> = {
  number: 'number',
  string: 'string',
  boolean: 'boolean',
  array: 'array',
  object: 'object',
  any: 'any',
  unknown: 'unknown',
};

/** Unwrap wrapper Zod types (default/optional/nullable/prefault/pipe) to the inner ZodObject. */
function unwrapToObject(schema: any): any | null {
  let s = schema;
  for (let i = 0; i < 6 && s && s._def; i++) {
    const t = s._def.type;
    if (t === 'object') return s;
    if (t === 'pipe') s = s._def.in ?? s._def.out;
    else if (t === 'default' || t === 'optional' || t === 'nullable' || t === 'prefault') s = s._def.innerType;
    else break;
  }
  return s && s._def && s._def.type === 'object' ? s : null;
}

function paramInfo(name: string, field: any): ParamInfo {
  let f = field;
  let def: unknown;
  for (let i = 0; i < 6 && f && f._def; i++) {
    const t = f._def.type;
    if (t === 'default' || t === 'prefault') {
      const dv = f._def.defaultValue;
      try {
        def = typeof dv === 'function' ? dv() : dv;
      } catch {
        /* ignore */
      }
      f = f._def.innerType;
    } else if (t === 'optional' || t === 'nullable') {
      f = f._def.innerType;
    } else {
      break;
    }
  }
  const t = f && f._def ? f._def.type : 'unknown';
  let type = TYPE_TAGS[t] ?? String(t);
  if (t === 'enum') {
    const values = (f.options as string[] | undefined) ?? Object.values(f._def.entries ?? {});
    type = `enum(${(values as string[]).join(' | ')})`;
  }
  return { name, type, default: def };
}

function paramsOf(def: NodeDef): ParamInfo[] {
  try {
    const obj = unwrapToObject(def.params as any);
    if (!obj) return [];
    const shape = obj.shape;
    return Object.entries(shape).map(([name, field]) => paramInfo(name, field));
  } catch {
    return [];
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Build the catalog from a registry (sorted by node type for stable output). */
export function buildCatalog(registry: NodeRegistry): CatalogEntry[] {
  return registry
    .list()
    .map((def) => ({
      type: def.type,
      title: def.title ?? def.type,
      description: def.description ?? '',
      roles: def.roles ?? [],
      inputs: def.inputs.map(portInfo),
      outputs: def.outputs.map(portInfo),
      params: paramsOf(def),
    }))
    .sort((a, b) => a.type.localeCompare(b.type));
}
