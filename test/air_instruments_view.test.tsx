// @vitest-environment jsdom
/**
 * Air instruments are instruments (#249) — the reachability walk.
 *
 * The maintainer's rule: one place to choose any instrument. So this walks what a player
 * does from a cold load, on the real Instruments view (it opens by default): the list
 * shows an "Air instruments" group, the Air Drum is in it, one click on its row plays it
 * exactly as a click on any other instrument does (the air drum's dial on, the theremin
 * voices silent), its live readout appears under the row, and choosing a theremin
 * instrument turns the drum off again. The gear opens the air drum's settings with its
 * own section first — the home the pad editor (#245) builds on.
 *
 * The air drum's retired tool panel is guarded against coming back: no shell tool may be
 * an instrument (`tools.ts`).
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react';
import InstrumentsPanel from '@/app/dials/InstrumentsPanel';
import { dialsStore } from '@/app/dials/settingsStore';
import { TOOLS } from '@/app/tools';
import { useAirDrumStatus, ABSENT_AIR_DRUM_LIVE, describeLive } from '@/app/airDrumStatus';
import { AirDrumReadout } from '@/app/dials/panels/airDrum';
import { AIR_INSTRUMENTS } from '@/app/library/category';
import type { AirDrumSettings, AirBassSettings, AirGuitarSettings, AirFluteSettings } from '@/settings/schema';
import type { HandMap } from '@/nodes/mapping/hand_map';

const airDrum = () => dialsStore.getState().effective.airDrum as AirDrumSettings;
const airBass = () => dialsStore.getState().effective.airBass as AirBassSettings;
const airGuitar = () => dialsStore.getState().effective.airGuitar as AirGuitarSettings;
const airFlute = () => dialsStore.getState().effective.airFlute as AirFluteSettings;
const handMap = () => dialsStore.getState().effective.handMap as HandMap;

beforeAll(() => {
  localStorage.clear(); // a cold load: no instruments seeded, nothing selected
});
afterEach(() => cleanup());

/** The Air instruments group, once the list has loaded and derived its categories. */
async function airGroup(): Promise<HTMLElement> {
  return waitFor(() => {
    const g = screen.getByRole('group', { name: 'Air instruments' });
    expect(within(g).getByText('Air Drum')).toBeTruthy();
    return g;
  });
}

describe('the Air instruments category (#249)', () => {
  it('lists the air drum under Air instruments, and the field instruments in their own group', async () => {
    render(<InstrumentsPanel />);
    const air = await airGroup();
    const theremin = screen.getByRole('group', { name: 'Field instruments' });
    expect(within(theremin).queryByText('Air Drum')).toBeNull();
    expect(within(theremin).getByText('Pentatonic')).toBeTruthy();
    expect(within(air).queryByText('Pentatonic')).toBeNull();
    // Field instruments first, then the air instruments.
    const groups = screen.getAllByRole('group').map((g) => g.getAttribute('data-category'));
    expect(groups).toEqual(['field', 'air']);
    // Its system tag says what it is at a glance.
    expect(within(air).getByTitle('Air drum')).toBeTruthy();
  });

  it('plays the air drum with one click on its row, like any instrument, and a theremin turns it off', async () => {
    render(<InstrumentsPanel />);
    const air = await airGroup();
    fireEvent.click(within(air).getByText('Air Drum'));
    await waitFor(() => expect(airDrum().enabled).toBe(true));
    expect(handMap().maxGain).toBe(0); // the hands drum; the theremin voices are silent

    // The readout sits under the chosen row: the first thing to do is teach each hand.
    act(() => useAirDrumStatus.getState().report({ ...ABSENT_AIR_DRUM_LIVE, enabled: true, ready: { right: false, left: false } }));
    const live = await within(air).findByTestId('air-drum-live');
    expect(live.textContent).toMatch(/Strike once to teach/);

    const theremin = screen.getByRole('group', { name: 'Field instruments' });
    fireEvent.click(within(theremin).getByText('Pentatonic'));
    await waitFor(() => expect(airDrum().enabled).toBe(false));
    expect(handMap().maxGain).toBeGreaterThan(0);
    expect(within(air).queryByTestId('air-drum-live')).toBeNull();
  });

  it('shows the readout under a theremin whose drum is live, so a drum left on is never invisible', async () => {
    render(<InstrumentsPanel />);
    await airGroup();
    const theremin = screen.getByRole('group', { name: 'Field instruments' });
    fireEvent.click(within(theremin).getByText('Pentatonic'));
    await waitFor(() => expect(airDrum().enabled).toBe(false));
    act(() => dialsStore.set('airDrum', { ...airDrum(), enabled: true }));
    expect(await within(theremin).findByTestId('air-drum-live')).toBeTruthy();
  });

  it('plays the air bass the same way, and the air drum stops', async () => {
    render(<InstrumentsPanel />);
    const air = await airGroup();
    fireEvent.click(within(air).getByText('Air Drum'));
    await waitFor(() => expect(airDrum().enabled).toBe(true));
    fireEvent.click(within(air).getByText('Air Bass'));
    await waitFor(() => expect(airBass().enabled).toBe(true));
    expect(airDrum().enabled).toBe(false);
    expect(handMap().maxGain).toBe(0);
    expect(within(air).getByTitle('Air bass')).toBeTruthy();
    const live = await within(air).findByTestId('air-bass-live');
    expect(live.textContent).toMatch(/Off|both hands|Pluck|Ready/);
    fireEvent.click(within(air).getByLabelText('Edit Air Bass'));
    const sections = document.querySelectorAll('details[data-section]');
    expect(sections[0]?.getAttribute('data-section')).toBe('Air bass');
    expect(screen.getByLabelText('Plucking hand')).toBeTruthy();
  });

  it('plays the air guitar the same way, and its settings open on the enrolment step', async () => {
    render(<InstrumentsPanel />);
    const air = await airGroup();
    fireEvent.click(within(air).getByText('Air Guitar'));
    await waitFor(() => expect(airGuitar().enabled).toBe(true));
    expect(airBass().enabled).toBe(false);
    expect(within(air).getByTitle('Air guitar')).toBeTruthy();
    expect(await within(air).findByTestId('air-guitar-live')).toBeTruthy();
    fireEvent.click(within(air).getByLabelText('Edit Air Guitar'));
    const sections = document.querySelectorAll('details[data-section]');
    expect(sections[0]?.getAttribute('data-section')).toBe('Air guitar');
    const section = sections[0] as HTMLElement;
    expect(within(section).getByTestId('shape-enrolment')).toBeTruthy();
    expect(within(section).getByLabelText('Chord to learn')).toBeTruthy();
  });

  it('plays the air flute the same way; its settings carry both enrolment steps', async () => {
    render(<InstrumentsPanel />);
    const air = await airGroup();
    fireEvent.click(within(air).getByText('Air Flute'));
    await waitFor(() => expect(airFlute().enabled).toBe(true));
    expect(within(air).getByTitle('Air flute')).toBeTruthy();
    expect(await within(air).findByTestId('air-flute-live')).toBeTruthy();
    fireEvent.click(within(air).getByLabelText('Edit Air Flute'));
    const section = document.querySelector('details[data-section]') as HTMLElement;
    expect(section.getAttribute('data-section')).toBe('Air flute');
    expect(within(section).getByLabelText('Note to learn')).toBeTruthy();
    expect(within(section).getByText('Learn blowing')).toBeTruthy();
    expect(within(section).getByText('Learn resting')).toBeTruthy();
    // Fingers only: the breath enrolment goes away. (First let the editor's own
    // re-load of the instrument land, or it would restore the saved breath.)
    await act(() => new Promise((r) => setTimeout(r, 20)));
    fireEvent.change(within(section).getByLabelText('Breath'), { target: { value: 'always' } });
    await waitFor(() => expect(airFlute().breath).toBe('always'));
    await waitFor(() => expect(within(section).queryByText('Learn blowing')).toBeNull());
  });

  it("opens the air drum's settings on its own section, first", async () => {
    render(<InstrumentsPanel />);
    const air = await airGroup();
    fireEvent.click(within(air).getByLabelText('Edit Air Drum'));
    await waitFor(() => expect(airDrum().enabled).toBe(true));
    const sections = document.querySelectorAll('details[data-section]');
    expect(sections[0]?.getAttribute('data-section')).toBe('Air drum');
    expect((sections[0] as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByLabelText('Drumming hands')).toBeTruthy();
    expect(screen.getByTestId('air-drum-live')).toBeTruthy();
  });

  it('keeps instruments out of the tools bar: no shell tool is an air instrument', () => {
    const toolWords = TOOLS.map((t) => `${t.id} ${t.label}`.toLowerCase());
    for (const a of AIR_INSTRUMENTS) {
      for (const w of toolWords) expect(w).not.toContain(a.label.toLowerCase());
    }
    expect(TOOLS.find((t) => t.id === 'airDrum')).toBeUndefined();
  });
});

describe('the air drum readout (moved from the retired tool panel)', () => {
  it('says what the drum is doing, from the status store', () => {
    useAirDrumStatus.getState().reset();
    render(<AirDrumReadout />);
    expect(screen.getByTestId('air-drum-live').getAttribute('data-state')).toBe('off');
    act(() => useAirDrumStatus.getState().report({ ...ABSENT_AIR_DRUM_LIVE, enabled: true, ready: { right: false, left: false } }));
    expect(screen.getByText(/Strike once to teach/)).toBeTruthy();
    act(() =>
      useAirDrumStatus.getState().report({ enabled: true, hits: 4, predicted: 3, lastHand: 'right', lastLead: 0.048, lastPull: 0, ready: { right: true, left: false } }),
    );
    expect(screen.getByText('Right: predicted 48 ms before the strike.')).toBeTruthy();
    expect(screen.getByText('4 · 75%')).toBeTruthy();
    expect(screen.getByTestId('air-drum-live').getAttribute('data-state')).toBe('playing');
    act(() => useAirDrumStatus.getState().report({ enabled: true, hits: 5, predicted: 3, lastHand: 'left', lastLead: -0.033, lastPull: 0, ready: { right: true, left: true } }));
    expect(screen.getByText(/Left: sounded 33 ms after/)).toBeTruthy();
  });

  it('describeLive covers every state', () => {
    expect(describeLive(ABSENT_AIR_DRUM_LIVE)).toMatch(/Off/);
    expect(describeLive({ ...ABSENT_AIR_DRUM_LIVE, enabled: true, ready: { right: true, left: false } })).toMatch(/Ready/);
  });
});
