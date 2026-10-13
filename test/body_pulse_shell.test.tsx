// @vitest-environment jsdom
/**
 * The dancer's pulse is reachable (#186 PR F; the shipping rule): from a cold load the
 * Feature Lab lists a "Body pulse" group, checking it claims `body.rhythm`, and that
 * claim composes the body branch with the pulse in it (`test/body_pulse.test.ts`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import LabPanel from '@/app/LabPanel';
import { useTools } from '@/app/toolsStore';
import { useControls } from '@/app/store';
import { defaultFeatureLab } from '@/features/labConfig';

beforeEach(() => {
  useTools.setState({ open: null, independentOpen: {}, launcherOpen: false });
  useControls.getState().setFeatureLab(defaultFeatureLab());
});
afterEach(cleanup);

describe('the Body pulse group in the Feature Lab', () => {
  it('is listed once the meters start, and checking it claims body.rhythm', async () => {
    useTools.setState({ open: 'lab' });
    render(<LabPanel />);
    await act(async () => {
      fireEvent.click(screen.getByText(/Start measuring/i));
    });
    const box = screen.getByText('Body pulse').closest('label')!.querySelector('input')!;
    expect(box.checked).toBe(false);
    await act(async () => {
      fireEvent.click(box);
    });
    expect(useControls.getState().featureLab.groups).toContain('body.rhythm');
  });
});
