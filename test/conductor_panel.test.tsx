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
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import DialsControlsPanel from '@/app/dials/DialsControlsPanel';
import { ConductorControls } from '@/app/dials/panels/conductor';
import { dialsStore } from '@/app/dials/settingsStore';
import type { ConductorSettings } from '@/settings/schema';

const conductor = () => dialsStore.getState().effective.conductor as ConductorSettings;
const drain = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

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

  it('offers the built-in scale, the shipped demos and a file picker, and the piece chooser dispatches', async () => {
    render(<ConductorControls />);
    const piece = screen.getByLabelText('Piece') as HTMLSelectElement;
    const labels = Array.from(piece.options).map((o) => o.textContent ?? '');
    expect(labels.some((l) => /Built-in scale/.test(l))).toBe(true);
    expect(labels.some((l) => /Beethoven/.test(l))).toBe(true);
    expect(labels.some((l) => /Haydn/.test(l))).toBe(true);
    expect(screen.getByLabelText(/Load a MIDI or MusicXML file/)).toBeTruthy();
    fireEvent.change(piece, { target: { value: 'haydn-op76-3' } });
    await drain();
    expect(conductor().piece).toBe('haydn-op76-3');
    fireEvent.change(piece, { target: { value: 'beethoven-symphony-5-1' } });
    await drain();
    expect(conductor().piece).toBe('beethoven-symphony-5-1');
  });

  it('the toggle and the hand chooser dispatch into the dial (the leaf paths are real)', async () => {
    render(<ConductorControls />);
    expect(conductor().enabled).toBe(false);
    fireEvent.click(screen.getByLabelText('Conduct the score'));
    await drain();
    expect(conductor().enabled).toBe(true);
    const hand = screen.getByLabelText('Beating hand') as HTMLSelectElement;
    expect(hand.disabled).toBe(false);
    fireEvent.change(hand, { target: { value: 'left' } });
    await drain();
    expect(conductor().hand).toBe('left');
    // Restore for the other tests.
    fireEvent.click(screen.getByLabelText('Conduct the score'));
    await drain();
    expect(conductor().enabled).toBe(false);
  });
});
