// @vitest-environment jsdom
/**
 * The Instruments gallery (Round 4, #272, step 4): a second rendering of the same
 * collection. A card per instrument with its picture (or its emoji on its class's colour),
 * the same search and filters, a list/gallery toggle, and the last choice remembered.
 */
import { describe, it, expect, afterEach, beforeAll, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react';
import { createInMemoryProvider } from '@zodal/store';
import InstrumentsPanel from '@/app/dials/InstrumentsPanel';
import { resolvePicture } from '@/app/library/InstrumentPicture';
import {
  createInstrumentsViewStore,
  useInstrumentsView,
  type InstrumentsViewPrefs,
} from '@/app/library/instrumentsViewPrefs';
import { instrumentsCollection } from '@/app/library/instrumentsCollection';

beforeAll(() => localStorage.clear());
beforeEach(() => useInstrumentsView.setState({ view: 'list', collapsed: [] }));
afterEach(() => cleanup());

const loaded = () =>
  waitFor(() => expect(within(screen.getByRole('group', { name: 'Field instruments' })).getByText('Pentatonic')).toBeTruthy());

describe('the gallery view', () => {
  it('is a view the collection declares', () => {
    expect(instrumentsCollection.affordances.views).toEqual(['list', 'grid']);
  });

  it('the toggle switches to cards, with the same groups, and back', async () => {
    render(<InstrumentsPanel />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Gallery view' }));
    expect(screen.getByRole('button', { name: 'Gallery view' }).getAttribute('aria-pressed')).toBe('true');
    const air = screen.getByRole('group', { name: 'Air instruments' });
    const card = within(air).getByText('Air Drum').closest('li')!;
    // A card: a tile (no picture yet) above the name, and the star and the gear.
    expect(card.querySelector('.aspect-\\[16\\/10\\]')).toBeTruthy();
    expect(within(card).getByLabelText('Edit Air Drum')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    expect(within(screen.getByRole('group', { name: 'Air instruments' })).getByText('Air Drum').closest('li')!.querySelector('.aspect-\\[16\\/10\\]')).toBeNull();
  });

  it('keeps the search: a query narrows the cards the same way', async () => {
    render(<InstrumentsPanel />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Gallery view' }));
    fireEvent.change(screen.getByLabelText('Filter instruments'), { target: { value: 'flute' } });
    await waitFor(() =>
      expect([...document.querySelectorAll('li[data-instrument]')].map((li) => li.getAttribute('data-instrument'))).toEqual(['Air Flute']),
    );
  });

  it("shows an instrument's picture once it has one, set from its editor", async () => {
    render(<InstrumentsPanel />);
    await loaded();
    fireEvent.click(screen.getByLabelText('Edit Air Drum'));
    const field = await screen.findByLabelText('Picture (for the gallery)');
    fireEvent.change(field, { target: { value: 'instruments/air-drum.webp' } });
    fireEvent.click(within(document.querySelector('[data-picture-field]') as HTMLElement).getByRole('button', { name: 'Set' }));
    fireEvent.click(screen.getByLabelText('Back to instruments'));
    fireEvent.click(await screen.findByRole('button', { name: 'Gallery view' }));
    const img = await waitFor(() => {
      const el = document.querySelector('li[data-instrument="Air Drum"] img') as HTMLImageElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    expect(img.getAttribute('src')).toMatch(/instruments\/air-drum\.webp$/);
    // A picture that fails to load falls back to the tile.
    act(() => {
      img.dispatchEvent(new Event('error'));
    });
    await waitFor(() => expect(document.querySelector('li[data-instrument="Air Drum"] img')).toBeNull());
  });
});

describe('the choice is remembered', () => {
  it('a new visit (a new store over the same provider) opens on the view chosen last', async () => {
    const provider = createInMemoryProvider<InstrumentsViewPrefs>([], { idField: 'id' });
    const first = createInstrumentsViewStore(provider);
    await first.getState().hydrate(['field', 'air']);
    first.getState().setView('grid');
    first.getState().toggleCollapsed('air');
    await new Promise((r) => setTimeout(r, 0));
    const next = createInstrumentsViewStore(provider);
    await next.getState().hydrate(['field', 'air']);
    expect(next.getState().view).toBe('grid');
    expect(next.getState().collapsed).toEqual(['air']);
  });

  it('with nothing stored, opens on the collection\'s default view (the list)', async () => {
    const store = createInstrumentsViewStore(createInMemoryProvider<InstrumentsViewPrefs>([], { idField: 'id' }));
    await store.getState().hydrate(['field', 'air']);
    expect(store.getState().view).toBe('list');
  });
});

describe('picture references', () => {
  it('resolves an app-relative path against where the app is served, and leaves URLs alone', () => {
    expect(resolvePicture('instruments/a.webp', '/thoremin/')).toBe('/thoremin/instruments/a.webp');
    expect(resolvePicture('https://x.org/a.png', '/thoremin/')).toBe('https://x.org/a.png');
    expect(resolvePicture('data:image/png;base64,AA', '/thoremin/')).toBe('data:image/png;base64,AA');
    expect(resolvePicture('/abs/a.png', '/thoremin/')).toBe('/abs/a.png');
    expect(resolvePicture('HTTPS://x.org/a.png', '/thoremin/')).toBe('HTTPS://x.org/a.png');
  });
});

describe('a card without a picture still tells instruments apart', () => {
  it("shows its air instrument's emoji, else its initials", async () => {
    const { initialsOf } = await import('@/app/library/InstrumentPicture');
    expect(initialsOf('Wrist Theremin')).toBe('WT');
    expect(initialsOf('Pentatonic')).toBe('PE');
    expect(initialsOf('Bell & Strings')).toBe('BS');
    render(<InstrumentsPanel />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Gallery view' }));
    const tile = (name: string) => document.querySelector(`li[data-instrument="${name}"] .aspect-\\[16\\/10\\]`)?.textContent;
    await waitFor(() => expect(tile('Air Guitar')).toBe('🤘'));
    expect(tile('Wrist Theremin')).toBe('WT');
  });
});

describe('the picture loads the frontend-UX way', () => {
  it('shows a shimmer (aria-busy) until the picture loads, then fades it in', async () => {
    const { default: InstrumentPicture } = await import('@/app/library/InstrumentPicture');
    const { container, rerender } = render(<InstrumentPicture image="https://x.org/a.png" name="A" colour="red" />);
    const busy = () => container.querySelector('[aria-busy]')?.getAttribute('aria-busy');
    expect(busy()).toBe('true');
    const img = container.querySelector('img')!;
    expect(img.className).toMatch(/opacity-0/);
    expect(img.getAttribute('alt')).toBe(''); // decorative: the name is beside it
    act(() => {
      img.dispatchEvent(new Event('load'));
    });
    expect(busy()).toBe('false');
    expect(container.querySelector('img')!.className).toMatch(/opacity-100/);
    // A new source is a fresh element, loading again: the old picture never lingers.
    rerender(<InstrumentPicture image="https://x.org/b.png" name="A" colour="red" />);
    expect(busy()).toBe('true');
    expect(container.querySelector('img')!.getAttribute('src')).toBe('https://x.org/b.png');
  });
});

describe('the picture field', () => {
  it('refuses embedded pictures and over-long references (the record holds references, never bytes)', async () => {
    const { pictureRefProblem } = await import('@/app/dials/InstrumentsPanel');
    expect(pictureRefProblem('data:image/png;base64,AAAA')).toMatch(/not an embedded picture/);
    expect(pictureRefProblem('blob:https://x/1')).toMatch(/not an embedded picture/);
    expect(pictureRefProblem('javascript:alert(1)')).toBeTruthy();
    expect(pictureRefProblem('x'.repeat(3000))).toMatch(/Too long/);
    expect(pictureRefProblem('instruments/a.webp')).toBeUndefined();
    expect(pictureRefProblem('https://x.org/a.png')).toBeUndefined();
  });
});

describe('a card says what a row says', () => {
  it('marks the default instrument', async () => {
    localStorage.setItem('thoremin.instruments.default', 'Pentatonic');
    render(<InstrumentsPanel />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Gallery view' }));
    await waitFor(() => expect(document.querySelector('li[data-instrument="Pentatonic"]')?.textContent).toMatch(/\(default\)/));
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    expect(document.querySelector('li[data-instrument="Pentatonic"]')?.textContent).toMatch(/\(default\)/);
  });
});
