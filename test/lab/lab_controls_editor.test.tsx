// @vitest-environment jsdom
/**
 * The Feature Lab's controls (#119, #150), the two parts no test reached: the derived-feature
 * editor (a formula validated live with the engine's own safe compiler: empty, invalid and valid
 * said apart, a taken id refused, Add only when both are good, remove) and the saved views (save
 * under a name, load it back into the config, delete it). Rendered over an in-memory controls
 * host whose per-device prefs the Lab writes (`setLab`), so the assertions read the config the
 * meters would read.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { provideControls, type ControlsHost } from '@thoremin/sdk-ui/host';
import LabControls from '@/slices/lab/panels/LabControls';
import { labConfig } from '@/slices/lab/app/state';
import { defaultFeatureLab, LAB_PREF } from '@/slices/lab/schema';
import { LAB } from '../helpers/extensions';

/** The hot store's prefs, seeded as the app seeds them (`labConfig` reads a fresh default while
 *  the pref is absent, which a `useSyncExternalStore` reader would see as a change every render). */
function host(): ControlsHost {
  let state: Record<string, unknown> = { [LAB_PREF]: defaultFeatureLab() };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    setTransient: () => {},
    setHush: () => {},
    setPref: (key, value) => {
      state = { ...state, [key]: value };
      for (const l of [...listeners]) l();
    },
    subscribe: (l) => (listeners.add(l), () => void listeners.delete(l)),
  };
}

beforeEach(() => {
  localStorage.clear();
  provideControls(host());
});
afterEach(cleanup);

/** Render, and let the saved views' first listing settle. */
const show = async () => {
  render(<LabControls />);
  await act(async () => {});
};

const idBox = () => screen.getByPlaceholderText('id') as HTMLInputElement;
const formulaBox = () => screen.getByPlaceholderText(/^formula, e\.g\./) as HTMLInputElement;
const addButton = () => screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement;

describe.runIf(LAB)('the Lab derived-feature editor', () => {
  it('lists every helper, the stateful ones included', async () => {
    await show();
    for (const helper of ['clamp', 'residual', 'deconfound', 'unwrap']) expect(screen.getAllByText(new RegExp(`\\b${helper}\\b`)).length).toBeGreaterThan(0);
  });

  it('validates a formula as it is typed, and adds it only with a free id', async () => {
    await show();
    expect(addButton().disabled).toBe(true);
    fireEvent.change(formulaBox(), { target: { value: '   ' } });
    expect(screen.getByText('Empty formula')).toBeTruthy();
    fireEvent.change(formulaBox(), { target: { value: 'no_such_feature * 2' } });
    expect(screen.queryByText('✓ valid')).toBeNull();
    expect(addButton().disabled).toBe(true);
    fireEvent.change(formulaBox(), { target: { value: 'clamp(face_geom_mouth_openness * 2, 0, 1)' } });
    expect(screen.getByText('✓ valid')).toBeTruthy();
    expect(addButton().disabled).toBe(true); // no id yet
    fireEvent.change(idBox(), { target: { value: ' mouth2 ' } });
    expect(addButton().disabled).toBe(false);
    fireEvent.click(addButton());
    expect(labConfig().derived).toEqual([{ id: 'mouth2', formula: 'clamp(face_geom_mouth_openness * 2, 0, 1)' }]);
    expect(idBox().value).toBe('');
    expect(formulaBox().value).toBe('');
    expect(screen.getByTitle('mouth2')).toBeTruthy();
  });

  it('refuses an id that is taken, and removes one', async () => {
    await show();
    fireEvent.change(idBox(), { target: { value: 'a' } });
    fireEvent.change(formulaBox(), { target: { value: 'face_geom_mouth_openness' } });
    fireEvent.click(addButton());
    fireEvent.change(idBox(), { target: { value: 'a' } });
    fireEvent.change(formulaBox(), { target: { value: 'face_geom_mouth_openness + 1' } });
    expect(screen.getByText('That id already exists.')).toBeTruthy();
    expect(addButton().disabled).toBe(true);
    fireEvent.click(screen.getByTitle('a').parentElement!.querySelector('button')!);
    expect(labConfig().derived).toEqual([]);
  });
});

describe.runIf(LAB)('the Lab saved views', () => {
  it('saves the view under a name, loads it back, and deletes it', async () => {
    await show();
    expect(screen.getByText('No saved views yet.')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const before = labConfig();
    const columns = before.columns === 3 ? 5 : 3;
    act(() => fireEvent.change(document.querySelector('input[type=range]')!, { target: { value: String(columns) } }));
    expect(labConfig().columns).toBe(columns);
    fireEvent.change(screen.getByPlaceholderText('view name'), { target: { value: '  my view ' } });
    await act(async () => void fireEvent.click(save));
    await waitFor(() => expect(screen.getByTitle('my view')).toBeTruthy());
    expect((screen.getByPlaceholderText('view name') as HTMLInputElement).value).toBe('');
    // Change the config, then load the view back: its columns return.
    act(() => fireEvent.change(document.querySelector('input[type=range]')!, { target: { value: String(before.columns) } }));
    expect(labConfig().columns).toBe(before.columns);
    const row = screen.getByTitle('my view').parentElement!;
    await act(async () => void fireEvent.click(row.querySelector('button')!));
    await waitFor(() => expect(labConfig().columns).toBe(columns));
    await act(async () => void fireEvent.click(row.querySelectorAll('button')[1]));
    await waitFor(() => expect(screen.getByText('No saved views yet.')).toBeTruthy());
  });
});
