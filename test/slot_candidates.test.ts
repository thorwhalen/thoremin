/**
 * Slot candidates as a contribution (#600 S17): the shell declares the slots and their contracts;
 * an extension adds node types that can fill one, and at most one extension gives a slot its
 * default. A slot the shell does not declare, a type listed twice, a default that is not the
 * extension's own candidate, or two defaults are refused at fold time, naming who.
 */
import { describe, expect, it } from 'vitest';
import { slotCandidatesOf } from '@/host/contributions';
import { SLOTS, withSlotCandidates } from '@/app/graph';
import type { Extension } from '@thoremin/sdk/instruments/extension';

const ext = (id: string, slotCandidates: Extension['slotCandidates']): Extension => ({ id, branches: [], dials: [], derive: () => [], slotCandidates }) as unknown as Extension;

describe('slot candidates', () => {
  it('fold per slot: types in order, the one default', () => {
    expect(slotCandidatesOf([ext('a', [{ slot: 'body', types: ['a-cam', 'a-fake'], default: 'a-cam' }]), ext('b', [{ slot: 'body', types: ['b-replay'] }])])).toEqual({
      body: { types: ['a-cam', 'a-fake', 'b-replay'], default: 'a-cam' },
    });
  });

  it('refuse a type twice, a default not among its own types, and two defaults', () => {
    expect(() => slotCandidatesOf([ext('a', [{ slot: 'body', types: ['x'] }]), ext('b', [{ slot: 'body', types: ['x'] }])])).toThrow(/twice/);
    expect(() => slotCandidatesOf([ext('a', [{ slot: 'body', types: ['x'], default: 'y' }])])).toThrow(/not one of its own/);
    expect(() => slotCandidatesOf([ext('a', [{ slot: 'body', types: ['x'], default: 'x' }]), ext('b', [{ slot: 'body', types: ['y'], default: 'y' }])])).toThrow(/"a" and "b" both/);
  });

  it('join the shell\'s slots; a slot the shell does not declare, or a second default, is refused', () => {
    const core = { body: { ...SLOTS.body, default: '', candidates: [] }, source: SLOTS.source };
    const slots = withSlotCandidates(core, { body: { types: ['a-cam', 'a-fake'], default: 'a-cam' } });
    expect(slots.body.candidates).toEqual(['a-cam', 'a-fake']);
    expect(slots.body.default).toBe('a-cam');
    expect(slots.body.contract).toBe(SLOTS.body.contract);
    expect(() => withSlotCandidates(core, { elbow: { types: ['x'] } })).toThrow(/no slot "elbow"/);
    expect(() => withSlotCandidates(core, { source: { types: ['x'], default: 'x' } })).toThrow(/already has core's default/);
  });
});
