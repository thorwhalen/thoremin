// @vitest-environment jsdom
/**
 * The hand model's state reaches the shell (#922): the hand source's `status` port, mirrored into a
 * store when it changes (`makeHandsReporter`), is shown in the camera status column, so a player
 * with the overlay hidden still learns that the hands are loading or stopped. Nothing is shown while
 * the hands are ready or tracked.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import TimingChip from '@/app/timing/TimingChip';
import { handsNote, makeHandsReporter, useHandsStatus } from '@/app/hands/handsStatus';
import { HANDS_STATUS } from '@/nodes/sources/webcam_hands';
import { TRUNK } from '@thoremin/sdk/instruments/trunk';

afterEach(() => {
  cleanup();
  useHandsStatus.getState().reset();
});

/** An engine whose hand source says `status`. */
const engineSaying = (status: unknown) => ({ getOutput: (node: string, port: string) => (node === TRUNK.cam && port === 'status' ? status : undefined) });

describe('the hands\' status in the shell (#922)', () => {
  it('shows a failed hand model in the camera status column, with no timing reading and no overlay', () => {
    const view = render(<TimingChip />);
    expect(view.container.querySelector('[data-hands-status]')).toBeNull();
    act(() => makeHandsReporter(engineSaying(HANDS_STATUS.failed))());
    const pill = view.container.querySelector('[data-hands-status]');
    expect(pill?.textContent).toBe(`Hands: ${HANDS_STATUS.failed.message}`);
    expect(pill?.className).toMatch(/rose/);
  });

  it('says loading while the model loads, and nothing once the hands are ready or tracked', () => {
    const view = render(<TimingChip />);
    act(() => makeHandsReporter(engineSaying(HANDS_STATUS.loading))());
    expect(view.container.querySelector('[data-hands-status]')?.textContent).toBe('Hands: Loading the hand model');
    act(() => makeHandsReporter(engineSaying(HANDS_STATUS.ready))());
    expect(view.container.querySelector('[data-hands-status]')).toBeNull();
    expect(handsNote(HANDS_STATUS.active)).toBeNull();
    expect(handsNote(null)).toBeNull();
  });

  it('the reporter writes the store only when the status changes', () => {
    let writes = 0;
    const report = makeHandsReporter(engineSaying(HANDS_STATUS.ready), { report: () => void (writes += 1) });
    report();
    report();
    expect(writes).toBe(1);
  });
});
