// @vitest-environment jsdom
/**
 * The shell-reachability tests (#136) — the tests that did not exist when the Feature
 * Lab shipped to production unreachable behind 759 green ones.
 *
 * The old invariant (`test/overlay_elements.test.ts`) asserted every overlay element has
 * a control DESCRIPTOR, and it passed the whole time the Lab was unfindable: a
 * descriptor proves an element is *controllable*, not that a player can *find* the
 * control. These tests assert the missing half — that every registered tool has a
 * labelled button in the shell, and that pressing it actually opens the thing.
 *
 * This is the only jsdom test file in the repo; the rest of the suite is pure-TS DAG
 * work that has no DOM. See the `test` block in vite.config.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import ToolsBar from '@/app/ToolsBar';
import LabPanel from '@/app/LabPanel';
import { TOOLS, TOOL_IDS } from '@/app/tools';
import { useTools } from '@/app/toolsStore';
import { useControls } from '@/app/store';
import { defaultFeatureLab } from '@/features/labConfig';
import { OVERLAY_CONTROLS, controlsForSurface } from '@/app/overlayControls';

beforeEach(() => {
  useTools.setState({ open: null });
  useControls.getState().setFeatureLab(defaultFeatureLab());
});
afterEach(cleanup);

describe('the tools bar is the shell entry point for every tool', () => {
  it('renders one button per registered tool, each with a VISIBLE text label', () => {
    render(<ToolsBar />);
    for (const tool of TOOLS) {
      // getByText, not getByLabelText: an icon with only an aria-label is how the
      // command palette stayed invisible. If a player cannot read it, it is not an
      // entry point.
      expect(screen.getByText(tool.label)).toBeTruthy();
    }
    expect(document.querySelectorAll('[data-tool]')).toHaveLength(TOOLS.length);
  });

  it('shows the command palette hotkey, so ⌘K is discoverable without reading the source', () => {
    render(<ToolsBar />);
    expect(screen.getByText('⌘K')).toBeTruthy();
  });

  it('clicking a panel tool opens it (the button is wired, not decorative)', () => {
    render(<ToolsBar />);
    fireEvent.click(screen.getByText('Feature Lab'));
    expect(useTools.getState().open).toBe('lab');
    fireEvent.click(screen.getByText('Feature Lab'));
    expect(useTools.getState().open).toBe(null); // and it toggles back closed
  });

  it('at most one tool is open at a time', () => {
    render(<ToolsBar />);
    fireEvent.click(screen.getByText('Feature Lab'));
    fireEvent.click(screen.getByText('Commands'));
    expect(useTools.getState().open).toBe('commands');
  });
});

describe('the Feature Lab is reachable and explains itself', () => {
  it('is closed until its tool is open', () => {
    const { container } = render(<LabPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('opens on an INTRO state that says what the meters measure', () => {
    useTools.setState({ open: 'lab' });
    render(<LabPanel />);
    // The empty state is the deliverable: "248 normalized meters" means nothing to
    // someone who has not read the design doc.
    expect(screen.getByText(/raw features/i)).toBeTruthy();
    expect(screen.getByText(/normalized online/i)).toBeTruthy();
    expect(screen.getByText(/Start measuring/i)).toBeTruthy();
  });

  it('starting the meters from the intro turns them on and reveals the controls', async () => {
    useTools.setState({ open: 'lab' });
    render(<LabPanel />);
    // `act` so the saved-views store's async list() settles inside the test rather than
    // after it (React would otherwise warn about an update outside act).
    await act(async () => {
      fireEvent.click(screen.getByText(/Start measuring/i));
    });
    expect(useControls.getState().featureLab.show).toBe(true);
    expect(screen.getByText(/Show the meters over the video/i)).toBeTruthy();
  });

  it('the whole chain works: shell button -> open state -> panel renders', () => {
    render(
      <>
        <ToolsBar />
        <LabPanel />
      </>,
    );
    expect(screen.queryByText(/Start measuring/i)).toBeNull();
    fireEvent.click(screen.getByText('Feature Lab'));
    expect(screen.getByText(/Start measuring/i)).toBeTruthy();
  });
});

describe('every control surface has a home in the shell', () => {
  it('each overlay element whose home is not the instrument names a REGISTERED tool', () => {
    // The generalized rule. An element may live somewhere other than the instrument
    // panel — but "somewhere" has to be a surface the shell actually offers, or we have
    // rebuilt the #136 bug with a different element.
    for (const d of OVERLAY_CONTROLS) {
      const surface = d.surface ?? 'instrument';
      if (surface === 'instrument') continue;
      expect(TOOL_IDS).toContain(surface);
    }
  });

  it('the Feature Lab element is homed on the lab tool, not the instrument panel', () => {
    expect(controlsForSurface('lab').map((d) => d.name)).toEqual(['featureLab']);
    expect(controlsForSurface('instrument').map((d) => d.name)).not.toContain('featureLab');
  });
});
