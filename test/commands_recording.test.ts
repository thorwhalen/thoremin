/**
 * Recording commands (#257): where a take goes is written through the registry, like
 * every other discrete control. The commands act on the recording host seam (so the
 * command import firewall holds); here a scripted host stands in for the recording
 * module, and the three outcomes of the picker come back as data.
 */
import { describe, it, expect, expectTypeOf, beforeEach, afterEach } from 'vitest';
import { createThoreminRegistry } from '@/app/commands/registry';
import { provideRecordingHost, recordingHost, type ChosenFolder, type RecordingHost } from '@/app/commands/recordingHost';
import { createJournal } from '@/app/commands/journal';
import { installMiddleware } from '@/app/commands/middleware';
import { defaultGetRisk, needsUserActivation } from '@/app/commands/confirmation';
import { isGestureBindable } from '@/app/gestures/gestureDispatch';
import type { ChooseFolderResult } from '@/app/recording/folder';

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

  it('both commands write (additive), and only the picker needs a click: no hand pose binds to it', () => {
    expect(defaultGetRisk('recording.location.set').sideEffect).toBe('additive');
    expect(defaultGetRisk('recording.folder.choose').sideEffect).toBe('additive');
    expect(needsUserActivation('recording.folder.choose')).toBe(true);
    expect(needsUserActivation('recording.location.set')).toBe(false);
    // Undo snapshots only the dials; a recording write lands in the recording config,
    // so it is marked not undoable (#392). Still additive: no confirmation prompt.
    expect(defaultGetRisk('recording.location.set').undoable).toBe(false);
    expect(defaultGetRisk('recording.folder.choose').undoable).toBe(false);
    expect(defaultGetRisk('dial.set').undoable).not.toBe(false);
    expect(isGestureBindable('recording.folder.choose')).toBe(false);
    expect(isGestureBindable('recording.location.set')).toBe(true);
  });

  it('a replay never re-opens the picker: the journal keeps the pick out of its replayable set', async () => {
    const journaled = createThoreminRegistry();
    const journal = createJournal();
    installMiddleware(journaled, journal.middleware);
    next = { kind: 'chosen', name: 'takes' };
    await journaled.dispatch('recording.folder.choose', {});
    await journaled.dispatch('recording.location.set', { location: 'downloads' });
    expect(journal.entries().map((e) => [e.command, e.ok])).toEqual([
      ['recording.folder.choose', true],
      ['recording.location.set', true],
    ]);
    expect(journal.replayable().map((e) => e.command)).toEqual(['recording.location.set']);
  });

  it('dispatching before the recording module loaded names the missing seam', async () => {
    provideRecordingHost(null);
    const r = await reg.dispatch('recording.location.set', { location: 'downloads' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/recording host not installed/);
  });
});

describe('the host seam restates the folder outcome (#392)', () => {
  it('ChosenFolder is ChooseFolderResult, copied only to keep the command import firewall', () => {
    // The commands may not import the recording module, so `recordingHost.ts` restates
    // the picker's outcome type. This pins the copy: a variant added on one side fails
    // the typecheck here instead of drifting silently.
    expectTypeOf<ChosenFolder>().toEqualTypeOf<ChooseFolderResult>();
  });
});

describe('installRecording (#392)', () => {
  it('importing the config store installs nothing; installRecording installs, its cleanup uninstalls', async () => {
    provideRecordingHost(null);
    const { installRecording } = await import('@/app/recording/configStore');
    expect(() => recordingHost()).toThrow(/recording host not installed/);
    const uninstall = installRecording();
    expect(() => recordingHost()).not.toThrow();
    uninstall();
    expect(() => recordingHost()).toThrow(/recording host not installed/);
  });
});
