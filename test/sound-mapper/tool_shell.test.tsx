// @vitest-environment jsdom
/**
 * The Sound mapper tool is reachable from a cold load (the shipping rule): Tools, then Sound
 * mapper, opens its panel; Add a sound adds a row with a drum; Play waits for a taught sound.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import ToolsBar from '@/app/tools/ToolsBar';
import ToolsLauncher from '@/app/tools/ToolsLauncher';
import ExtensionToolPanels from '@/app/tools/ExtensionToolPanels';
import { useTools } from '@/app/tools/toolsStore';
import { useToolPins } from '@/app/tools/toolPins';
import { TOOL_PINS_STORAGE_KEY } from '@/app/tools/toolsCollection';
import { useSoundMapper } from '@/slices/sound-mapper/app/store';
import { EMPTY_SOUND_MAP } from '@/slices/sound-mapper/schema';
import { describeInput } from '@/slices/sound-mapper/panels/SoundMapperPanel';
import { SOUND_MAPPER } from '../helpers/extensions';

const Shell = () => (
  <>
    <ToolsBar />
    <ToolsLauncher />
    <ExtensionToolPanels />
  </>
);

beforeEach(() => {
  useTools.setState({ open: null, independentOpen: {}, launcherOpen: false });
  localStorage.removeItem(TOOL_PINS_STORAGE_KEY);
  useToolPins.setState({ choices: {} });
  useSoundMapper.setState({ map: EMPTY_SOUND_MAP, playing: false, teaching: null, hits: [] });
});
afterEach(cleanup);

describe.runIf(SOUND_MAPPER)('the Sound mapper tool', () => {
  it('opens from a cold load in two clicks: Tools, then Sound mapper', async () => {
    render(<Shell />);
    fireEvent.click(screen.getByText('Tools'));
    const row = await screen.findByText('Sound mapper', { selector: '[role=dialog] span' });
    act(() => {
      fireEvent.click(row.closest('button, a')!);
    });
    expect(useTools.getState().open).toBe('sound-mapper');
    expect(screen.getByTestId('sound-mapper-panel')).toBeTruthy();
  });

  it('adds a sound with its own drum, and Play waits until one is taught', () => {
    useTools.setState({ open: 'sound-mapper' });
    render(<Shell />);
    const play = screen.getByText('Play') as HTMLButtonElement;
    expect(play.disabled).toBe(true);
    fireEvent.click(screen.getByText('Add a sound'));
    fireEvent.click(screen.getByText('Add a sound'));
    const rows = screen.getAllByTestId('sound-class');
    expect(rows).toHaveLength(2);
    const drums = useSoundMapper.getState().map.classes.map((c) => c.sound);
    expect(new Set(drums).size).toBe(2);
    expect((screen.getByText('Play') as HTMLButtonElement).disabled).toBe(true);
  });

  it('says what the microphone is doing in plain words', () => {
    const base = { source: 'microphone' as const, sampleRate: 48000, constraints: null, inputStage: { seconds: 0.01, source: 'prior' as const }, device: null, error: null, dropped: 0 };
    expect(describeInput({ ...base, state: 'waiting-audio' })).toMatch(/start the sound/);
    expect(describeInput({ ...base, state: 'denied' })).toMatch(/refused/);
    expect(describeInput({ ...base, state: 'live', device: 'MacBook Microphone' })).toBe('Listening (MacBook Microphone).');
    expect(describeInput(null)).toBeNull();
  });
});
