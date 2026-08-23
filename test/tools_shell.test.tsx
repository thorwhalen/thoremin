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
import GesturesPanel from '@/app/GesturesPanel';
import TrainerPanel from '@/app/TrainerPanel';
import { TOOLS, TOOL_IDS } from '@/app/tools';
import { STARTER_CUES } from '@/app/enroll/starterCues';
import { useTools } from '@/app/toolsStore';
import { useControls } from '@/app/store';
import { useTrainer } from '@/app/enroll/store';
import { defaultFeatureLab } from '@/features/labConfig';
import { GESTURE_IDS, GESTURE_LABELS, defaultGesturePrefs } from '@/app/gesturePrefs';
import { OVERLAY_CONTROLS, controlsForSurface } from '@/app/overlayControls';

beforeEach(() => {
  useTools.setState({ open: null });
  useControls.getState().setFeatureLab(defaultFeatureLab());
  useControls.setState({ gestures: defaultGesturePrefs() });
  useTrainer.getState().reset();
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

  it('the correlation matrix is REACHABLE from the Lab panel and writes the per-device pref (#150)', async () => {
    // The #136 rule applied to #150: a diagnostic nobody can switch on is not shipped.
    // The compute and the drawing are tested elsewhere; this is the only thing that says
    // a human can get to it.
    useTools.setState({ open: 'lab' });
    render(<LabPanel />);
    await act(async () => {
      fireEvent.click(screen.getByText(/Start measuring/i));
    });
    expect(useControls.getState().featureLab.showCorrelation).toBe(false); // opt-in

    const toggle = screen.getByLabelText(/Correlation matrix/i);
    await act(async () => {
      fireEvent.click(toggle);
    });
    // It writes the per-device tooling pref — NOT a dial, so turning a diagnostic on
    // must never mark the instrument as having unsaved edits (#136).
    expect(useControls.getState().featureLab.showCorrelation).toBe(true);
    // Its two cost knobs are exposed, not hidden: the work is quadratic, and a player who
    // turns it on deserves to see the dial that decides what it costs.
    expect(screen.getByLabelText(/Max features/i)).toBeTruthy();
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

describe('the Gestures panel is reachable and edits the binding map (#129)', () => {
  it('is closed until its tool is open', () => {
    const { container } = render(<GesturesPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('the whole chain works: shell button -> open state -> a row per known gesture with a command picker', () => {
    render(
      <>
        <ToolsBar />
        <GesturesPanel />
      </>,
    );
    expect(screen.queryByLabelText('Enable gesture commands')).toBeNull();
    fireEvent.click(screen.getByText('Gestures'));
    expect(useTools.getState().open).toBe('gestures');
    // Every gesture the classifier can emit gets a labelled row and a picker.
    for (const g of GESTURE_IDS) expect(screen.getByText(GESTURE_LABELS[g])).toBeTruthy();
    expect(screen.getAllByRole('combobox')).toHaveLength(GESTURE_IDS.length);
    // The enable toggle and BOTH timing sliders (hold + cooldown) are present.
    expect(screen.getByLabelText('Enable gesture commands')).toBeTruthy();
    expect(document.querySelectorAll('input[type="range"]')).toHaveLength(2);
    // The confirmation-gating exclusion is STATED, not silent (#129 point 8).
    expect(screen.getByText(/confirmation/i)).toBeTruthy();
  });

  it('the enable toggle writes the per-device gestures pref (not a dial, not a preset)', () => {
    useTools.setState({ open: 'gestures' });
    render(<GesturesPanel />);
    fireEvent.click(screen.getByLabelText('Enable gesture commands'));
    expect(useControls.getState().gestures.enabled).toBe(true);
  });

  it('the command picker binds and unbinds a gesture, and never offers a confirmation-gated command', () => {
    useTools.setState({ open: 'gestures' });
    render(<GesturesPanel />);
    // Rows render in GESTURE_IDS order; 'open' ships unbound.
    const openSelect = screen.getByLabelText(`Command for ${GESTURE_LABELS.open}`) as HTMLSelectElement;
    expect(openSelect.value).toBe('');
    // No instrument.* (destructive → confirmation-gated) option anywhere.
    const optionIds = [...openSelect.querySelectorAll('option')].map((o) => o.value);
    expect(optionIds.some((id) => id.startsWith('instrument.'))).toBe(false);
    // Bind it to a real per-dial command...
    fireEvent.change(openSelect, { target: { value: 'dial.master.magnetism.set' } });
    expect(useControls.getState().gestures.bindings.open?.command).toBe('dial.master.magnetism.set');
    // ...and unbind it again (the dispatcher never fires an unbound gesture).
    fireEvent.change(openSelect, { target: { value: '' } });
    expect(useControls.getState().gestures.bindings.open).toBeUndefined();
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

  it('the Feature Lab elements are homed on the lab tool, not the instrument panel', () => {
    // Both Lab elements: the meters (#119/#136) and the correlation matrix (#150), which
    // is its own element but the same tooling surface.
    expect(controlsForSurface('lab').map((d) => d.name)).toEqual(['featureLab', 'featureCorrelation']);
    for (const name of ['featureLab', 'featureCorrelation']) {
      expect(controlsForSurface('instrument').map((d) => d.name)).not.toContain(name);
    }
  });
});

describe('the Trainer is reachable and runs a routine of cues (#160, #163)', () => {
  it('is closed until its tool is open', () => {
    const { container } = render(<TrainerPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('the whole chain works: shell button -> open state -> the routine, one row per cue', () => {
    render(
      <>
        <ToolsBar />
        <TrainerPanel />
      </>,
    );
    expect(screen.queryByText('Find my categories')).toBeNull();
    fireEvent.click(screen.getByText('Trainer'));
    expect(useTools.getState().open).toBe('trainer');
    // One row per cue of the loaded routine — the routine is data, so this grows with
    // STARTER_CUES rather than being a hardcoded list here.
    const rows = screen.getByRole('list', { name: 'Routine' }).querySelectorAll('li');
    expect(rows).toHaveLength(STARTER_CUES.length);
    for (const cue of STARTER_CUES) expect(screen.getByText(cue.name)).toBeTruthy();
    expect(screen.getByText('Find my categories')).toBeTruthy();
    expect(screen.getByText('Start')).toBeTruthy();
  });

  it('Start runs the routine: the first cue\'s INSTRUCTION is shown large, and the rest are not running', () => {
    useTools.setState({ open: 'trainer' });
    render(<TrainerPanel />);
    fireEvent.click(screen.getByText('Start'));
    expect(useTrainer.getState().status).toBe('running');
    expect(useTrainer.getState().index).toBe(0);
    // The written instruction is ALWAYS shown (voice is a toggle; text is not) — large,
    // in the "Now" block (and again in the transcript, which is why it is not getByText).
    expect(document.querySelector('[data-say]')?.textContent).toBe(STARTER_CUES[0].instruction);
    // Exactly one row is marked active.
    const active = document.querySelectorAll('[data-cue][data-active]');
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute('data-cue')).toBe(STARTER_CUES[0].id);
    // Skip and Stop are offered while running; Start is not.
    expect(screen.getByText('Skip')).toBeTruthy();
    expect(screen.getByText('Stop')).toBeTruthy();
    expect(screen.queryByText('Start')).toBeNull();
    fireEvent.click(screen.getByText('Stop'));
    expect(useTrainer.getState().status).toBe('stopped');
  });

  it('Skip moves on, and the skipped cue is marked as such', () => {
    useTools.setState({ open: 'trainer' });
    render(<TrainerPanel />);
    fireEvent.click(screen.getByText('Start'));
    fireEvent.click(screen.getByText('Skip'));
    expect(useTrainer.getState().outcomes[0]).toBe('skipped');
    expect(screen.getByText('skipped')).toBeTruthy();
    fireEvent.click(screen.getByText('Stop'));
  });

  it('closing the panel mid-routine STOPS it (and releases the feature demand)', async () => {
    const { appFeatureDemand } = await import('@/app/featureDemand');
    useTools.setState({ open: 'trainer' });
    render(<TrainerPanel />);
    fireEvent.click(screen.getByText('Start'));
    expect(useTrainer.getState().status).toBe('running');
    expect(appFeatureDemand.groups()).not.toBeNull();
    // The X button only writes useTools.open; the panel itself must notice.
    fireEvent.click(screen.getByLabelText('Close the Trainer panel'));
    expect(useTools.getState().open).toBeNull();
    expect(useTrainer.getState().status).toBe('stopped');
    expect(appFeatureDemand.groups()).toBeNull();
  });

  it('cannot be trained from an empty take (the build button is disabled)', () => {
    useTools.setState({ open: 'trainer' });
    render(<TrainerPanel />);
    expect((screen.getByText('Find my categories') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a coverage METER for the running cue, not a progress bar', () => {
    useTools.setState({ open: 'trainer' });
    render(<TrainerPanel />);
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
    fireEvent.click(screen.getByText('Start'));
    const bars = screen.getAllByRole('progressbar');
    expect(bars).toHaveLength(1);
    // Nothing captured yet, so the meter reads zero — a timer-based progress bar would not.
    expect(bars[0].getAttribute('aria-valuenow')).toBe('0');
    fireEvent.click(screen.getByText('Stop'));
  });

  it('never asks the player to imitate a specific face', () => {
    useTools.setState({ open: 'trainer' });
    render(<TrainerPanel />);
    fireEvent.click(screen.getByText('Start'));
    const text = document.body.textContent ?? '';
    // The whole feature exists because prescribed categories are the ones the player
    // cannot hit. A prompt naming an emotion to produce would reintroduce that.
    for (const word of ['happy', 'sad', 'angry', 'surprised', 'disgusted', 'fearful']) {
      expect(text.toLowerCase()).not.toContain(word);
    }
    fireEvent.click(screen.getByText('Stop'));
  });
});
