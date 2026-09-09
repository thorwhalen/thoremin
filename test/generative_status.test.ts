/**
 * The generative status bridge (#188): the per-frame sink reads the `lyria` node's
 * `status` output and reports it to the React mirror only when something changed —
 * so the settings panel never re-renders 60×/s for an unchanged phase, and a
 * teardown resets to the absent status.
 */
import { describe, it, expect } from 'vitest';
import { makeGenerativeReporter, useGenerativeStatus, ABSENT_GENERATIVE_STATUS, GENERATIVE_NODE_ID } from '@/app/generativeStatus';
import type { LoadStatus } from '@/lazy';

describe('makeGenerativeReporter', () => {
  it('reports on change only, keyed by phase / reason / message / progress', () => {
    let current: LoadStatus | undefined = undefined;
    const reports: LoadStatus[] = [];
    const reader = { getOutput: (id: string, port: string) => (id === GENERATIVE_NODE_ID && port === 'status' ? current : undefined) };
    const report = makeGenerativeReporter(reader, { report: (s) => reports.push(s) });
    report(); // nothing emitted yet → nothing reported
    expect(reports).toHaveLength(0);
    current = { phase: 'loading', message: 'Loading' };
    report();
    report();
    report();
    expect(reports).toHaveLength(1);
    current = { phase: 'loading', message: 'Loading', progress: 0.5 };
    report();
    expect(reports).toHaveLength(2);
    current = { phase: 'unavailable', reason: 'no-key', message: 'Add a key' };
    report();
    expect(reports).toHaveLength(3);
    expect(reports[2].reason).toBe('no-key');
  });

  it('the store mirror starts absent and resets', () => {
    expect(useGenerativeStatus.getState().status).toEqual(ABSENT_GENERATIVE_STATUS);
    useGenerativeStatus.getState().report({ phase: 'active', message: 'Playing' });
    expect(useGenerativeStatus.getState().status.phase).toBe('active');
    useGenerativeStatus.getState().reset();
    expect(useGenerativeStatus.getState().status).toEqual(ABSENT_GENERATIVE_STATUS);
  });
});
