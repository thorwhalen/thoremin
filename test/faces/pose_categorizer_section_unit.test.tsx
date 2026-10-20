// @vitest-environment jsdom
/**
 * The instrument editor's "Pose categorizer" section (#384, #387 B5), rendered on its own with
 * the dials host and the categorizer collection mocked (`pose_play_shell.test.tsx` reaches it
 * through the whole shell): the saved pose categorizers listed and refreshed when one is saved
 * or deleted, an id this device does not have offered as such, "no saved poses yet", the
 * transport switch disabled with no categorizer, the summary of which pose states each role
 * (or the rule) while it plays, the readout's four phases, and both controls writing through
 * `dispatchDialSetIn`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({
  dial: undefined as undefined | Record<string, unknown>,
  setIn: vi.fn(),
  saved: [] as { id: string; name: string }[],
  listeners: new Set<() => void>(),
  failList: false,
}));
vi.mock('@thoremin/sdk-ui/dials', async (orig) => ({
  ...(await orig<object>()),
  useDialsSettings: () => ({ state: { effective: m.dial === undefined ? {} : { poseCategorizer: m.dial } } }),
  dispatchDialSetIn: m.setIn,
}));
vi.mock('@thoremin/sdk-ui/enroll/categorizers', async (orig) => ({
  ...(await orig<object>()),
  createCategorizerStore: () => ({ list: async () => (m.failList ? Promise.reject(new Error('idb')) : [...m.saved]) }),
  onCategorizersChanged: (l: () => void) => (m.listeners.add(l), () => void m.listeners.delete(l)),
}));
import PoseCategorizerSection, { PoseCategorizerReadout, transportSummary } from '@thoremin/ext-faces/panels/PoseCategorizerSection';
import { usePosePlay, type PosePlayState } from '@thoremin/ext-faces/app/posePlay';

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const play = (s: Partial<PosePlayState>) => usePosePlay.setState({ phase: 'none', id: null, name: null, categories: [], roles: {}, ...s });

beforeEach(() => {
  m.dial = undefined;
  m.setIn.mockReset();
  m.saved = [];
  m.failList = false;
  m.listeners.clear();
  play({});
});
afterEach(cleanup);

describe('the Pose categorizer section', () => {
  it('with nothing saved: no categorizer chosen, says how to record some, transport disabled', async () => {
    render(<PoseCategorizerSection />);
    await flush();
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect([...select.options].map((o) => o.textContent)).toEqual(['nothing (no pose categorizer)']);
    expect(screen.getByText(/No saved poses yet/)).toBeTruthy();
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
  });

  it('lists the saved ones, and refreshes when one is saved or deleted', async () => {
    m.saved = [{ id: 'body:a', name: 'My poses' }];
    render(<PoseCategorizerSection />);
    await flush();
    expect([...(screen.getByRole('combobox') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['nothing (no pose categorizer)', 'My poses']);
    expect(screen.queryByText(/No saved poses yet/)).toBeNull();
    m.saved = [...m.saved, { id: 'body:b', name: 'Conducting' }];
    for (const l of m.listeners) l();
    await flush();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('stops listening when it goes, and a list that fails shows nothing', async () => {
    m.failList = true;
    const { unmount } = render(<PoseCategorizerSection />);
    await flush();
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(m.listeners.size).toBe(1);
    unmount();
    expect(m.listeners.size).toBe(0);
  });

  it('an id this device does not have is offered as such', async () => {
    m.dial = { id: 'body:elsewhere', transport: false };
    render(<PoseCategorizerSection />);
    await flush();
    expect(screen.getByText('body:elsewhere (not on this device)')).toBeTruthy();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('body:elsewhere');
  });

  it('both controls write through the dial path', async () => {
    m.saved = [{ id: 'body:a', name: 'My poses' }];
    m.dial = { id: 'body:a', transport: false };
    render(<PoseCategorizerSection />);
    await flush();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(m.setIn.mock.calls).toEqual([
      ['poseCategorizer.id', ''],
      ['poseCategorizer.transport', true],
    ]);
  });

  it('while it plays the transport, it says which pose states each role and which the rule keeps', async () => {
    m.saved = [{ id: 'body:a', name: 'My poses' }];
    m.dial = { id: 'body:a', transport: true };
    play({ phase: 'ready', id: 'body:a', name: 'My poses', categories: [{ id: 'k1', name: 'ready' }, { id: 'k2', name: 'fermata' }], roles: { ready: 'k1', hold: 'k2' } });
    render(<PoseCategorizerSection />);
    await flush();
    expect(screen.getByText('start (ready): your "ready"; hold (fermata): your "fermata"; stop (cut-off): the rule')).toBeTruthy();
    cleanup();
    play({ phase: 'loading' });
    render(<PoseCategorizerSection />);
    await flush();
    expect(document.querySelector('[data-pose-transport-summary]')).toBeNull();
  });

  it('transportSummary with no roles is the rule throughout', () => {
    expect(transportSummary({ phase: 'ready', id: 'x', name: 'x', categories: [], roles: {} })).toBe('start (ready): the rule; hold (fermata): the rule; stop (cut-off): the rule');
  });
});

describe('the Pose categorizer readout', () => {
  it.each([
    [{ phase: 'ready', name: 'My poses' }, 'Reading your poses with My poses'],
    [{ phase: 'loading' }, 'Loading…'],
    [{ phase: 'missing' }, 'Not on this device: no poses are read'],
    [{ phase: 'none' }, 'No pose categorizer'],
  ] as const)('%o', (state, text) => {
    play(state as Partial<PosePlayState>);
    render(<PoseCategorizerReadout />);
    expect(document.querySelector('[data-poses-readout]')!.textContent).toBe(text);
  });
});
