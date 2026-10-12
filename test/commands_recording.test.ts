/**
 * Recording commands (#257): where a take goes is written through the registry, like
 * every other discrete control. The commands act on the recording host seam (so the
 * command import firewall holds); here a scripted host stands in for the recording
 * module, and the three outcomes of the picker come back as data.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createThoreminRegistry } from '@/app/commands/registry';
import { provideRecordingHost, type ChosenFolder, type RecordingHost } from '@/app/commands/recordingHost';

const reg = createThoreminRegistry();

let locations: string[] = [];
let next: ChosenFolder | (() => Promise<ChosenFolder>) = { kind: 'unsupported' };
const host: RecordingHost = {
  setLocation: (location) => {
    locations.push(location);
  },
  chooseFolder: () => (typeof next === 'function' ? next() : Promise.resolve(next)),
};

beforeEach(() => {
  locations = [];
  next = { kind: 'unsupported' };
  provideRecordingHost(host);
});
afterEach(() => provideRecordingHost(null));

describe('recording commands (#257)', () => {
  it('are registered in the app registry', () => {
    expect(reg.has('recording.location.set')).toBe(true);
    expect(reg.has('recording.folder.choose')).toBe(true);
  });

  it('recording.location.set writes the preference, and refuses a location that is not one', async () => {
    expect((await reg.dispatch('recording.location.set', { location: 'directory' })).ok).toBe(true);
    expect(locations).toEqual(['directory']);
    const bad = await reg.dispatch('recording.location.set', { location: 'desktop' });
    expect(bad.ok).toBe(false);
    expect(locations).toEqual(['directory']);
  });

  it('recording.folder.choose: a chosen folder is named and makes the folder the location', async () => {
    next = { kind: 'chosen', name: 'takes' };
    const r = await reg.dispatch('recording.folder.choose', {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ folder: 'takes', cancelled: false });
    expect(locations).toEqual(['directory']);
  });

  it('recording.folder.choose: a dismissed picker changes nothing and says so', async () => {
    next = { kind: 'cancelled' };
    const r = await reg.dispatch('recording.folder.choose', {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ folder: null, cancelled: true });
    expect(locations).toEqual([]);
  });

  it('recording.folder.choose: no picker in this browser is an error naming the fallback', async () => {
    const r = await reg.dispatch('recording.folder.choose', {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('unsupported');
      expect(r.error.message).toMatch(/zip/);
    }
    expect(locations).toEqual([]);
  });

  it('recording.folder.choose: a picker refused outside a click (the assistant) is an error, not a crash', async () => {
    next = async () => {
      throw new DOMException('no gesture', 'SecurityError');
    };
    const r = await reg.dispatch('recording.folder.choose', {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('needs_gesture');
  });

  it('dispatching before the recording module loaded names the missing seam', async () => {
    provideRecordingHost(null);
    const r = await reg.dispatch('recording.location.set', { location: 'downloads' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/recording host not installed/);
  });
});
