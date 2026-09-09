// @vitest-environment jsdom
/**
 * The shared lazy-load readout (#188): renders every phase of the shared vocabulary
 * honestly — the message, the phase as a data attribute a panel test can pin, the
 * reason for `unavailable`, a progress bar only while loading with known progress,
 * and "off" whenever the enable control is off regardless of stale status.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { LoadStatusReadout } from '@/app/LoadStatusReadout';
import type { LoadStatus } from '@/lazy';

afterEach(cleanup);

const phaseOf = (el: HTMLElement) => el.closest('[data-load-phase]')?.getAttribute('data-load-phase');

describe('LoadStatusReadout', () => {
  it('shows the message and phase for a ready / active status', () => {
    render(<LoadStatusReadout status={{ phase: 'active', message: 'Playing' }} enabled />);
    const el = screen.getByText('Playing');
    expect(phaseOf(el)).toBe('active');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('says off (and reports phase off) when the enable control is off, whatever the status', () => {
    const stale: LoadStatus = { phase: 'error', message: 'Could not load' };
    render(<LoadStatusReadout status={stale} enabled={false} offMessage="Generative off" />);
    const el = screen.getByText('Generative off');
    expect(phaseOf(el)).toBe('off');
    expect(screen.queryByText('Could not load')).toBeNull();
  });

  it('exposes the reason for an unavailable status so a panel can react (a key prompt, a hint)', () => {
    render(
      <LoadStatusReadout status={{ phase: 'unavailable', reason: 'no-key', message: 'Add a Gemini API key' }} enabled />,
    );
    const el = screen.getByText('Add a Gemini API key');
    expect(el.closest('[data-load-reason]')?.getAttribute('data-load-reason')).toBe('no-key');
  });

  it('renders a progress bar only while loading with known progress', () => {
    const { rerender } = render(<LoadStatusReadout status={{ phase: 'loading', message: 'Loading model', progress: 0.4 }} enabled />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
    rerender(<LoadStatusReadout status={{ phase: 'loading', message: 'Connecting' }} enabled />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
