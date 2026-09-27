/**
 * Tests the node-swap slots seam (issue #51): the shared mapping contract, slot
 * resolution + validation/fallback, and — the load-bearing guarantee — that a
 * contract-satisfying node swaps into the mapping slot without the engine's
 * validateEdge orphaning any of the slot's nine incoming / two outgoing edges.
 *
 * This is a developer-facing seam (no UI today; only `voice-mapping` fills the
 * slot). The stub-node tests prove the machinery so the next real mapping impl
 * is a one-line `candidates` addition.
 */
import { describe, it, expect } from 'vitest';
import { Engine, createRegistry, defineNode, type NodeRegistry } from '@/dag';
import { createAppRegistry, BROWSER_NODES } from '@/nodes/browser';
import { CORE_NODES } from '@/nodes';
import { voiceMappingNode } from '@/nodes/mapping/voice_mapping';
import {
  SLOTS,
  resolveSlot,
  defaultGraph,
  parseSlotSelection,
  slotSelectionKey,
  NO_SLOTS,
  type SlotSelection,
} from '@/app/graph';
import {
  MAPPING_SLOT_INPUTS,
  MAPPING_SLOT_OUTPUT,
  MAPPING_SLOT_CONTRACT,
} from '@/nodes/mapping/mapping_contract';

const appRegistry = (): NodeRegistry => createAppRegistry();

/** Resolve with a capturing warn so we can assert the fallback reason. */
const resolveWithWarn = (sel: SlotSelection, reg?: NodeRegistry) => {
  const warnings: string[] = [];
  const type = resolveSlot('mapping', sel, reg, (m) => warnings.push(m));
  return { type, warnings };
};

describe('mapping slot contract', () => {
  it('voice-mapping (the reference impl) satisfies its own contract', () => {
    const names = new Set(voiceMappingNode.inputs.map((p) => p.name));
    for (const required of MAPPING_SLOT_CONTRACT.requiredInputs) {
      expect(names.has(required)).toBe(true);
    }
    const out = voiceMappingNode.outputs.find((p) => p.name === MAPPING_SLOT_OUTPUT.name);
    expect(out?.kind).toBe(MAPPING_SLOT_OUTPUT.kind);
    expect(voiceMappingNode.roles).toContain('mapping');
  });

  it('the mapping slot defaults to voice-mapping with one candidate today', () => {
    expect(SLOTS.mapping.default).toBe('voice-mapping');
    expect(SLOTS.mapping.candidates).toEqual(['voice-mapping']);
  });
});

describe('resolveSlot', () => {
  it('returns the default when no selection is given', () => {
    expect(resolveSlot('mapping')).toBe('voice-mapping');
    expect(resolveSlot('mapping', {})).toBe('voice-mapping');
  });

  it('honors an explicit, valid selection', () => {
    expect(resolveSlot('mapping', { mapping: 'voice-mapping' }, appRegistry())).toBe('voice-mapping');
  });

  it('falls back + warns on an unregistered type', () => {
    const { type, warnings } = resolveWithWarn({ mapping: 'nope' }, appRegistry());
    expect(type).toBe('voice-mapping');
    expect(warnings[0]).toContain('is not a registered node type');
  });

  it('falls back + warns on a wrong-role type', () => {
    const { type, warnings } = resolveWithWarn({ mapping: 'hand-features' }, appRegistry());
    expect(type).toBe('voice-mapping');
    expect(warnings[0]).toContain('does not carry role "mapping"');
  });

  it('falls back + warns when the type lacks the slot output port', () => {
    // indirect-map IS role:mapping but emits `steer:generative-steer`, not `params`.
    const { type, warnings } = resolveWithWarn({ mapping: 'indirect-map' }, appRegistry());
    expect(type).toBe('voice-mapping');
    expect(warnings[0]).toContain('has no output port "params"');
  });

  it('falls back + warns on a wrong output kind', () => {
    const reg = appRegistry();
    reg.register(
      defineNode({
        type: 'wrong-kind-mapping',
        roles: ['mapping'],
        inputs: [...MAPPING_SLOT_INPUTS],
        outputs: [{ name: 'params', kind: 'not-synth-params' }],
        process: () => ({ params: null }),
      }),
    );
    const { type, warnings } = resolveWithWarn({ mapping: 'wrong-kind-mapping' }, reg);
    expect(type).toBe('voice-mapping');
    expect(warnings[0]).toContain('not "synth-params"');
  });

  it('falls back + warns when required input ports are missing', () => {
    const reg = appRegistry();
    reg.register(
      defineNode({
        type: 'thin-mapping',
        roles: ['mapping'],
        inputs: [{ name: 'features', kind: 'hand-features' }], // missing magnetism, face, …
        outputs: [MAPPING_SLOT_OUTPUT],
        process: () => ({ params: { voices: [] } }),
      }),
    );
    const { type, warnings } = resolveWithWarn({ mapping: 'thin-mapping' }, reg);
    expect(type).toBe('voice-mapping');
    expect(warnings[0]).toContain('missing required input ports');
    expect(warnings[0]).toContain('magnetism');
  });

  it('falls back + warns when given a selection but no registry to validate', () => {
    const { type, warnings } = resolveWithWarn({ mapping: 'voice-mapping-x' }, undefined);
    expect(type).toBe('voice-mapping');
    expect(warnings[0]).toContain('without a registry');
  });
});

describe('defaultGraph slot binding', () => {
  it('is byte-identical with no selection vs the default selection', () => {
    expect(defaultGraph()).toEqual(defaultGraph({}, appRegistry()));
    expect(defaultGraph()).toEqual(defaultGraph({ mapping: 'voice-mapping' }, appRegistry()));
  });

  it('builds a valid engine with the default mapping (regression)', () => {
    expect(() => new Engine(defaultGraph(), createAppRegistry())).not.toThrow();
  });

  it('EDGE-STABILITY: a contract-satisfying node swaps in without orphaning edges', () => {
    const reg = createRegistry([...CORE_NODES, ...BROWSER_NODES]);
    // A second mapping impl that declares exactly the shared contract.
    reg.register(
      defineNode({
        type: 'alt-mapping',
        roles: ['mapping'],
        inputs: [...MAPPING_SLOT_INPUTS],
        outputs: [MAPPING_SLOT_OUTPUT],
        process: () => ({ params: { voices: [] } }),
      }),
    );
    const spec = defaultGraph({ mapping: 'alt-mapping' }, reg);
    expect(spec.nodes.find((n) => n.id === 'map')?.type).toBe('alt-mapping');
    // The real engine validates every edge against the swapped node's ports.
    expect(() => new Engine(spec, reg)).not.toThrow();
  });

  it('a non-conforming selection falls back so the engine still builds', () => {
    const reg = createAppRegistry();
    const spec = defaultGraph({ mapping: 'indirect-map' }, reg, );
    expect(spec.nodes.find((n) => n.id === 'map')?.type).toBe('voice-mapping');
    expect(() => new Engine(spec, reg)).not.toThrow();
  });
});

describe('parseSlotSelection (the URL seam)', () => {
  it('selects nothing by default, so every slot uses its default', () => {
    expect(parseSlotSelection('')).toEqual({});
    expect(parseSlotSelection('?engine=dag&source=video&video=/a.mp4')).toEqual({});
    expect(defaultGraph(parseSlotSelection(''), appRegistry())).toEqual(defaultGraph());
  });

  it('reads ?slot.<name>=<nodeType> for each known slot', () => {
    expect(parseSlotSelection('?slot.mapping=voice-mapping')).toEqual({ mapping: 'voice-mapping' });
    expect(parseSlotSelection('slot.mapping=alt-mapping')).toEqual({ mapping: 'alt-mapping' });
  });

  it('ignores blank values and unknown slot names', () => {
    expect(parseSlotSelection('?slot.mapping=')).toEqual({});
    expect(parseSlotSelection('?slot.mapping=%20%20')).toEqual({});
    expect(parseSlotSelection('?slot.nonesuch=whatever')).toEqual({});
  });

  it('leaves validation to resolveSlot, which warns and falls back', () => {
    const warnings: string[] = [];
    const sel = parseSlotSelection('?slot.mapping=not-a-node');
    expect(sel).toEqual({ mapping: 'not-a-node' }); // parsed, not judged
    expect(resolveSlot('mapping', sel, appRegistry(), (m) => warnings.push(m))).toBe('voice-mapping');
    expect(warnings[0]).toContain('is not a registered node type');
  });

  it('coexists with the other URL params (?source=video, ?engine=)', () => {
    expect(parseSlotSelection('?engine=dag&slot.mapping=voice-mapping&source=video&video=/c.mp4')).toEqual({
      mapping: 'voice-mapping',
    });
  });
});

describe('slotSelectionKey (the React effect identity)', () => {
  it('is stable for equal selections and distinct for different ones', () => {
    expect(slotSelectionKey({ mapping: 'a' })).toBe(slotSelectionKey({ mapping: 'a' }));
    expect(slotSelectionKey({ mapping: 'a' })).not.toBe(slotSelectionKey({ mapping: 'b' }));
    expect(slotSelectionKey({})).toBe(slotSelectionKey(NO_SLOTS));
    expect(slotSelectionKey()).toBe(slotSelectionKey({}));
  });

  it('covers every slot, so adding one cannot silently stop triggering re-wires', () => {
    for (const name of Object.keys(SLOTS)) expect(slotSelectionKey({})).toContain(`${name}=`);
  });

  it('does not depend on object identity (a fresh literal each render is fine)', () => {
    const renders = [{ mapping: 'x' }, { mapping: 'x' }, { mapping: 'x' }];
    expect(new Set(renders.map(slotSelectionKey)).size).toBe(1);
  });
});
