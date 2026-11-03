// @vitest-environment jsdom
/**
 * A standalone page with no timing offset of its own adopts the one the player measured in the
 * camera app's Audio timing take before the listening games left it (#895), once, and only a
 * measurement (not the camera app's default).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CAMERA_APP_CONTROLS_KEY, cameraAppOffset, readOffset, writeOffset } from '../../play/src/offset';
import { CONTROLS_STORAGE_KEY } from '@/app/store';
import { GAMES } from '../helpers/extensions';

const camera = (gamesPrefs: Record<string, unknown>) => localStorage.setItem(CAMERA_APP_CONTROLS_KEY, JSON.stringify({ state: { gamesPrefs } }));
const MEASURED = { offset: 0.042, spread: 0.008, source: 'tap', measuredAt: '2026-10-20T10:00:00.000Z' };

describe('the camera app\'s timing offset carries over to the standalone pages (#895)', () => {
  beforeEach(() => localStorage.clear());

  it('reads the key the camera app persists under', () => {
    expect(CAMERA_APP_CONTROLS_KEY).toBe(CONTROLS_STORAGE_KEY);
  });

  it('adopts a measured offset once, as the page\'s own', () => {
    camera(MEASURED);
    expect(readOffset()).toEqual({ offset: 0.042, spread: 0.008, at: '2026-10-20T10:00:00.000Z' });
    // Kept as the page's own: a later change in the camera app's blob no longer moves it.
    camera({ ...MEASURED, offset: 0.1 });
    expect(readOffset()?.offset).toBe(0.042);
  });

  it('never replaces an offset the page measured itself', () => {
    writeOffset({ offset: 0.02, spread: 0.005, at: '2026-11-01T00:00:00.000Z' });
    camera(MEASURED);
    expect(readOffset()?.offset).toBe(0.02);
  });

  it('ignores the camera app\'s default, a blob without games prefs, and an unreadable one', () => {
    camera({ offset: 0, spread: null, source: 'none', measuredAt: '' });
    expect(readOffset()).toBeNull();
    localStorage.setItem(CAMERA_APP_CONTROLS_KEY, JSON.stringify({ state: {} }));
    expect(cameraAppOffset()).toBeNull();
    localStorage.setItem(CAMERA_APP_CONTROLS_KEY, '{not json');
    expect(cameraAppOffset()).toBeNull();
    // Out of the camera app's own bound (a hand-edited blob: a carried slice is never healed).
    camera({ ...MEASURED, offset: 5 });
    expect(cameraAppOffset()).toBeNull();
    camera({ ...MEASURED, source: 'guess' });
    expect(cameraAppOffset()).toBeNull();
  });

  it('never adopts a camera loopback offset: the device is the input stage now (#881)', () => {
    camera({ ...MEASURED, source: 'loopback', spread: null });
    expect(cameraAppOffset()).toBeNull();
    // A tap take with no spread still carries over, with a zero spread.
    camera({ ...MEASURED, spread: null });
    expect(cameraAppOffset()).toEqual({ offset: 0.042, spread: 0, at: MEASURED.measuredAt });
  });
});

describe.runIf(GAMES)('through the camera app\'s own persister (a build that lists the games slice)', () => {
  it('reads what the store writes for gamesPrefs', async () => {
    localStorage.clear();
    const { useControls } = await import('@/app/store');
    useControls.getState().setPref('gamesPrefs', MEASURED);
    await new Promise((r) => setTimeout(r, 0));
    expect(cameraAppOffset()).toEqual({ offset: 0.042, spread: 0.008, at: MEASURED.measuredAt });
  });
});
