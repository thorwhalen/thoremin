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
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { dialsStore } from '@/app/dials/settingsStore';
import type { BodyMap } from '@/nodes/mapping/body_map';
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

  it('renders the body → sound routing: four route slots, each a feature and a target select (#186 PR E)', () => {
    render(<BodyControls />);
    expect(screen.getByText('Body → sound')).toBeTruthy();
    for (const slot of ['a', 'b', 'c', 'd']) {
      expect(screen.getByLabelText(`Route ${slot} feature`)).toBeTruthy();
      expect(screen.getByLabelText(`Route ${slot} target`)).toBeTruthy();
    }
    // The feature list is the body catalog, grouped; the target list is the effect vocabulary + Volume.
    const feature = screen.getByLabelText('Route a feature') as HTMLSelectElement;
    expect(Array.from(feature.options).some((o) => o.value === 'body.kin.qom')).toBe(true);
    const target = screen.getByLabelText('Route a target') as HTMLSelectElement;
    expect(Array.from(target.options).map((o) => o.value)).toEqual(['none', 'brightness', 'vibrato', 'pan', 'pitchBend', 'octave', 'gate', 'gain']);
  });

  it('picking a feature actually lands in the dial (through dial.patch), seeding the range from the catalog', () => {
    render(<BodyControls />);
    fireEvent.change(screen.getByLabelText('Route a feature'), { target: { value: 'body.angle.elbow.left' } });
    const route = (dialsStore.getState().effective.bodyMap as BodyMap).routes.a;
    expect(route.feature).toBe('body.angle.elbow.left');
    expect(route.inMin).toBe(0);
    expect(route.inMax).toBe(180);
    fireEvent.change(screen.getByLabelText('Route a target'), { target: { value: 'vibrato' } });
    expect((dialsStore.getState().effective.bodyMap as BodyMap).routes.a.target).toBe('vibrato');
  });
});
