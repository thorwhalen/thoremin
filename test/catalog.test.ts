/**
 * Tests the catalog generator: it introspects the node registry into accurate,
 * serializable node descriptions (ports + params), which the user-facing manual
 * is generated from. Guards that the manual can't drift from the code.
 */
import { describe, it, expect } from 'vitest';
import { buildCatalog } from '@/catalog';
import { createCoreRegistry } from '@/nodes';

const catalog = buildCatalog(createCoreRegistry());
const byType = Object.fromEntries(catalog.map((e) => [e.type, e]));

describe('buildCatalog', () => {
  it('covers every registered node with title + description', () => {
    expect(catalog.length).toBe(createCoreRegistry().list().length);
    expect(catalog.every((e) => e.title.length > 0 && e.description.length > 0)).toBe(true);
    // a few expected members
    for (const t of ['voice-mapping', 'chord', 'progression', 'face-features', 'gesture-classifier', 'transport']) {
      expect(byType[t]).toBeTruthy();
    }
  });

  it('captures ports with names/kinds/descriptions', () => {
    const vm = byType['voice-mapping'];
    expect(vm.inputs.map((p) => p.name)).toContain('features');
    expect(vm.outputs.map((p) => p.name)).toContain('params');
    const ind = byType['indirect-map'];
    expect(ind.inputs.map((p) => p.name)).toEqual(expect.arrayContaining(['features', 'face']));
  });

  it('extracts params with types + defaults (incl. refined schemas)', () => {
    // chord: plain ZodObject with defaults
    const chord = byType['chord'];
    const baseOctave = chord.params.find((p) => p.name === 'baseOctave');
    expect(baseOctave).toMatchObject({ type: 'number', default: 4 });

    // hand-features: a refined (ZodEffects) schema — unwrap must still find params
    const hf = byType['hand-features'];
    const names = hf.params.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['mirrorX', 'opennessMin', 'pinchApart']));
    expect(hf.params.find((p) => p.name === 'opennessMin')).toMatchObject({ type: 'number', default: 1.3 });

    // voice-mapping has nested ZodObject params (right/left) — introspection
    // must surface every top-level param name, not silently drop them.
    const vm = byType['voice-mapping'];
    expect(vm.params.map((p) => p.name)).toEqual(
      expect.arrayContaining(['magnetism', 'maxGain', 'opennessGatesGain', 'right', 'left']),
    );
  });

  it('is JSON-serializable (for the frontend manual)', () => {
    expect(() => JSON.stringify(catalog)).not.toThrow();
  });

  it('introspects the FULL app registry (incl. browser nodes) without dropping or throwing', async () => {
    // Resilience: buildCatalog must never throw on any registered node's schema,
    // and must cover every node — guards the try/catch fallback in paramsOf from
    // silently hiding a broken introspection path.
    const { createAppRegistry } = await import('@/nodes/browser');
    const appReg = createAppRegistry();
    const full = buildCatalog(appReg);
    expect(full.length).toBe(appReg.list().length);
    expect(full.every((e) => e.title.length > 0 && e.description.length > 0)).toBe(true);
    // every entry has well-formed (array) port/param lists
    expect(full.every((e) => Array.isArray(e.inputs) && Array.isArray(e.outputs) && Array.isArray(e.params))).toBe(true);
  });
});
