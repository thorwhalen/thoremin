// @vitest-environment jsdom
/**
 * The Replay tool is reachable (Tools, then Replay: two clicks from a cold load), loads a take the
 * player picks, and once a take plays, the bar shows it running with a way to stop it even with the
 * panel closed (a detached tool's way out).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import ToolsBar from '@/app/tools/ToolsBar';
import ToolsLauncher from '@/app/tools/ToolsLauncher';
import ReplayPanel from '@/app/replay/ReplayPanel';
import { useReplay } from '@/app/replay/replayStore';
import { useTools } from '@/app/tools/toolsStore';
import { loadRecords } from '../helpers/fixtures';

afterEach(() => {
  cleanup();
  act(() => {
    useReplay.getState().clear();
    useTools.setState({ open: null, launcherOpen: false });
  });
});

const take = () => new File([loadRecords('conducting_44', 'src.hands').map((r) => JSON.stringify(r)).join('\n')], 'take.ndjson');

describe('the Replay tool', () => {
  it('opens from the launcher, plays a picked take, and the bar stops it with the panel closed', async () => {
    render(
      <>
        <ToolsBar />
        <ToolsLauncher />
        <ReplayPanel />
      </>,
    );
    fireEvent.click(screen.getByText('Tools'));
    fireEvent.click((await screen.findByText("Replay", { selector: "[role=dialog] span" })).closest("button, a")!);
    expect(useTools.getState().open).toBe('replay');
    const input = document.querySelector('[data-replay-file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [take()] } });
    await waitFor(() => expect(document.querySelector('[data-replay-status="playing"]')).toBeTruthy());
    expect(useReplay.getState().replay?.frames.length).toBe(405);
    // Closed panel: the replay goes on, and the bar carries its stop control.
    act(() => useTools.getState().close());
    expect(document.querySelector('[data-replay-panel]')).toBeNull();
    const running = document.querySelector('[data-running="replay"]');
    expect(running).toBeTruthy();
    const stop = document.querySelector('[data-tools-bar] [data-stop-tool="replay"]') as HTMLElement | null;
    expect(stop).toBeTruthy();
    fireEvent.click(stop!);
    expect(useReplay.getState().replay).toBeNull();
  });

  it('says why a file is refused', async () => {
    act(() => useTools.setState({ open: 'replay' }));
    render(<ReplayPanel />);
    fireEvent.change(document.querySelector('[data-replay-file]')!, { target: { files: [new File(['hello'], 'notes.txt')] } });
    await waitFor(() => expect(document.querySelector('[data-replay-status="error"]')?.textContent).toMatch(/no hand frames/));
    expect(useReplay.getState().replay).toBeNull();
  });
});
