// @vitest-environment jsdom
/**
 * The real-versus-air routine is reachable from a cold load (#247): the tools bar opens
 * the Trainer, the routine chooser (in plain sight, not inside the collapsed picker)
 * offers it, and Start records a take with the microphone and counts the clicks.
 *
 * Clicks from a cold load: Trainer (1) → choose "Real vs air: taps" (2) → Start (3).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import ToolsBar from '@/app/ToolsBar';
import TrainerPanel from '@/app/TrainerPanel';
import { useTools } from '@/app/toolsStore';
import { useTrainer, useTrainerStores } from '@/app/enroll/store';
import { useTrainerPrefs } from '@/app/enroll/prefs';
import { createCueStore, createRoutineStore } from '@/app/enroll/cueStore';
import { STARTER_ROUTINES } from '@/app/enroll/realVsAirCues';
import { setClickPlayer } from '@thoremin/sdk-ui/enroll/click';
import { registerRecordingController, type RecordingController } from '@/app/recording/controller';
import type { RecordingSession } from '@/app/recording/schema';
import { createInMemoryProvider } from '@zodal/store';

const TAPS = STARTER_ROUTINES[0];

let unregister: () => void = () => undefined;
let started: { session: RecordingSession; meta?: Record<string, unknown> } | null = null;
let recordingOk = true;

beforeEach(() => {
  useTools.setState({ open: null });
  useTrainer.getState().reset();
  useTrainerStores({ cues: createCueStore(createInMemoryProvider([])), routines: createRoutineStore(createInMemoryProvider([])) });
  // The pref is OFF: a real-vs-air routine records anyway.
  useTrainerPrefs.setState({ recordTake: false, manualAdvance: false });
  setClickPlayer({ play: () => undefined, stop: () => undefined });
  started = null;
  recordingOk = true;
  let running = false;
  const fake: RecordingController = {
    start: async (session, opts) => {
      if (!recordingOk) return false;
      started = { session, meta: opts?.meta };
      opts?.tagSource?.beginTake({ t0: 0, startedAt: 'x', session: 's' });
      running = true;
      return true;
    },
    stop: async () => {
      running = false;
    },
    isRecording: () => running,
  };
  unregister = registerRecordingController(fake);
});
afterEach(() => {
  cleanup();
  unregister();
  setClickPlayer(null);
  useTrainerStores(null);
});

async function openAndChoose() {
  render(
    <>
      <ToolsBar />
      <TrainerPanel />
    </>,
  );
  fireEvent.click(screen.getByText('Trainer'));
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Choose a routine'), { target: { value: TAPS.id } });
  });
}

describe('the real-vs-air routine from a cold load (#247)', () => {
  it('is offered by the routine chooser and loads with what the player needs', async () => {
    await openAndChoose();
    expect(useTrainer.getState().routineName).toBe(TAPS.name);
    expect(useTrainer.getState().routine.map((c) => c.id)).toEqual(TAPS.cueIds);
    expect(document.querySelector('[data-routine-needs]')?.textContent).toContain('headphones');
    expect(document.querySelector('[data-pair-intro]')).toBeTruthy();
    // Nothing to build from a performance routine, and no record toggle to forget.
    expect(screen.queryByText('Find my categories')).toBeNull();
    expect(screen.getByText(/Always recorded/)).toBeTruthy();
  });

  it('Start records with the microphone and the cue specs, then counts the clicks', async () => {
    await openAndChoose();
    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });
    expect(started?.session.streams.microphone).toBe(true);
    expect(started?.session.streams.pureVideo).toBe(true);
    const meta = started?.meta as { trainer: { cues: { id: string }[] } };
    expect(meta.trainer.cues.map((c) => c.id)).toEqual(TAPS.cueIds);
    expect(useTrainer.getState().status).toBe('running');
    expect(document.querySelector('[data-compact]')?.textContent).toContain('get ready');
    // Past the lead-in, the first count-in click is due: the strip counts it.
    const t0 = performance.now();
    await act(async () => {
      useTrainer.getState().tick(t0 + 3100);
    });
    expect(document.querySelector('[data-beat]')?.textContent).toBe('count-in 1/4');
  });

  it('the chooser shows the loaded routine, also after a run (its value comes from the store)', async () => {
    await openAndChoose();
    const chooser = () => screen.getByLabelText('Choose a routine') as HTMLSelectElement;
    expect(chooser().value).toBe(TAPS.id);
    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Stop'));
    });
    // Unmounted while running, remounted after: still the taps routine, not the default.
    expect(chooser().value).toBe(TAPS.id);
    await act(async () => {
      fireEvent.change(chooser(), { target: { value: '' } });
    });
    expect(useTrainer.getState().routineName).toBe('Default');
  });

  it('does not start unrecorded: a refused recording leaves the routine idle and says why', async () => {
    recordingOk = false;
    await openAndChoose();
    await act(async () => {
      fireEvent.click(screen.getByText('Start'));
    });
    expect(useTrainer.getState().status).toBe('idle');
    expect(document.querySelector('[data-notice]')?.textContent).toMatch(/recorded/);
  });
});
