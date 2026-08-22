// @vitest-environment jsdom
/**
 * Face control-axis panel reachability (#76) — the UI half of the guard, mirroring
 * `midi_panel.test.tsx` for #137.
 *
 * The DAG-edge test (`app_graph.test.ts`) proves the axis tuning CAN reach the node.
 * The node test (`face_controls.test.ts`) proves the node honours it. Neither says a
 * player can FIND it, and that is exactly the gap #119 and #120 fell into: shipped,
 * deployed, fully tested, unreachable. So this file asserts the reachability itself —
 * that the axis editor is mounted by the Face panel in the mode that uses it, that the
 * Flip control exists, and that it is NOT shown in the modes where it would be noise.
 *
 * It also pins the write-path split (`test/dials_write_path.test.ts` enforces it
 * statically, this exercises it dynamically): the Flip button DISPATCHES a command
 * rather than writing the store directly.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { FaceControls } from '@/app/dials/panels/face';
import { dialsStore, setDial } from '@/app/dials/settingsStore';
import { DEFAULT_FACE_CONTROLS_DIAL } from '@/nodes/features/face_controls';
import type { FaceControlsDialParams } from '@/nodes/features/face_controls';

const axes = () => dialsStore.getState().effective['faceControls'] as FaceControlsDialParams;

beforeEach(() => {
  setDial('face.mapping' as never, 'none');
  setDial('faceControls' as never, { ...DEFAULT_FACE_CONTROLS_DIAL });
});
afterEach(cleanup);

describe('the Face panel mounts the axis editor in `controls` mode (#76 reachability)', () => {
  it('renders the Control axes section when the head-pose mode is selected', () => {
    setDial('face.mapping' as never, 'controls');
    render(<FaceControls />);
    expect(screen.getByText('Control axes')).toBeTruthy();
    // The three head axes, each with the Flip affordance that answers the sign question.
    expect(screen.getByText('Turn (yaw)')).toBeTruthy();
    expect(screen.getByText('Nod (pitch)')).toBeTruthy();
    expect(screen.getByText('Tilt (roll)')).toBeTruthy();
    expect(screen.getAllByTitle('Reverse this axis (negate its gain)').length).toBe(3);
  });

  it('does NOT render it in the modes that do not use the axes', () => {
    for (const mode of ['none', 'timbre', 'chord'] as const) {
      cleanup();
      setDial('face.mapping' as never, mode);
      render(<FaceControls />);
      expect(screen.queryByText('Control axes')).toBeNull();
    }
  });
});

describe('the Flip control writes through the command registry (#126 write path)', () => {
  it('negates the axis gain, so the sign check is one click rather than a rebuild', async () => {
    setDial('face.mapping' as never, 'controls');
    render(<FaceControls />);
    expect(axes().yawGain).toBe(1);

    const [yawFlip] = screen.getAllByTitle('Reverse this axis (negate its gain)');
    fireEvent.click(yawFlip);
    // The dispatch is async (a command returns a promise); let the microtask queue drain.
    await Promise.resolve();
    await Promise.resolve();
    expect(axes().yawGain).toBe(-1);

    // …and it is an involution: clicking again restores the original direction, so a
    // maintainer probing a sign can never get stranded in a state they can't undo.
    fireEvent.click(screen.getAllByTitle('Reverse this axis (negate its gain)')[0]);
    await Promise.resolve();
    await Promise.resolve();
    expect(axes().yawGain).toBe(1);
  });

  it('flips ONE axis, leaving its siblings alone (a deep-set, not a replace)', async () => {
    setDial('face.mapping' as never, 'controls');
    render(<FaceControls />);
    const flips = screen.getAllByTitle('Reverse this axis (negate its gain)');
    fireEvent.click(flips[1]); // pitch
    await Promise.resolve();
    await Promise.resolve();
    // pitch STARTS at -1 (the measured default — see face_head_pose_signs.test.ts), so
    // one flip lands on +1. The point of the assertion is that exactly one axis moved.
    expect(axes().pitchGain).toBe(1);
    expect(axes().yawGain).toBe(1);
    expect(axes().rollGain).toBe(1);
    expect(axes().headRangeDeg).toBe(DEFAULT_FACE_CONTROLS_DIAL.headRangeDeg);
  });
});

/**
 * The sliders must SURVIVE their own writes.
 *
 * A component declared inside another component's body is a new function IDENTITY on
 * every render, so React's reconciler sees a different element TYPE and unmounts the
 * whole subtree instead of updating it. For a `<select>` that is merely wasteful; for an
 * `<input type="range">` it is fatal, because the DOM node under the pointer is replaced
 * mid-drag and the native drag gesture ends after a single step. Keyboard is hit just as
 * hard: focus lands on a detached node, so the second arrow key goes nowhere.
 *
 * That failure would also nullify Decision B itself — the panel writes directly, skipping
 * the command registry, *purely* to keep a drag responsive. A drag that cannot last more
 * than one frame has paid the auditability cost and bought nothing.
 *
 * The existing tests above miss it because they only click the Flip buttons, which are
 * rendered directly by `FaceAxisControls` rather than through the row helper. So this
 * asserts the property the panel actually depends on: NODE IDENTITY across a write.
 */
describe('the axis sliders survive their own writes (no remount on every keystroke)', () => {
  const ranges = (c: HTMLElement) =>
    Array.from(c.querySelectorAll<HTMLInputElement>('input[type="range"]'));

  it('keeps the same DOM node for a slider after it writes', () => {
    setDial('face.mapping' as never, 'controls');
    const { container } = render(<FaceControls />);

    const before = ranges(container);
    expect(before.length).toBeGreaterThanOrEqual(15); // 3 head axes x2 + 4 face axes x2 + 4
    const yawGain = before[0];

    fireEvent.change(yawGain, { target: { value: '0.5' } });
    expect(axes().yawGain).toBe(0.5);

    const after = ranges(container);
    expect(after.length).toBe(before.length);
    // The identity check IS the assertion: a remount replaces the node the pointer holds.
    expect(after[0]).toBe(yawGain);
    for (let i = 0; i < before.length; i += 1) expect(after[i]).toBe(before[i]);
  });

  it('keeps keyboard focus on the slider being adjusted', () => {
    setDial('face.mapping' as never, 'controls');
    const { container } = render(<FaceControls />);

    const slider = ranges(container)[0];
    slider.focus();
    expect(document.activeElement).toBe(slider);

    fireEvent.change(slider, { target: { value: '0.7' } });
    // A remount detaches the focused node and focus falls back to <body>, so a second
    // arrow press would do nothing at all.
    expect(document.activeElement).toBe(ranges(container)[0]);
    expect(document.activeElement).not.toBe(document.body);
  });
});
