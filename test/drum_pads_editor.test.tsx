// @vitest-environment jsdom
/**
 * The drum-pad editor (#245), the reachability walk of its "Done when": from a cold
 * load, open the air drum, lay out three pads, give one its own drum and colour, move one
 * by dragging it, save the layout, and get it back after changing the kit.
 *
 * On the real Instruments view: the Air Drum's gear opens its settings with the air
 * drum's section first, and the pad editor is in that section. Every edit is checked on
 * the `airDrum` dial (what the node reads each tick), so this also proves the editor
 * writes through the command path the node listens to. The saved layout is checked in
 * its zodal collection (`padLayouts.ts`).
 *
 * Clicks from a cold load to a playable three-pad kit: Edit Air Drum (1), Add pad x3
 * (4). Saving it: type a name, Save layout (5).
 *
 * Two tests, not one (#290): the cold-load walk renders the whole Instruments view, and every
 * dial write re-renders all of it, so the editing walk on it took ~0.7 s alone and over 5 s
 * under the full suite's load. The reachability (cold load to the editor, one write) stays on
 * the real view; the editing walk renders the editor itself, against the same dials store
 * and the same command path; the cold-load test also checks the editor survives the view's
 * re-render (the same element after a write). And the walk waits for the Air Drum's ROW, not
 * only its group: the group renders before the seeded instruments arrive.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react';
import { useAirDrumStatus } from '@/extensions/air/app/airDrumStatus';
import { DrumPadEditor, visibleCrop } from '@/extensions/air/panels/airDrumPads';
import InstrumentsPanel from '@/app/dials/InstrumentsPanel';
import { dialsStore, resetDial } from '@/app/dials/settingsStore';
import { PAD_IDS, type Pads } from '@/nodes/music/drum_pads';
import { createPadLayoutStore, padLayoutWrites } from '@/extensions/air/app/padLayouts';
import { leafByPath } from '@/app/commands/paths';
import type { AirDrumSettings } from '@/extensions/air/dials';
import { AIR } from './helpers/extensions';

const airDrum = () => dialsStore.getState().effective.airDrum as AirDrumSettings;
const padsOn = () => PAD_IDS.filter((id) => (airDrum().pads as Pads)[id].on);

beforeAll(() => {
  localStorage.clear(); // a cold load
  // jsdom has no PointerEvent: a MouseEvent carries the coordinates the editor reads.
  if (!('PointerEvent' in window)) (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = class extends MouseEvent {} as typeof MouseEvent;
});
afterEach(() => {
  cleanup();
  resetDial('airDrum'); // each walk starts from the shipped dial: no pads, off
  useAirDrumStatus.getState().report({ ...useAirDrumStatus.getState().live, frameAspect: 0 }); // even if a walk failed midway
});

describe('the pad editor, from a cold load (#245)', () => {
  it.runIf(AIR)('reaches the editor from a cold load: Edit Air Drum opens it, and Add pad writes the dial', async () => {
    render(<InstrumentsPanel />);
    // The row, not only the group: the group renders before the seeded instruments arrive.
    const edit = await waitFor(() => within(screen.getByRole('group', { name: 'Air instruments' })).getByLabelText('Edit Air Drum'));
    fireEvent.click(edit);
    await waitFor(() => expect(airDrum().enabled).toBe(true));
    const editor = await screen.findByTestId('drum-pad-editor');
    expect(padsOn()).toHaveLength(0);
    fireEvent.click(within(editor).getByRole('button', { name: 'Add pad' }));
    await waitFor(() => expect(padsOn()).toHaveLength(1));
    // Inside the real view a dial write re-renders the whole panel; the editor must survive it
    // (the same element, so its own state, the chosen pad and a colour being picked, does too).
    expect(screen.getByTestId('drum-pad-editor')).toBe(editor);
    fireEvent.change(within(editor).getByLabelText('Pad drum'), { target: { value: 'crash' } });
    await waitFor(() => expect((airDrum().pads as Pads)[padsOn()[0]].sound).toBe('crash'));
    expect(screen.getByTestId('drum-pad-editor')).toBe(editor);
  });

  it.runIf(AIR)('lays out three pads, edits one, drags one, saves the layout and loads it back', async () => {
    render(<DrumPadEditor enabled />);
    const editor = await screen.findByTestId('drum-pad-editor');
    const ed = within(editor);

    // Three pads.
    expect(padsOn()).toHaveLength(0);
    for (let n = 1; n <= 3; n++) {
      fireEvent.click(ed.getByRole('button', { name: 'Add pad' }));
      await waitFor(() => expect(padsOn()).toHaveLength(n));
    }
    expect(new Set(padsOn().map((id) => (airDrum().pads as Pads)[id].sound)).size).toBe(3); // three different drums

    // Choose a pad, give it its own drum and colour.
    fireEvent.click(ed.getByLabelText(/^Pad p1:/));
    fireEvent.change(ed.getByLabelText('Pad drum'), { target: { value: 'crash' } });
    await waitFor(() => expect((airDrum().pads as Pads).p1.sound).toBe('crash'));
    // The colour follows the picker locally (its `input` stream) and is written once,
    // when the picker closes (its `change`).
    const colour = ed.getByLabelText('Pad colour');
    fireEvent.input(colour, { target: { value: '#00aa00' } });
    fireEvent.input(colour, { target: { value: '#00ff00' } });
    expect((airDrum().pads as Pads).p1.color).not.toBe('#00ff00');
    fireEvent.change(colour, { target: { value: '#00ff00' } });
    await waitFor(() => expect((airDrum().pads as Pads).p1.color).toBe('#00ff00'));

    // A colour picked for one pad stays that pad's, even when another pad is chosen
    // before the picker loses focus (the reviewed bug: it painted the other pad).
    const p2Before = (airDrum().pads as Pads).p2.color;
    fireEvent.input(colour, { target: { value: '#0000ff' } });
    fireEvent.pointerDown(editor.querySelector('[data-pad="p2"] ellipse, [data-pad="p2"] rect')!, { clientX: 0, clientY: 0, pointerId: 9 });
    fireEvent.pointerUp(ed.getByLabelText('Pad stage'), { clientX: 0, clientY: 0, pointerId: 9 });
    fireEvent.blur(colour);
    await waitFor(() => expect((airDrum().pads as Pads).p1.color).toBe('#0000ff'));
    expect((airDrum().pads as Pads).p2.color).toBe(p2Before);
    // Back to green for the rest of the walk.
    fireEvent.click(ed.getByLabelText(/^Pad p1:/));
    fireEvent.input(ed.getByLabelText('Pad colour'), { target: { value: '#00ff00' } });
    fireEvent.change(ed.getByLabelText('Pad colour'), { target: { value: '#00ff00' } });
    await waitFor(() => expect((airDrum().pads as Pads).p1.color).toBe('#00ff00'));

    // The keyboard moves the chosen pad too.
    const x0 = (airDrum().pads as Pads).p1.x;
    fireEvent.keyDown(ed.getByLabelText(/^Pad p1:/), { key: 'ArrowLeft' });
    await waitFor(() => expect((airDrum().pads as Pads).p1.x).toBeCloseTo(x0 - 0.02, 3));
    fireEvent.keyDown(ed.getByLabelText(/^Pad p1:/), { key: 'ArrowRight' });
    await waitFor(() => expect((airDrum().pads as Pads).p1.x).toBeCloseTo(x0, 3));

    // The stage is the camera's shape once a frame has arrived, and outlines what the
    // window shows (jsdom's window is 4:3, the default camera shape 16:9: it crops the sides).
    expect(ed.getByTestId('visible-crop')).toBeTruthy();
    act(() => useAirDrumStatus.getState().report({ ...useAirDrumStatus.getState().live, frameAspect: 4 / 3 }));
    expect(ed.getByLabelText('Pad stage').getAttribute('viewBox')).toBe('0 0 120 90');
    act(() => useAirDrumStatus.getState().report({ ...useAirDrumStatus.getState().live, frameAspect: 0 }));

    // Drag it right by a quarter of the stage (the stage is laid out 160 x 90 here).
    const stage = ed.getByLabelText('Pad stage');
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 160, height: 90, right: 160, bottom: 90, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const before = (airDrum().pads as Pads).p1;
    const shape = editor.querySelector('[data-pad="p1"] ellipse, [data-pad="p1"] rect')!;
    fireEvent.pointerDown(shape, { clientX: 80, clientY: 60, pointerId: 1 });
    fireEvent.pointerMove(stage, { clientX: 120, clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(stage, { clientX: 120, clientY: 60, pointerId: 1 });
    await waitFor(() => expect((airDrum().pads as Pads).p1.x).toBeCloseTo(before.x + 0.25, 2));
    expect((airDrum().pads as Pads).p1.y).toBeCloseTo(before.y, 2);

    // Resize it by its corner handle.
    const handle = editor.querySelector('[data-handle="p1"]')!;
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 80, pointerId: 2 });
    fireEvent.pointerMove(stage, { clientX: 108, clientY: 80, pointerId: 2 });
    fireEvent.pointerUp(stage, { clientX: 108, clientY: 80, pointerId: 2 });
    await waitFor(() => expect((airDrum().pads as Pads).p1.w).toBeCloseTo(before.w + 0.1, 2));

    // Save the layout.
    fireEvent.change(ed.getByLabelText('Layout name'), { target: { value: 'My kit' } });
    fireEvent.click(ed.getByRole('button', { name: 'Save layout' }));
    await waitFor(() => expect(ed.getByRole('list', { name: 'Saved pad layouts' })).toBeTruthy());
    const saved = await createPadLayoutStore().load('my-kit');
    expect(saved?.pads.p1.sound).toBe('crash');

    // Change the kit, then load the layout back: exactly the saved pads.
    fireEvent.click(ed.getByRole('button', { name: 'Starter kit' }));
    await waitFor(() => expect(padsOn()).toHaveLength(5));
    fireEvent.click(ed.getByRole('button', { name: 'Load layout My kit' }));
    await waitFor(() => expect(padsOn()).toHaveLength(3));
    expect((airDrum().pads as Pads).p1.sound).toBe('crash');
    expect((airDrum().pads as Pads).p1.color).toBe('#00ff00');

    // Remove a pad.
    fireEvent.click(ed.getByLabelText(/^Pad p2:/));
    fireEvent.click(ed.getByRole('button', { name: 'Remove pad' }));
    await waitFor(() => expect(padsOn()).toHaveLength(2));
  });
});

describe('pad layouts (the zodal collection)', () => {
  it.runIf(AIR)('loads a layout with writes that are every addressable leaf of every slot', () => {
    const writes = padLayoutWrites(airDrum().pads as Pads);
    expect(writes).toHaveLength(PAD_IDS.length * 8);
    for (const [path] of writes) expect(leafByPath[path], path).toBeDefined();
  });
});

describe('the visible crop (the video fills the window by cropping)', () => {
  it('keeps the full width in a wider window and the full height in a narrower one', () => {
    expect(visibleCrop(4 / 3, { w: 1600, h: 900 })).toEqual({ x: 0, y: 0.125, w: 1, h: 0.75 });
    const tall = visibleCrop(16 / 9, { w: 900, h: 1600 })!;
    expect(tall.h).toBe(1);
    expect(tall.w).toBeCloseTo((9 / 16) / (16 / 9), 9);
    expect(visibleCrop(16 / 9, { w: 1600, h: 900 })).toBeNull();
  });
});
