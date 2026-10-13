// @vitest-environment jsdom
/**
 * The take's lifecycle (`useRecordingController`, `src/app/recording/useRecordingController.ts`;
 * #391 item 2, extracted from `useEngine` by #392): start and stop through the registered
 * recording controller (the trainer's path) and through the Record button's sheet, with a fake
 * recorder and fake host refs, so no engine, camera or `MediaRecorder` is involved.
 *
 * Pinned: a take starts once and only once; a stop toasts what was written and releases the
 * recorder; a dismissed folder picker at start (`SinkCancelled`) is a quiet cancel that returns
 * the sheet, not an error (the sink only throws it where a picker exists: where none does,
 * `chooseSinkKind` already chose the zip); a sink that fails to open or to close is an error
 * toast; a dismissed Save-As is "not saved", never "Saved".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { Engine } from '@thoremin/dag';
import { useRecordingController, type RecordingHostRefs, type TakeRecorder } from '@/app/recording/useRecordingController';
import { recordingController } from '@/app/recording/controller';
import { SinkCancelled } from '@/app/recording/sink';
import type { RecordingResult, SessionRecorderDeps } from '@/app/recording/session';
import { DEFAULT_RECORDING_SESSION, type RecordingSession } from '@/app/recording/schema';
import { useRecordingConfig } from '@/app/recording/configStore';
import { useToasts } from '@/app/toasts';

const SAVED: RecordingResult = { label: 'take-1', count: 3, viaPicker: true, failedFormats: [], streamCount: 2 };

/** A recorder whose start and stop do what the test says, watching its own disposal. */
function fakeRecorder({ start = async () => undefined, stop = async () => SAVED }: { start?: () => Promise<void>; stop?: () => Promise<RecordingResult> } = {}) {
  return { start: vi.fn(start), stop: vi.fn(stop), dispose: vi.fn(), elapsedMs: 0 } satisfies TakeRecorder;
}

/** The host's refs, as the engine hook hands them in once audio runs and the camera is up. */
function hostRefs(over: Partial<{ audio: boolean }> = {}): RecordingHostRefs {
  const audio = over.audio ?? true;
  return {
    resources: { current: audio ? { audioContext: { state: 'running' } } : {} },
    masterGain: { current: audio ? ({} as AudioNode) : null },
    canvas: { current: document.createElement('canvas') },
    video: { current: document.createElement('video') },
    engine: { current: {} as Engine },
    cameraStream: { current: null },
  };
}

/** Mount the hook with `recorder` as the one it builds; returns what the factory was handed. */
function mount(recorder: TakeRecorder, refs: RecordingHostRefs = hostRefs()) {
  const built: { deps: SessionRecorderDeps; session: RecordingSession }[] = [];
  const createRecorder = vi.fn((deps: SessionRecorderDeps, session: RecordingSession) => {
    built.push({ deps, session });
    return recorder;
  });
  const hook = renderHook(() => useRecordingController(refs, { createRecorder }));
  return { ...hook, built, createRecorder };
}

const toasts = () => useToasts.getState().toasts.map((t) => ({ message: t.message, level: t.level }));

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  useToasts.setState({ toasts: [] });
  useRecordingConfig.getState().setSession(DEFAULT_RECORDING_SESSION);
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  consoleError.mockRestore();
});

describe('a take through the recording controller (the trainer path)', () => {
  it('starts once, with the host resources, and the HUD shows it recording', async () => {
    const rec = fakeRecorder();
    const { result, built } = mount(rec);
    let ok = false;
    await act(async () => {
      ok = await recordingController().start(DEFAULT_RECORDING_SESSION, { instrument: 'trainer', meta: { routine: 'r1' } });
    });
    expect(ok).toBe(true);
    expect(rec.start).toHaveBeenCalledOnce();
    expect(built).toHaveLength(1);
    expect(built[0].deps.instrument).toBe('trainer');
    expect(built[0].deps.meta).toEqual({ routine: 'r1' });
    expect(built[0].deps.audioContext).toEqual({ state: 'running' });
    expect(result.current.recording.phase).toBe('recording');
    expect(recordingController().isRecording()).toBe(true);

    // One take at a time, whichever surface asks.
    let again = true;
    await act(async () => {
      again = await recordingController().start(DEFAULT_RECORDING_SESSION);
    });
    expect(again).toBe(false);
    expect(built).toHaveLength(1);
    expect(toasts()).toContainEqual({ message: 'Already recording — stop the current take first', level: 'error' });
  });

  it('stops: writes, toasts what landed, releases the recorder and goes idle', async () => {
    const rec = fakeRecorder();
    const { result } = mount(rec);
    await act(async () => void (await recordingController().start(DEFAULT_RECORDING_SESSION)));
    await act(async () => recordingController().stop());
    expect(rec.stop).toHaveBeenCalledOnce();
    expect(rec.dispose).toHaveBeenCalledOnce();
    expect(toasts()).toEqual([{ message: 'Saved take-1 (3 files)', level: 'info' }]);
    expect(result.current.recording.phase).toBe('idle');
    expect(recordingController().isRecording()).toBe(false);
  });

  it('a take that records audio is refused, with a reason, before audio runs', async () => {
    const rec = fakeRecorder();
    const { createRecorder } = mount(rec, hostRefs({ audio: false }));
    let ok = true;
    await act(async () => {
      ok = await recordingController().start(DEFAULT_RECORDING_SESSION);
    });
    expect(ok).toBe(false);
    expect(createRecorder).not.toHaveBeenCalled();
    expect(toasts()).toEqual([{ message: 'Start audio before recording', level: 'error' }]);
  });

  it('a sink that fails to open is an error toast; a controller-started take never pops the sheet', async () => {
    const rec = fakeRecorder({ start: async () => Promise.reject(new Error('disk full')) });
    const { result } = mount(rec);
    let ok = true;
    await act(async () => {
      ok = await recordingController().start(DEFAULT_RECORDING_SESSION);
    });
    expect(ok).toBe(false);
    expect(rec.dispose).toHaveBeenCalledOnce();
    expect(toasts()).toEqual([{ message: "Couldn't start recording", level: 'error' }]);
    expect(result.current.recording.phase).toBe('idle');
    expect(recordingController().isRecording()).toBe(false);
  });

  it('a sink that fails to close is an error toast, and the recorder is still released', async () => {
    const rec = fakeRecorder({ stop: async () => Promise.reject(new Error('write failed')) });
    const { result } = mount(rec);
    await act(async () => void (await recordingController().start(DEFAULT_RECORDING_SESSION)));
    await act(async () => recordingController().stop());
    expect(rec.dispose).toHaveBeenCalledOnce();
    expect(toasts()).toEqual([{ message: "Couldn't save the recording", level: 'error' }]);
    expect(result.current.recording.phase).toBe('idle');
  });
});

describe('a take from the Record button sheet', () => {
  it('a dismissed folder picker (SinkCancelled) is a quiet cancel that returns to the sheet', async () => {
    const rec = fakeRecorder({ start: async () => Promise.reject(new SinkCancelled()) });
    const { result } = mount(rec);
    act(() => result.current.recording.open('theremin'));
    expect(result.current.recording.phase).toBe('settings');
    expect(result.current.recording.session.name).toMatch(/theremin/);
    await act(async () => result.current.recording.recNow());
    expect(rec.dispose).toHaveBeenCalledOnce();
    expect(toasts()).toEqual([{ message: 'Recording cancelled', level: 'info' }]);
    expect(consoleError).not.toHaveBeenCalled();
    expect(result.current.recording.phase).toBe('settings');
    expect(recordingController().isRecording()).toBe(false);
  });

  it('a dismissed Save-As at the end says nothing was saved, never "Saved"', async () => {
    const rec = fakeRecorder({ stop: async () => ({ ...SAVED, cancelled: true }) });
    const { result } = mount(rec);
    act(() => result.current.recording.open());
    await act(async () => result.current.recording.recNow());
    expect(result.current.recording.phase).toBe('recording');
    await act(async () => result.current.recording.stop());
    expect(toasts()).toEqual([{ message: 'Recording not saved (save cancelled)', level: 'error' }]);
  });

  it('a format that failed to encode is named, and the rest of the take is still "Saved"', async () => {
    const rec = fakeRecorder({ stop: async () => ({ ...SAVED, failedFormats: ['flac'] }) });
    const { result } = mount(rec);
    await act(async () => result.current.recording.recNow());
    await act(async () => result.current.recording.stop());
    expect(toasts()).toEqual([
      { message: "Couldn't encode FLAC — that file was not saved", level: 'error' },
      { message: 'Saved take-1 (3 files)', level: 'info' },
    ]);
  });
});

describe('the engine teardown', () => {
  it('releaseTake drops a running take with the engine it records', async () => {
    const rec = fakeRecorder();
    const { result } = mount(rec);
    await act(async () => void (await recordingController().start(DEFAULT_RECORDING_SESSION)));
    act(() => result.current.releaseTake());
    expect(rec.dispose).toHaveBeenCalledOnce();
    expect(recordingController().isRecording()).toBe(false);
  });

  it('unmounting mid-take unregisters the controller and stops the HUD ticker; releaseTake disposes the take', async () => {
    vi.useFakeTimers();
    try {
      let reads = 0;
      const rec = { ...fakeRecorder(), get elapsedMs() {
        reads += 1;
        return 1234;
      } };
      const { result, unmount } = mount(rec);
      await act(async () => void (await recordingController().start(DEFAULT_RECORDING_SESSION)));
      expect(recordingController().isRecording()).toBe(true);
      await act(async () => void vi.advanceTimersByTime(600));
      expect(reads).toBeGreaterThan(0);
      expect(result.current.recording.elapsedMs).toBe(1234);
      const { releaseTake } = result.current;
      unmount();
      expect(recordingController().isRecording()).toBe(false);
      reads = 0;
      vi.advanceTimersByTime(2000);
      expect(reads).toBe(0);
      // The engine's teardown (useEngine's build-effect cleanup) drops the take it was recording.
      releaseTake();
      expect(rec.dispose).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('unmounting unregisters the controller: a later start builds nothing', async () => {
    const { unmount, createRecorder } = mount(fakeRecorder());
    unmount();
    expect(await recordingController().start(DEFAULT_RECORDING_SESSION)).toBe(false);
    expect(createRecorder).not.toHaveBeenCalled();
    expect(toasts()).toEqual([]);
  });
});
