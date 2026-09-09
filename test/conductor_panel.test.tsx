// @vitest-environment jsdom
/**
 * Conductor panel reachability (#187) — the UI half of the guard. The DAG-edge test
 * (app_graph.test.ts) proves the dial reaches the node and the score reaches the merge;
 * this proves a player can FIND the control: the settings panel mounts a Conductor
 * section with the on/off toggle, off by default, and the hand / point choosers are
 * disabled until it is on. Deleting the panel section would keep every other test
 * green — the #119/#120 failure mode the shipping rule exists for.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import DialsControlsPanel from '@/app/dials/DialsControlsPanel';
import { ConductorControls } from '@/app/dials/panels/conductor';

afterEach(() => cleanup());

describe('the settings panel mounts the Conductor section (#187 reachability)', () => {
  it('renders a Conductor section', () => {
    render(<DialsControlsPanel />);
    expect(screen.getByText('Conductor')).toBeTruthy();
  });
});

describe('ConductorControls', () => {
  it('renders the toggle, off by default, with the hand and point choosers disabled', () => {
    render(<ConductorControls />);
    const toggle = screen.getByLabelText('Conduct the score') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    const hand = screen.getByLabelText('Beating hand') as HTMLSelectElement;
    expect(hand.disabled).toBe(true);
    const point = screen.getByLabelText('Follow') as HTMLSelectElement;
    expect(point.disabled).toBe(true);
    // The copy says what happens when you stop beating (the hold state).
    expect(screen.getByText(/Stop beating and it holds/)).toBeTruthy();
  });
});
