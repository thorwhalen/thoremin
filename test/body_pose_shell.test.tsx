// @vitest-environment jsdom
/**
 * The segment directions are reachable (#381; the shipping rule): from a cold load the
 * Feature Lab lists a "Segment directions" group, and checking it claims `body.dir`, which
 * is what loads the body model (`labWantsBody`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import LabPanel from '@/slices/lab/panels/LabPanel';
import { toolPanelProps } from './helpers/toolPanel';
import { useTools } from '@/app/tools/toolsStore';
// The app's hot store, which installs the controls host the Lab's state reads.
import '@/app/store';
import { defaultFeatureLab, labWantsBody } from '@/slices/lab/schema';
import { labConfig, setLab } from '@/slices/lab/app/state';
// The Lab is its slice's (#600 S16b): these run while it is listed.
import { LAB } from './helpers/extensions';

beforeEach(() => {
  useTools.setState({ open: null, independentOpen: {}, launcherOpen: false });
  if (LAB) setLab(defaultFeatureLab());
});
afterEach(cleanup);

describe.runIf(LAB)('the Segment directions group in the Feature Lab', () => {
  it('is listed once the meters start, and checking it claims body.dir and wants the body', async () => {
    useTools.setState({ open: 'lab' });
    render(<LabPanel {...toolPanelProps()} />);
    await act(async () => {
      fireEvent.click(screen.getByText(/Start measuring/i));
    });
    const box = screen.getByText('Segment directions').closest('label')!.querySelector('input')!;
    expect(box.checked).toBe(false);
    await act(async () => {
      fireEvent.click(box);
    });
    const lab = labConfig();
    expect(lab.groups).toContain('body.dir');
    expect(labWantsBody(lab)).toBe(true);
  });
});
