// @vitest-environment jsdom
/**
 * The Instruments view, option B of #272: one search over name, class, tags, what an
 * instrument uses and its summary, saying why a row matched; and facet chips with live
 * counts (from @zodal/groups-core) behind a Filters toggle that stays open while a filter
 * is on.
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import InstrumentsPanel from '@/app/dials/InstrumentsPanel';
import { assembleSpec } from '@/app/graph';
import { branchLabel, listingOf, whyMatched } from '@/app/library/instrumentsListing';
import { AIR } from './helpers/extensions';

beforeAll(() => localStorage.clear());
afterEach(() => cleanup());

const loaded = () =>
  waitFor(() => expect(within(screen.getByRole('group', { name: 'Field instruments' })).getByText('Pentatonic')).toBeTruthy());
const rowNames = () => [...document.querySelectorAll('li[data-instrument]')].map((li) => li.getAttribute('data-instrument'));

describe('the listing (pure)', () => {
  const spec = assembleSpec({
    name: 'Wrist Theremin',
    layer: {},
    derived: { class: 'field', branches: ['field-voices', 'face-chord'] },
  });
  const l = listingOf(spec, {
    customTags: [{ id: 'calm', label: 'calm', emoji: '🌿' }],
    systemTags: [{ id: 'sys:note:wrist', label: 'Wrist-controlled notes', emoji: '🤚' }],
    summary: [{ label: 'Note source', value: 'wrist' }],
  });

  it('searches the values (class, tags, summary, what it uses), without the label words', () => {
    const lines = l.item.searchText.split('\n');
    expect(lines).toEqual(expect.arrayContaining(['Field', 'calm', 'Wrist-controlled notes', 'wrist', 'Face chord']));
    expect(l.item.searchText).not.toMatch(/class:|tag:|uses:/);
  });

  it('says why a row matched when the name did not, most specific first, and nothing when it did', () => {
    expect(whyMatched('Wrist Theremin', l.reasons, 'calm')).toBe('tag: calm');
    expect(whyMatched('Wrist Theremin', l.reasons, 'chord')).toBe('uses: face chord');
    expect(whyMatched('Wrist Theremin', l.reasons, 'fie')).toBe('class: Field');
    expect(whyMatched('Wrist Theremin', l.reasons, 'wrist')).toBeUndefined();
    expect(whyMatched('Wrist Theremin', l.reasons, '')).toBeUndefined();
  });

  it('files it under its facets, leaving out uses another facet already states', () => {
    expect(l.facet.values.class?.[0]?.id).toBe('field');
    expect(l.facet.values.uses?.map((u) => u.id)).toEqual(expect.arrayContaining(['face-chord']));
    expect(l.facet.values.uses?.map((u) => u.id)).not.toContain('field-voices');
    expect(l.facet.values.star).toEqual([]);
  });

  it('labels a branch from its id', () => {
    expect(branchLabel('face-chord')).toBe('Face chord');
  });
});

describe('search in the view', () => {
  it('finds instruments by what they are, and says why in the row', async () => {
    render(<InstrumentsPanel />);
    await loaded();
    fireEvent.change(screen.getByLabelText('Filter instruments'), { target: { value: 'wrist-controlled' } });
    await waitFor(() => expect(rowNames()).toContain('Open Air Pad'));
    expect(rowNames()).not.toContain('Pentatonic');
    const row = document.querySelector('li[data-instrument="Open Air Pad"]')!;
    expect(row.textContent).toMatch(/Wrist-controlled notes/);
  });

  it('does not match the label words themselves ("class", "tag")', async () => {
    render(<InstrumentsPanel />);
    await loaded();
    fireEvent.change(screen.getByLabelText('Filter instruments'), { target: { value: 'class' } });
    await waitFor(() => expect(rowNames()).toEqual([]));
  });
});

describe('filter chips', () => {
  it.runIf(AIR)('a selected chip whose value disappears stays, so the filter can be seen and undone', async () => {
    render(<InstrumentsPanel />);
    await loaded();
    fireEvent.click(screen.getByLabelText('Favorite Pentatonic'));
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    const byStar = await screen.findByRole('group', { name: 'Filter by starred' });
    fireEvent.click(within(byStar).getByRole('button', { name: /Starred/ }));
    await waitFor(() => expect(rowNames()).toEqual(['Pentatonic']));
    fireEvent.click(screen.getByLabelText('Unfavorite Pentatonic'));
    await waitFor(() => expect(rowNames()).toEqual([]));
    const chip = within(screen.getByRole('group', { name: 'Filter by starred' })).getByRole('button');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip);
    await waitFor(() => expect(rowNames().length).toBe(17));
  });

  it.runIf(AIR)('are behind a Filters toggle, with a chip per class and live counts', async () => {
    render(<InstrumentsPanel />);
    await loaded();
    expect(document.querySelector('[data-instrument-filters]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    const byClass = screen.getByRole('group', { name: 'Filter by class' });
    const air = within(byClass).getByRole('button', { name: /Air/ });
    const field = within(byClass).getByRole('button', { name: /Field/ });
    expect(air.textContent).toMatch(/^Air\s*4$/);
    expect(field.textContent).toMatch(/^Field\s*13$/);
  });

  it.runIf(AIR)('narrow the list; the class chips keep their counts; the toggle stays open while one is on', async () => {
    render(<InstrumentsPanel />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    const byClass = screen.getByRole('group', { name: 'Filter by class' });
    fireEvent.click(within(byClass).getByRole('button', { name: /Air/ }));
    await waitFor(() => expect(rowNames()).toEqual(['Air Drum', 'Air Bass', 'Air Guitar', 'Air Flute']));
    // The N+1 rule: the unpicked class chip still says how many it would add.
    expect(within(screen.getByRole('group', { name: 'Filter by class' })).getByRole('button', { name: /Field/ }).textContent).toMatch(/13/);
    // Closing the toggle does not hide an active filter.
    fireEvent.click(screen.getByRole('button', { name: /Filters 1/ }));
    expect(document.querySelector('[data-instrument-filters]')).toBeTruthy();
    // Class chips keep their order whatever the counts (Field first, the registry's order).
    const order = within(screen.getByRole('group', { name: 'Filter by class' }))
      .getAllByRole('button')
      .map((b) => b.textContent?.replace(/[^A-Za-z]/g, ''));
    expect(order).toEqual(['Field', 'Air']);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(rowNames().length).toBe(17));
  });
});
