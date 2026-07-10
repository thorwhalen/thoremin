/**
 * The confirmation gate (#87 Phase 3) — human-in-the-loop for destructive commands.
 * Tests the middleware in isolation (a fake `next`, so no dependence on the instrument
 * handlers) plus that `installConfirmationGate` actually wraps a registry's dispatch.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createThoreminRegistry,
  installConfirmationGate,
  confirmationGate,
  createApprovalStore,
  defaultGetRisk,
} from '@/app/commands';

/** Read a Result's error branch structurally (the loose whole-project tsc won't narrow
 *  a `Result` union across `if (!r.ok)`). */
const errOf = (r: { ok: boolean }) => (r as unknown as { error: { code: string; message: string; details?: unknown } }).error;

describe('confirmation gate (#87 Phase 3)', () => {
  it('classifies instrument mutations as destructive, dial edits as reversible', () => {
    expect(defaultGetRisk('instrument.save').sideEffect).toBe('destructive');
    expect(defaultGetRisk('instrument.load').sideEffect).toBe('destructive');
    expect(defaultGetRisk('instrument.create').sideEffect).toBe('destructive');
    expect(defaultGetRisk('dial.set').sideEffect).toBe('additive');
    expect(defaultGetRisk('dial.reset').sideEffect).toBe('additive');
    expect(defaultGetRisk('mode.toggle').sideEffect).toBe('query');
  });

  it('gates a destructive assistant call until a matching one-use token is presented', async () => {
    const approvals = createApprovalStore();
    const next = vi.fn(async () => ({ ok: true, value: 'ran' }));
    const gated = confirmationGate(defaultGetRisk, approvals)(next as never);

    // Assistant proposes a destructive command with no token → proposal, next NOT called.
    const proposal = await gated('instrument.save', { name: 'X' }, { channel: 'assistant' });
    expect(proposal.ok).toBe(false);
    expect(errOf(proposal).code).toBe('confirmation_required');
    expect((errOf(proposal).details as { command?: string }).command).toBe('instrument.save');
    expect(next).not.toHaveBeenCalled();

    // A human approves → token → the exact call passes through to next.
    const token = approvals.approve('instrument.save', { name: 'X' });
    const run = await gated('instrument.save', { name: 'X' }, { channel: 'assistant', approvedToken: token });
    expect(run.ok).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);

    // The token is one-use: a replay is gated again.
    const replay = await gated('instrument.save', { name: 'X' }, { channel: 'assistant', approvedToken: token });
    expect(replay.ok).toBe(false);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('a token is bound to the exact params (cannot be replayed against different args)', async () => {
    const approvals = createApprovalStore();
    const next = vi.fn(async () => ({ ok: true, value: 'ran' }));
    const gated = confirmationGate(defaultGetRisk, approvals)(next as never);
    const token = approvals.approve('instrument.save', { name: 'A' });
    const mismatched = await gated('instrument.save', { name: 'B' }, { channel: 'assistant', approvedToken: token });
    expect(mismatched.ok).toBe(false);
    expect(next).not.toHaveBeenCalled();
  });

  it('never gates a human surface, nor reversible commands even on the assistant channel', async () => {
    const approvals = createApprovalStore();
    const next = vi.fn(async () => ({ ok: true, value: 'ran' }));
    const gated = confirmationGate(defaultGetRisk, approvals)(next as never);
    // Human dispatch (no assistant channel) → ungated even for a destructive command.
    expect((await gated('instrument.save', { name: 'X' })).ok).toBe(true);
    // Reversible command on the assistant channel → ungated.
    expect((await gated('dial.set', { key: 'x', value: 1 }, { channel: 'assistant' })).ok).toBe(true);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('installConfirmationGate wraps a registry\'s dispatch', async () => {
    const reg = createThoreminRegistry(); // a raw (ungated) registry for isolation
    // Mark a harmless, headless-safe command destructive so we don't lean on instrument handlers.
    installConfirmationGate(reg, {
      getRisk: (id) => ({ sideEffect: id === 'dial.reset' ? 'destructive' : 'query' }),
    });
    const proposal = await reg.dispatch('dial.reset', { key: 'right.baseOctave' }, { channel: 'assistant' });
    expect(proposal.ok).toBe(false);
    expect(errOf(proposal).code).toBe('confirmation_required');
    // The same command from a human surface runs ungated.
    const human = await reg.dispatch('dial.reset', { key: 'right.baseOctave' });
    expect(human.ok).toBe(true);
  });
});
