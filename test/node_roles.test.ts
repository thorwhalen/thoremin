/**
 * Tests the advisory node-role taxonomy (issue #47): every node carries role(s),
 * `registry.listByRole` filters by them (a node may appear under several), and
 * the catalog surfaces them for the manual. Roles are descriptive metadata and
 * never gate engine execution, so these are pure, headless checks.
 */
import { describe, it, expect } from 'vitest';
import type { Role } from '@/dag';
import { createAppRegistry } from '@/nodes/browser';
import { buildCatalog } from '@/catalog';

const reg = createAppRegistry();
const typesWithRole = (role: Role): string[] =>
  reg
    .listByRole(role)
    .map((d) => d.type)
    .sort();

describe('node roles', () => {
  it('every registered node carries at least one role', () => {
    const untagged = reg
      .list()
      .filter((d) => !d.roles || d.roles.length === 0)
      .map((d) => d.type);
    expect(untagged).toEqual([]);
  });

  it('listByRole filters by advisory role', () => {
    // generate is a rare modifier — only the AI engine carries it.
    expect(typesWithRole('generate')).toEqual(['lyria']);
    // synth includes both the deterministic synth and the generative one.
    expect(typesWithRole('synth')).toEqual(expect.arrayContaining(['webaudio-synth', 'lyria']));
    expect(typesWithRole('source')).toEqual(
      expect.arrayContaining(['webcam-hands', 'webcam-face', 'keyboard-source', 'store-controls']),
    );
    expect(typesWithRole('overlay')).toEqual(['canvas-overlay']);
  });

  it('a multi-role node appears under each of its roles', () => {
    // store-controls is both a source and a control modifier.
    expect(typesWithRole('source')).toContain('store-controls');
    expect(typesWithRole('control')).toContain('store-controls');
  });

  it('surfaces roles in the catalog (docs/onboarding)', () => {
    const byType = Object.fromEntries(buildCatalog(reg).map((e) => [e.type, e]));
    expect(byType['lyria'].roles).toEqual(['synth', 'generate']);
    expect(byType['canvas-overlay'].roles).toEqual(['overlay']);
    expect(byType['voice-mapping'].roles).toEqual(['mapping']);
  });
});
