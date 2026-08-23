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
    const list = screen.getByRole('list', { name: 'Routine' });
    const rows = list.querySelectorAll('li');
    expect(rows).toHaveLength(STARTER_CUES.length);
    // (Names also appear in the picker beneath, so look inside the routine list.)
    for (const cue of STARTER_CUES) expect(list.textContent).toContain(cue.name);
    expect(screen.getByText('Find my categories')).toBeTruthy();
    expect(screen.getByText('Start')).toBeTruthy();
  });

  it('Start runs the routine: the first cue\'s INSTRUCTION is shown large, and the rest are not running', () => {
    useTools.setState({ open: 'trainer' });
    render(<TrainerPanel />);
    fireEvent.click(screen.getByText('Start'));
    expect(useTrainer.getState().status).toBe('running');
    expect(useTrainer.getState().index).toBe(0);
    // While running the panel collapses to a slim strip (the instruction is on the
    // video; a full panel would cover it) — and the written instruction is STILL in
    // the strip (voice is a toggle; text is not), with the cue's name and position.
    expect(document.querySelector('[data-compact]')).toBeTruthy();
    expect(document.querySelector('[data-say]')?.textContent).toBe(STARTER_CUES[0].instruction);
    expect(document.body.textContent).toContain(`1/${STARTER_CUES.length}`);
    expect(document.body.textContent).toContain(STARTER_CUES[0].name);
    // Skip and Stop are offered while running; Start and the picker are not.
    expect(screen.getByText('Skip')).toBeTruthy();
    expect(screen.getByText('Stop')).toBeTruthy();
    expect(screen.queryByText('Start')).toBeNull();
    expect(document.querySelector('[data-routine-picker]')).toBeNull();
    fireEvent.click(screen.getByText('Stop'));
    expect(useTrainer.getState().status).toBe('stopped');
    // The full panel is back, with the stopped cue marked.
    expect(document.querySelector('[data-compact]')).toBeNull();
    expect(document.querySelectorAll('[data-cue]')).toHaveLength(STARTER_CUES.length);
  });

  it('Skip moves on, and the skipped cue is marked as such (visible once the full panel is back)', () => {
    useTools.setState({ open: 'trainer' });
    render(<TrainerPanel />);
    fireEvent.click(screen.getByText('Start'));
    fireEvent.click(screen.getByText('Skip'));
    expect(useTrainer.getState().outcomes[0]).toBe('skipped');
    // The strip now names the NEXT cue.
    expect(document.body.textContent).toContain(STARTER_CUES[1].name);
    fireEvent.click(screen.getByText('Stop'));
    expect(screen.getAllByText('skipped').length).toBeGreaterThanOrEqual(1);
  });

  it('the HUD pref is a per-device checkbox in the panel, not an instrument dial', () => {
    useTools.setState({ open: 'trainer' });
    render(<TrainerPanel />);
    const box = screen.getByLabelText(/instructions on the video/i) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(useControls.getState().trainerHud.show).toBe(false);
    fireEvent.click(box);
    expect(useControls.getState().trainerHud.show).toBe(true);
  });

  it('closing the panel mid-routine STOPS it (and releases the feature demand)', async () => {
    const { appFeatureDemand } = await import('@/app/featureDemand');
    useTools.setState({ open: 'trainer' });
    render(<TrainerPanel />);
    fireEvent.click(screen.getByText('Start'));
    expect(useTrainer.getState().status).toBe('running');
    expect(appFeatureDemand.groups()).not.toBeNull();
    // Closing the tool (the bar, another tool, the hotkey) only writes useTools.open;
    // the panel itself must notice. (The running strip has no X: Stop is the way out.)
    act(() => useTools.getState().close());
    expect(useTools.getState().open).toBeNull();
    expect(useTrainer.getState().status).toBe('stopped');
    expect(appFeatureDemand.groups()).toBeNull();
  });

  it('the routine picker (#163 §3): filter narrows the list, a toggle changes the draft, Use applies it', () => {
    useTools.setState({ open: 'trainer' });
    render(<TrainerPanel />);
    // Idle: the picker is offered (collapsed); while running it is not.
    const picker = document.querySelector('[data-routine-picker]');
    expect(picker).toBeTruthy();
    const rows = () => document.querySelectorAll('[data-picker-cue]');
    expect(rows()).toHaveLength(STARTER_CUES.length);
    // Free-text filter narrows it...
    fireEvent.change(screen.getByLabelText('Filter cues'), { target: { value: 'tilt' } });
    expect(rows()).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Filter cues'), { target: { value: '' } });
    // ...and a tag chip is all-of.
    fireEvent.click(screen.getByRole('button', { name: 'setup' }));
    expect(rows().length).toBeLessThan(STARTER_CUES.length);
    fireEvent.click(screen.getByRole('button', { name: 'setup' }));
    // With a filter on, a reorder moves past the VISIBLE neighbour only, and changes
    // what the player sees (not a hidden row behind it).
    fireEvent.change(screen.getByLabelText('Filter cues'), { target: { value: 'look' } });
    fireEvent.click(screen.getByLabelText('Move Look right up'));
    const order = [...document.querySelectorAll('[data-picker-cue]')].map((el) => el.getAttribute('data-picker-cue'));
    // ("Rest" also matches 'look' — "Look at the camera" — and stays first.)
    expect(order.indexOf('look-right')).toBeLessThan(order.indexOf('look-left'));
    expect(order[0]).toBe('rest');
    fireEvent.change(screen.getByLabelText('Filter cues'), { target: { value: '' } });
    // Un-include the first tilt and Use: the routine shrinks by one.
    fireEvent.click(screen.getByLabelText('Include Tilt left'));
    expect(screen.getByText('Use')).toBeTruthy();
    fireEvent.click(screen.getByText('Use'));
    expect(useTrainer.getState().routine.map((c) => c.id)).not.toContain('tilt-left');
    expect(useTrainer.getState().routine).toHaveLength(STARTER_CUES.length - 1);
    // The reorder made it through too: look-right now precedes look-left.
    const ids = useTrainer.getState().routine.map((c) => c.id);
    expect(ids.indexOf('look-right')).toBeLessThan(ids.indexOf('look-left'));
    // And rest (hidden by the 'look' filter at the time) was NOT displaced: still first.
    expect(ids[0]).toBe('rest');
    // Running hides the picker.
    fireEvent.click(screen.getByText('Start'));
    expect(document.querySelector('[data-routine-picker]')).toBeNull();
    fireEvent.click(screen.getByText('Stop'));
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

describe('the projection view (#163 §7-§8) is reachable and labels categories in FULL feature space', () => {
  /** Drive a small many-pose take through the store so the panel can project it. */
  function buildTake() {
    const prng = (seed: number) => () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 2147483648 - 1;
    };
    const r = prng(9);
    const jit = () => 0.3 * r();
    const base = () => ({ 'face.head.yaw': jit(), 'face.head.pitch': jit(), 'face.head.roll': jit() });
    useTrainer.getState().setRoutine(['rest', 'look-left', 'look-right', 'look-up', 'look-down', 'tilt-left', 'tilt-right']);
    useTrainer.getState().start(1000);
    let t = 1000;
    const feed = (n: number, make: () => Record<string, number>) => {
      for (let i = 0; i < n; i++) {
        t += 33;
        useTrainer.getState().sample(make(), t);
      }
    };
    const hold = (ms: number, make: () => Record<string, number>) => {
      const e = t + ms;
      while (t < e) {
        t += 33;
        useTrainer.getState().sample(make(), t);
      }
    };
    feed(120, base);
    let held = base;
    hold(1700, () => held());
    for (const pose of [{ 'face.head.yaw': -25 }, { 'face.head.yaw': 25 }, { 'face.head.pitch': -25 }, { 'face.head.pitch': 25 }, { 'face.head.roll': 20 }, { 'face.head.roll': -20 }]) {
      const at = () => ({ ...base(), ...Object.fromEntries(Object.entries(pose).map(([k, v]) => [k, v + jit()])) });
      feed(8, () => ({ ...base(), ...Object.fromEntries(Object.entries(pose).map(([k, v]) => [k, v * 0.5])) }));
      feed(25, at);
      held = at;
      hold(1700, () => held());
    }
    useTrainer.getState().build();
  }

  it('opens from the panel, shows a canvas once projected, and a labelled selection makes a category', async () => {
    const { categoryKey } = await import('@/enroll');
    useTools.setState({ open: 'trainer' });
    act(() => buildTake());
    render(<TrainerPanel />);
    // The section is offered; opening it projects the take and shows the canvas.
    fireEvent.click(screen.getByText(/Draw your own categories/));
    expect(useTrainer.getState().layout.length).toBeGreaterThanOrEqual(5);
    expect(screen.getByLabelText('Projection of your held poses')).toBeTruthy();
    // Select the left-turn points (from the raw vectors) and label them via the store —
    // the view passes INDICES; the centroid is computed in full feature space.
    const pts = useTrainer.getState().session().points();
    const left = pts.map((p, i) => [p.vector['face.head.yaw'] ?? 0, i] as const).filter(([y]) => y < -10).map(([, i]) => i);
    act(() => {
      useTrainer.getState().select(left);
      useTrainer.getState().labelSelection('left');
    });
    // The labelled group shows in the view; the model is now the drawn one.
    expect(screen.getByText('left')).toBeTruthy();
    const model = useTrainer.getState().model!;
    const leftCat = model.categories.find((c) => useTrainer.getState().labels[categoryKey(c)] === 'left')!;
    const mean = left.reduce((s, i) => s + (pts[i].vector['face.head.yaw'] ?? 0), 0) / left.length;
    expect(leftCat.centroid['face.head.yaw']).toBeCloseTo(mean, 5);
  });
});
