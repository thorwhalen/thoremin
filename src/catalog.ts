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
import type { NodeDef, PortSpec } from '@/dag';

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
const TYPE_NAMES: Record<string, string> = {
  ZodNumber: 'number',
  ZodString: 'string',
  ZodBoolean: 'boolean',
  ZodArray: 'array',
  ZodObject: 'object',
  ZodAny: 'any',
  ZodUnknown: 'unknown',
};

/** Unwrap wrapper Zod types (effects/optional/default/nullable) to the inner ZodObject. */
function unwrapToObject(schema: any): any | null {
  let s = schema;
  for (let i = 0; i < 6 && s && s._def; i++) {
    const tn = s._def.typeName;
    if (tn === 'ZodObject') return s;
    if (tn === 'ZodEffects') s = s._def.schema;
    else if (tn === 'ZodDefault' || tn === 'ZodOptional' || tn === 'ZodNullable') s = s._def.innerType;
    else break;
  }
  return s && s._def && s._def.typeName === 'ZodObject' ? s : null;
}

function paramInfo(name: string, field: any): ParamInfo {
  let f = field;
  let def: unknown;
  for (let i = 0; i < 6 && f && f._def; i++) {
    const tn = f._def.typeName;
    if (tn === 'ZodDefault') {
      try {
        def = f._def.defaultValue();
      } catch {
        /* ignore */
      }
      f = f._def.innerType;
    } else if (tn === 'ZodOptional' || tn === 'ZodNullable') {
      f = f._def.innerType;
    } else {
      break;
    }
  }
  const tn = f && f._def ? f._def.typeName : 'unknown';
  let type = TYPE_NAMES[tn] ?? String(tn).replace(/^Zod/, '').toLowerCase();
  if (tn === 'ZodEnum') {
    const values = (f._def.values as string[]) ?? [];
    type = `enum(${values.join(' | ')})`;
  }
  return { name, type, default: def };
}

function paramsOf(def: NodeDef): ParamInfo[] {
  try {
    const obj = unwrapToObject(def.params as any);
    if (!obj) return [];
    const shape = typeof obj._def.shape === 'function' ? obj._def.shape() : obj.shape;
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
      inputs: def.inputs.map(portInfo),
      outputs: def.outputs.map(portInfo),
      params: paramsOf(def),
    }))
    .sort((a, b) => a.type.localeCompare(b.type));
}
