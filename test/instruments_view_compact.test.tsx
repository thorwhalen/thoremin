// @vitest-environment jsdom
/**
 * The Instruments view, option A of #272: one line per instrument, the class colour, and
 * collapsible classes that stay collapsed on the next visit.
 */
import { describe, it, expect, afterEach, beforeAll, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react';
import { useAirDrumStatus, ABSENT_AIR_DRUM_LIVE } from '@/extensions/air/app/airDrumStatus';
import { createInMemoryProvider } from '@zodal/store';
import InstrumentsPanel from '@/app/dials/InstrumentsPanel';
import {
  createInstrumentsViewStore,
  useInstrumentsView,
  type InstrumentsViewPrefs,
} from '@/app/library/instrumentsViewPrefs';
import { INSTRUMENT_CLASSES } from '@/instruments/classes';

beforeAll(() => localStorage.clear());
beforeEach(() => useInstrumentsView.setState({ collapsed: [] }));
afterEach(() => cleanup());

/** A class heading's button (its accessible name is its visible text). */
const heading = (classId: string) => document.querySelector(`[data-collapse-class="${classId}"]`) as HTMLButtonElement;

const group = (name: string) =>
  waitFor(() => {
    const g = screen.getByRole('group', { name });
    expect(within(g).getAllByRole('listitem').length).toBeGreaterThan(0);
    return g;
  });

describe('one line per instrument', () => {
  it("puts an instrument's tags on its own line, beside its name, star and gear", async () => {
    render(<InstrumentsPanel />);
    const field = await group('Field instruments');
    const row = within(field).getByText('Pentatonic').closest('li')!;
    // The row's first child is the single line: name, tags, star, gear all in it.
    const line = row.firstElementChild!;
    expect(within(line as HTMLElement).getByText('Pentatonic')).toBeTruthy();
    expect(within(line as HTMLElement).getAllByRole('img').length).toBeGreaterThan(0);
    expect(within(line as HTMLElement).getByLabelText('Favorite Pentatonic')).toBeTruthy();
    expect(within(line as HTMLElement).getByLabelText('Edit Pentatonic')).toBeTruthy();
  });

  it("marks every row with its class's colour, from the class registry", async () => {
    render(<InstrumentsPanel />);
    const air = await group('Air instruments');
    const field = screen.getByRole('group', { name: 'Field instruments' });
    // The browser normalises a colour; normalise the registry's the same way to compare.
    const normalised = (id: string) => {
      const probe = document.createElement('span');
      probe.style.color = INSTRUMENT_CLASSES.find((c) => c.id === id)!.colour;
      return probe.style.color;
    };
    const stripe = (g: HTMLElement, name: string) => (within(g).getByText(name).closest('li') as HTMLElement).style.borderLeftColor;
    expect(stripe(air, 'Air Drum')).toContain(normalised('air'));
    expect(stripe(field, 'Pentatonic')).toContain(normalised('field'));
    expect(normalised('air')).not.toBe(normalised('field'));
  });

  it('drops the help paragraph under the list', async () => {
    render(<InstrumentsPanel />);
    await group('Field instruments');
    expect(screen.queryByText(/Click a name to play it/)).toBeNull();
  });
});

describe('collapsible classes', () => {
  it('both classes start open, and a heading collapses its class, keeping its count', async () => {
    render(<InstrumentsPanel />);
    const field = await group('Field instruments');
    expect(within(field).getByText('Pentatonic')).toBeTruthy();
    expect(heading('field').getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(heading('field'));
    expect(heading('field').getAttribute('aria-expanded')).toBe('false');
    expect(within(field).getByRole('list', { hidden: true }).hidden).toBe(true);
    expect(heading('field').textContent).toMatch(/\d+/);
    // The air class is unaffected.
    expect(within(screen.getByRole('group', { name: 'Air instruments' })).getByRole('list').hidden).toBe(false);
  });

  it('the heading\'s accessible name is what it shows: the class, its count, what is playing', async () => {
    render(<InstrumentsPanel />);
    const field = await group('Field instruments');
    fireEvent.click(within(field).getByText('Wrist Theremin'));
    fireEvent.click(heading('field'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Field instruments\s*\d+\s*playing: Wrist Theremin/ })).toBe(heading('field')),
    );
  });

  it('a collapsed class keeps the playing air instrument\'s live readout showing', async () => {
    render(<InstrumentsPanel />);
    const air = await group('Air instruments');
    fireEvent.click(within(air).getByText('Air Drum'));
    act(() => useAirDrumStatus.getState().report({ ...ABSENT_AIR_DRUM_LIVE, enabled: true, ready: { right: false, left: false } }));
    await within(air).findByTestId('air-drum-live');
    fireEvent.click(heading('air'));
    // The row is hidden; the readout is not.
    const live = within(air).getByTestId('air-drum-live');
    expect(live.closest('ul[hidden]')).toBeNull();
  });

  it('a search opens every class, so a match is never a bare count', async () => {
    render(<InstrumentsPanel />);
    const air = await group('Air instruments');
    fireEvent.click(heading('air'));
    expect(within(air).getByRole('list', { hidden: true }).hidden).toBe(true);
    fireEvent.change(screen.getByLabelText('Filter instruments'), { target: { value: 'drum' } });
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Air instruments' })).getByText('Air Drum')).toBeTruthy());
    expect(within(screen.getByRole('group', { name: 'Air instruments' })).getByRole('list').hidden).toBe(false);
  });
});

describe('the collapsed classes are remembered', () => {
  it('a new visit (a new store over the same provider) starts with them collapsed', async () => {
    const provider = createInMemoryProvider<InstrumentsViewPrefs>([], { idField: 'id' });
    const first = createInstrumentsViewStore(provider);
    await first.getState().hydrate(['field', 'air']);
    act(() => first.getState().toggleCollapsed('air'));
    await new Promise((r) => setTimeout(r, 0));

    const next = createInstrumentsViewStore(provider);
    await next.getState().hydrate(['field', 'air']);
    expect(next.getState().collapsed).toEqual(['air']);
  });

  it('with nothing stored, every class is open (the collection declares groups open)', async () => {
    const store = createInstrumentsViewStore(createInMemoryProvider<InstrumentsViewPrefs>([], { idField: 'id' }));
    await store.getState().hydrate(['field', 'air']);
    expect(store.getState().collapsed).toEqual([]);
  });

  it('a collapse made before the stored choices arrive is kept', async () => {
    const provider = createInMemoryProvider<InstrumentsViewPrefs>([{ id: 'instruments', collapsed: ['field'] }], {
      idField: 'id',
    });
    const store = createInstrumentsViewStore(provider);
    const hydrating = store.getState().hydrate(['field', 'air']);
    store.getState().toggleCollapsed('air');
    await hydrating;
    expect(store.getState().collapsed).toEqual(['air']);
  });
});
