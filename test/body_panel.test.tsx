// @vitest-environment jsdom
/**
 * Body panel reachability (#186) — the UI half of the guard. The DAG-edge test
 * (app_graph.test.ts) proves the body node's output reaches the overlay; this proves
 * a player can FIND the control: the settings panel mounts a Body section with the
 * tracking toggle, and the model selector is disabled until tracking is on. Without
 * this, deleting the panel section keeps every other test green — the #119/#120
 * failure mode the shipping rule exists for.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import DialsControlsPanel from '@/app/dials/DialsControlsPanel';
import { BodyControls } from '@/app/dials/panels/body';

afterEach(() => cleanup());

describe('the settings panel mounts the Body section (#186 reachability)', () => {
  it('renders a Body section', () => {
    render(<DialsControlsPanel />);
    expect(screen.getByText('Body')).toBeTruthy();
  });
});

describe('BodyControls', () => {
  it('renders the tracking toggle, off by default, with the model selector disabled and sized', () => {
    render(<BodyControls />);
    const toggle = screen.getByLabelText('Track the body') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    const select = screen.getByLabelText('Model') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    // The download cost is stated before the player triggers it (the lazy-loading rule).
    expect(screen.getByText(/5\.8 MB/)).toBeTruthy();
    expect(screen.getByText(/9\.4 MB/)).toBeTruthy();
  });
});
