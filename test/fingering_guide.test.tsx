// @vitest-environment jsdom
/**
 * The fingering guide (#263): two hands from a finger list, down fingers marked, the
 * keys as caption, the class's other notes said; and the flute panel's guide draws the
 * PRIOR's fingering (the "one and one" Bb), not the chart's standard one.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { FingeringGuide, describeFingering } from '@thoremin/ext-air/app/FingeringGuide';
import { fluteGuide } from '@thoremin/ext-air/panels/airFlute';
import { DEFAULT_FINGERING_PRIOR } from '@thoremin/ext-air/lib/fingering_prior';

afterEach(cleanup);

describe('the fingering guide', () => {
  it('marks each finger down or up on both hands and captions the keys', () => {
    const { container } = render(<FingeringGuide label="G5" down={['LT', 'L1', 'L2', 'L3', 'R4']} keys={['Eb key']} alsoPlays={['G4']} />);
    const state = (id: string) => container.querySelector(`[data-finger="${id}"]`)?.getAttribute('data-state');
    expect(state('LT')).toBe('down');
    expect(state('L1')).toBe('down');
    expect(state('L4')).toBe('up');
    expect(state('R1')).toBe('up');
    expect(state('R4')).toBe('down');
    expect(container.querySelectorAll('[data-finger]')).toHaveLength(10);
    expect(screen.getByText('Eb key')).toBeTruthy();
    expect(screen.getByText(/also plays G4/)).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Fingering for G5: left thumb, index, middle, ring; right little');
  });

  it('a dim guide (the next target) drops the captions', () => {
    render(<FingeringGuide label="A5" down={['LT']} keys={['Eb key']} alsoPlays={['A4']} dim />);
    expect(screen.queryByText('Eb key')).toBeNull();
    expect(screen.queryByText(/also plays/)).toBeNull();
    expect(describeFingering([])).toBe('all fingers up');
  });

  it("the flute's guide draws what the prior listens for, and nothing for a note it does not know", () => {
    const bb = fluteGuide(DEFAULT_FINGERING_PRIOR, 'Bb5', false);
    expect(bb).not.toBeNull();
    const { container } = render(<>{bb}</>);
    // "One and one": right index down, which the thumb Bb would not have.
    expect(container.querySelector('[data-finger="R1"]')?.getAttribute('data-state')).toBe('down');
    expect(screen.getByText(/also plays A#4/)).toBeTruthy();
    expect(fluteGuide(DEFAULT_FINGERING_PRIOR, 'D6', false)).toBeNull();
    expect(fluteGuide(DEFAULT_FINGERING_PRIOR, 'Gmaj', false)).toBeNull();
    expect(fluteGuide({ ...DEFAULT_FINGERING_PRIOR, enabled: false }, 'G5', false)).toBeNull();
  });
});
