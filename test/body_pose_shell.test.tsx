// @vitest-environment jsdom
/**
 * The segment directions are reachable (#381; the shipping rule): from a cold load the
 * Feature Lab lists a "Segment directions" group, and checking it claims `body.dir`, which
 * is what loads the body model (`labWantsBody`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import LabPanel from '@/app/LabPanel';
import { useTools } from '@/app/toolsStore';
import { useControls } from '@/app/store';
import { defaultFeatureLab, labWantsBody } from '@/features/labConfig';

beforeEach(() => {
  useTools.setState({ open: null, independentOpen: {}, launcherOpen: false });
  useControls.getState().setFeatureLab(defaultFeatureLab());
});
afterEach(cleanup);

describe('the Segment directions group in the Feature Lab', () => {
  it('is listed once the meters start, and checking it claims body.dir and wants the body', async () => {
    useTools.setState({ open: 'lab' });
    render(<LabPanel />);
    await act(async () => {
      fireEvent.click(screen.getByText(/Start measuring/i));
    });
    const box = screen.getByText('Segment directions').closest('label')!.querySelector('input')!;
    expect(box.checked).toBe(false);
    await act(async () => {
      fireEvent.click(box);
    });
    const lab = useControls.getState().featureLab;
    expect(lab.groups).toContain('body.dir');
    expect(labWantsBody(lab)).toBe(true);
  });
});
