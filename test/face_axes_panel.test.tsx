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
    expect(axes().pitchGain).toBe(-1);
    expect(axes().yawGain).toBe(1);
    expect(axes().rollGain).toBe(1);
    expect(axes().headRangeDeg).toBe(DEFAULT_FACE_CONTROLS_DIAL.headRangeDeg);
  });
});
