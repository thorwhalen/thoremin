/**
 * Entry points into a tool from another tool's panel (#465): an extension declares them as data,
 * the host folds them, and the Conductor panel lists what its build ships instead of naming the
 * faces extension's tool and modality by literal.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ToolEntryPointDecl } from '@thoremin/sdk-ui/tools';
import { entryPointsFrom } from '@/app/entryPoints';
import { EXTENSION_ENTRY_POINTS } from '@/app/extensions';
import { shellToolById } from '@/app/shellTools';
import { FACES } from './helpers/extensions';

// `lab`: a core tool, in every build (the song's tool, the example before, is its slice's since #600 S15).
const entry = (over: Partial<ToolEntryPointDecl> = {}): ToolEntryPointDecl => ({ id: 'e', from: 'conductor', tool: 'lab', label: 'Go', ...over });

describe('entryPointsFrom', () => {
  it('lists the entry points of one host tool whose tool is in the shell', () => {
    const all = [entry({ id: 'a' }), entry({ id: 'b', from: 'trainer' }), entry({ id: 'c', tool: 'no-such-tool' })];
    expect(entryPointsFrom('conductor', {}, all).map((e) => e.id)).toEqual(['a']);
  });

  it('shows one only while every key of `when` equals the panel context', () => {
    const all = [entry({ when: { 'conductor.source': 'body' } })];
    expect(entryPointsFrom('conductor', { 'conductor.source': 'hands' }, all)).toEqual([]);
    expect(entryPointsFrom('conductor', { 'conductor.source': 'body' }, all)).toHaveLength(1);
  });
});

describe.runIf(FACES)('the faces extension contributes the Conductor to Your poses', () => {
  it('declares it, and its tool is in the shell', () => {
    const e = EXTENSION_ENTRY_POINTS.find((x) => x.id === 'conductor-poses');
    expect(e).toMatchObject({ from: 'conductor', tool: 'poses', carve: { modality: 'body', vocabulary: 'conductor' } });
    expect(shellToolById(e!.tool)).toBeDefined();
  });
});

describe('the core Conductor panel', () => {
  it('names no extension tool or carve modality', () => {
    const src = readFileSync('src/app/ConductorPanel.tsx', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/['"]poses['"]/);
    expect(src).not.toMatch(/requestCarve/);
  });
});
