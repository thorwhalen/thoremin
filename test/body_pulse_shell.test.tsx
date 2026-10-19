// @vitest-environment jsdom
/**
 * The dancer's pulse is reachable (#186 PR F; the shipping rule): from a cold load the
 * Feature Lab lists a "Body pulse" group, checking it claims `body.rhythm`, and that
 * claim composes the body branch with the pulse in it (`test/body_pulse.test.ts`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import LabPanel from '@/slices/lab/panels/LabPanel';
import { useTools } from '@/app/toolsStore';
// The app's hot store, which installs the controls host the Lab's state reads.
import '@/app/store';
import { defaultFeatureLab } from '@/slices/lab/schema';
import { labConfig, setLab } from '@/slices/lab/app/state';
// The Lab is its slice's (#600 S16b): these run while it is listed.
import { LAB } from './helpers/extensions';

beforeEach(() => {
  useTools.setState({ open: null, independentOpen: {}, launcherOpen: false });
  if (LAB) setLab(defaultFeatureLab());
});
afterEach(cleanup);

describe.runIf(LAB)('the Body pulse group in the Feature Lab', () => {
  it('is listed once the meters start, and checking it claims body.rhythm', async () => {
    useTools.setState({ open: 'lab' });
    render(<LabPanel close={() => undefined} />);
    await act(async () => {
      fireEvent.click(screen.getByText(/Start measuring/i));
    });
    const box = screen.getByText('Body pulse').closest('label')!.querySelector('input')!;
    expect(box.checked).toBe(false);
    await act(async () => {
      fireEvent.click(box);
    });
    expect(labConfig().groups).toContain('body.rhythm');
  });
});
