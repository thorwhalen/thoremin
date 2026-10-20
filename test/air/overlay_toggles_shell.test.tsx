// @vitest-environment jsdom
/**
 * The air overlay elements' toggles are reachable where their elements went (#600 S10): the drum
 * pads' "Show the pads and sticks on the video" in the air drum's section, and the breath cue's
 * show and edge in the air flute's, each from a cold load through the instrument's row, each
 * writing the air dial through the single write path. They were Overlay-section toggles writing
 * `overlay.drumPads` / `overlay.mouthCue`, and that section no longer lists them.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import InstrumentsPanel from '@/app/dials/InstrumentsPanel';
import { dialsStore, resetDial } from '@/app/dials/settingsStore';
import { OVERLAY_CONTROLS } from '@/app/overlayControls';
import { structuredDialLeaves } from '@/app/commands/paths';
import { makeCanvasOverlayNode, overlayElementOrder } from '@/nodes/output/canvas_overlay';
import { CONTRIBUTIONS } from '@/host/contributions';
import type { AirDrumSettings, AirFluteSettings } from '@thoremin/ext-air/dials';
import { AIR } from '../helpers/extensions';

const effective = () => dialsStore.getState().effective as { airDrum: AirDrumSettings; airFlute: AirFluteSettings };

beforeAll(() => localStorage.clear());
afterEach(() => {
  cleanup();
  resetDial('airDrum');
  resetDial('airFlute');
  resetDial('chordMap');
});

async function editRow(name: string) {
  render(<InstrumentsPanel />);
  const edit = await waitFor(() => within(screen.getByRole('group', { name: 'Air instruments' })).getByLabelText(`Edit ${name}`));
  fireEvent.click(edit);
}

describe.runIf(AIR)('the air overlay toggles, in the air sections (#600 S10)', () => {
  it('Edit Air Drum shows "Show the pads and sticks on the video", which writes airDrum.padsOnVideo.show', async () => {
    await editRow('Air Drum');
    const toggle = (await screen.findByLabelText('Show the pads and sticks on the video')) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    await waitFor(() => expect(effective().airDrum.padsOnVideo.show).toBe(false));
  });

  it('Edit Air Flute shows the breath cue toggle and its edge, which write airFlute.breathCue', async () => {
    await editRow('Air Flute');
    const toggle = (await screen.findByLabelText('Breath cue on the video')) as HTMLInputElement;
    fireEvent.click(toggle);
    await waitFor(() => expect(effective().airFlute.breathCue.show).toBe(false));
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText('Breath cue edge'), { target: { value: 'right' } });
    await waitFor(() => expect(effective().airFlute.breathCue).toEqual({ show: true, position: 'right' }));
  });

  it('the old overlay keys are not settable paths (the palette and the assistant cannot write a dead key)', () => {
    const paths = structuredDialLeaves().map((l) => l.path);
    expect(paths.filter((p) => p.startsWith('overlay.drumPads') || p.startsWith('overlay.mouthCue') || p.startsWith('overlay.cellGrid'))).toEqual([]);
    expect(paths).toEqual(expect.arrayContaining(['airDrum.padsOnVideo.show', 'airFlute.breathCue.show', 'airFlute.breathCue.position', 'chordMap.gridOnVideo.show']));
  });

  it('they draw where core drew them: the pads just beneath the chord map\'s grid, the cue just before the face expression', () => {
    const order = overlayElementOrder(CONTRIBUTIONS.overlayElements.filter((c) => c.extension === 'air'));
    // (Core's `conductorHud` sat between the landmarks and the pads; it is the conductor slice's since #600 S18c.)
    expect(order[order.indexOf('air/drumPads') - 1]).toBe('landmarks');
    expect(order[order.indexOf('air/drumPads') + 1]).toBe('air/chordMap'); // #610 item 4: the map's grid, then the markers
    expect(order[order.indexOf('air/chordMap') + 1]).toBe('markers');
    expect(order[order.indexOf('air/mouthCue') - 1]).toBe('chordName');
    expect(order[order.indexOf('air/mouthCue') + 1]).toBe('faceExpression');
    const [pads] = CONTRIBUTIONS.overlayElements.filter((c) => c.id === 'air/drumPads');
    expect(() => makeCanvasOverlayNode([{ ...pads, decl: { ...pads.decl, drawBefore: 'nope' } }])).toThrow(/draws before "nope", which is not a core overlay element/);
  });

  it('Edit Chord Map shows "Draw the map on the video", which writes chordMap.gridOnVideo.show (#610 item 4)', async () => {
    await editRow('Chord Map');
    const toggle = (await screen.findByLabelText('Draw the map on the video')) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    await waitFor(() => expect((dialsStore.getState().effective as { chordMap: { gridOnVideo: { show: boolean } } }).chordMap.gridOnVideo.show).toBe(false));
  });

  it('the Overlay section no longer lists them', () => {
    expect(OVERLAY_CONTROLS.map((d) => d.name)).not.toContain('cellGrid');
    expect(OVERLAY_CONTROLS.map((d) => d.name)).not.toContain('drumPads');
    expect(OVERLAY_CONTROLS.map((d) => d.name)).not.toContain('mouthCue');
  });
});
