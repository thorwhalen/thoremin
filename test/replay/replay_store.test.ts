/**
 * The replay store: a file over the size limit is refused before it is read, and of two loads in
 * flight only the latest lands (Stop lands none).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { useReplay } from '@/app/replay/replayStore';
import { MAX_RECORDING_CHARS } from '@/app/replay/handRecording';
import { loadRecords } from '../helpers/fixtures';

const text = () => loadRecords('conducting_44', 'src.hands').map((r) => JSON.stringify(r)).join('\n');
afterEach(() => useReplay.getState().clear());

describe('the replay store', () => {
  it('refuses a file over the limit by its size, before reading it', async () => {
    const huge = { size: MAX_RECORDING_CHARS + 1, name: 'huge.jsonl', arrayBuffer: () => Promise.reject(new Error('must not be read')) } as unknown as Blob & { name: string };
    await useReplay.getState().loadFile(huge);
    expect(useReplay.getState().error).toMatch(/larger than/);
  });

  it('lets only the latest of two loads land, and Stop cancels one in flight', async () => {
    let release!: (b: ArrayBuffer) => void;
    const slow = { size: 10, name: 'slow', arrayBuffer: () => new Promise<ArrayBuffer>((r) => (release = r)) } as unknown as Blob & { name: string };
    const fast = new Blob([text()]) as Blob & { name?: string };
    const first = useReplay.getState().loadFile(slow);
    await useReplay.getState().loadFile(Object.assign(fast, { name: 'fast' }));
    release(new TextEncoder().encode(text()).buffer as ArrayBuffer);
    await first;
    expect(useReplay.getState().replay?.name).toBe('fast');
    const again = useReplay.getState().loadFile(new Blob([text()]) as Blob & { name?: string });
    useReplay.getState().clear();
    await again;
    expect(useReplay.getState().replay).toBeNull();
  });
});
