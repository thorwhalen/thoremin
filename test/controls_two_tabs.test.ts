// @vitest-environment jsdom
/**
 * Two tabs over one localStorage (#847): a tab takes in the device prefs and learned values another tab
 * saved, so its next save does not revert them, and leaves its dials alone, since those are what it is
 * sounding. Each tab is its own module instance; the browser's `storage` event is sent by hand, to the
 * listeners of both (a real browser skips the writer, and a tab's own blob changes nothing in it).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONDUCTOR, SONG } from './helpers/extensions';

const KEY = 'thoremin-controls';
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? '{}').state as Record<string, any>;
const announce = (newValue: string | null = localStorage.getItem(KEY), key = KEY) =>
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }));

const withState = (fields: Record<string, unknown>) => {
  const blob = JSON.parse(localStorage.getItem(KEY)!);
  return { ...blob, state: { ...blob.state, ...fields } };
};

async function twoTabs() {
  vi.resetModules();
  const A = (await import('@/app/store')).useControls;
  vi.resetModules();
  const B = (await import('@/app/store')).useControls;
  B.getState().setMasterVolume(0.31); // B has saved, so its next write is judged against its own
  return { A, B };
}

afterEach(() => localStorage.clear());

describe('a tab takes in what another tab saved (#847)', () => {
  it("takes the other tab's pref and keeps its own dial", async () => {
    const { A, B } = await twoTabs();
    A.getState().setMasterVolume(0.22);
    A.getState().setAudioPrefs({ lowLatency: true });
    announce();
    expect(B.getState().audioPrefs.lowLatency).toBe(true);
    expect(B.getState().masterVolume).toBe(0.31);
  });

  it('does not answer with a write: the saved blob stays as the other tab left it', async () => {
    const { A, B } = await twoTabs();
    A.getState().setMasterVolume(0.22);
    A.getState().setAudioPrefs({ lowLatency: true });
    const saved = localStorage.getItem(KEY);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    announce();
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
    expect(localStorage.getItem(KEY)).toBe(saved);
    // Nor does a transient set afterwards: the stale-tab guard of #739 still holds.
    B.getState().setGraphElements(['x']);
    expect(stored().masterVolume).toBe(0.22);
  });

  it("the tab's next real save keeps the pref it took in", async () => {
    const { A, B } = await twoTabs();
    A.getState().setAudioPrefs({ lowLatency: true });
    announce();
    B.getState().setMasterVolume(0.4);
    expect(stored().masterVolume).toBe(0.4);
    expect(stored().audioPrefs.lowLatency).toBe(true);
  });

  it('a calibration cleared in the other tab is cleared here', async () => {
    const { A, B } = await twoTabs();
    A.getState().setFaceCalibration({ happy: 1 } as never);
    announce();
    expect(B.getState().faceCalibration).toEqual({ happy: 1 });
    A.getState().setFaceCalibration(null);
    announce();
    expect(B.getState().faceCalibration).toBeNull();
  });

  it.runIf(CONDUCTOR)("an extension's device pref arrives too", async () => {
    const { A, B } = await twoTabs();
    A.getState().setPref('conductorPrefs', { leadOffsets: { wrist: 0.04 } });
    announce();
    expect((B.getState() as unknown as Record<string, any>).conductorPrefs.leadOffsets).toEqual({ wrist: 0.04 });
  });

  it("a tab that has not heard of this tab's edit does not revert it", async () => {
    const { A, B } = await twoTabs();
    B.getState().setAudioPrefs({ lowLatency: true });
    // A saves a dial with its old pref: its blob says false, and that has not moved since B last saw it.
    localStorage.setItem(KEY, JSON.stringify(withState({ audioPrefs: { lowLatency: false } })));
    announce();
    expect(B.getState().audioPrefs.lowLatency).toBe(true);
    expect(A.getState().audioPrefs.lowLatency).toBe(false);
  });

  it('whether gestures fire stays this tab\'s; the bindings come over', async () => {
    const { A, B } = await twoTabs();
    A.getState().setGestures({ enabled: true, holdMs: 123 });
    announce();
    expect(B.getState().gestures.holdMs).toBe(123);
    expect(B.getState().gestures.enabled).toBe(false);
  });

  it.runIf(SONG)('a pref live in this tab stays: the song level is not changed from another tab', async () => {
    const { A, B } = await twoTabs();
    const before = (B.getState() as unknown as Record<string, any>).songPrefs.volume;
    A.getState().setPref('songPrefs', { ...(A.getState() as unknown as Record<string, any>).songPrefs, volume: before / 2 });
    announce();
    expect((B.getState() as unknown as Record<string, any>).songPrefs.volume).toBe(before);
  });

  it('a page back from the page cache reads the save it missed', async () => {
    const { A, B } = await twoTabs();
    A.getState().setAudioPrefs({ lowLatency: true });
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    expect(B.getState().audioPrefs.lowLatency).toBe(false);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(B.getState().audioPrefs.lowLatency).toBe(true);
  });

  it('a calibration that is not one, and a pref from a newer slice version, stay out', async () => {
    const { A, B } = await twoTabs();
    A.getState().setMasterVolume(0.2);
    announce(JSON.stringify(withState({ faceCalibration: 'x' })));
    expect(B.getState().faceCalibration).toBeNull();
    if (CONDUCTOR) {
      const blob = withState({ conductorPrefs: { leadOffsets: { wrist: 0.04 } }, sliceVersions: { conductorPrefs: 999 } });
      announce(JSON.stringify(blob));
      expect((B.getState() as unknown as Record<string, any>).conductorPrefs.leadOffsets).toEqual({});
    }
  });

  it('nothing changes in this tab when no pref differs', async () => {
    const { A, B } = await twoTabs();
    A.getState().setMasterVolume(0.22);
    const listener = vi.fn();
    const off = B.subscribe(listener);
    announce();
    off();
    expect(listener).not.toHaveBeenCalled();
  });

  it('ignores another key, a removal, a corrupt blob and a blob of another format', async () => {
    const { A, B } = await twoTabs();
    A.getState().setAudioPrefs({ lowLatency: true });
    const blob = JSON.parse(localStorage.getItem(KEY)!);
    announce(JSON.stringify(blob), 'something-else');
    announce(null);
    announce('{not json');
    announce(JSON.stringify({ ...blob, version: blob.version + 1 }));
    announce(JSON.stringify({ version: blob.version }));
    expect(B.getState().audioPrefs.lowLatency).toBe(false);
  });

  it('a corrupt pref in the blob leaves the current one', async () => {
    const { A, B } = await twoTabs();
    A.getState().setAudioPrefs({ lowLatency: true });
    const blob = JSON.parse(localStorage.getItem(KEY)!);
    blob.state.audioPrefs = { lowLatency: 'yes' };
    announce(JSON.stringify(blob));
    expect(B.getState().audioPrefs.lowLatency).toBe(false);
  });
});
