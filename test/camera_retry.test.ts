/**
 * When a refused camera is asked for again (#960, `watchCameraRetry`): on the permission turning
 * `granted` and on the page shown again, never while the permission is known to be denied, never
 * on a timer, and never after the watch is uninstalled. The page and the Permissions API are
 * fakes, so the events are the test's own.
 */
import { describe, expect, it, vi } from 'vitest';
import { watchCameraRetry, type RetryPage, type RetryPermissions } from '@/app/engine/cameraRetry';

/** A page whose visibility the test sets, and whose `visibilitychange` it fires. */
function fakePage() {
  const target = new EventTarget();
  const page = Object.assign(target, { visibilityState: 'visible' as DocumentVisibilityState }) as unknown as RetryPage & { visibilityState: DocumentVisibilityState };
  return { page, show: (state: DocumentVisibilityState = 'visible') => ((page.visibilityState = state), target.dispatchEvent(new Event('visibilitychange'))) };
}

/** A Permissions API with one camera status whose state the test changes. */
function fakePermissions(initial: PermissionState) {
  const status = Object.assign(new EventTarget(), { state: initial, name: 'camera', onchange: null }) as unknown as PermissionStatus & { state: PermissionState };
  const permissions: RetryPermissions = { query: vi.fn(async () => status) };
  return { permissions, set: (state: PermissionState) => ((status.state = state), status.dispatchEvent(new Event('change'))) };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('watchCameraRetry', () => {
  it('asks again when the page is shown, not when it is hidden', () => {
    const retry = vi.fn();
    const { page, show } = fakePage();
    watchCameraRetry(retry, { page, permissions: undefined });
    show('hidden');
    expect(retry).not.toHaveBeenCalled();
    show('visible');
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('asks again when the permission is granted, and not on the page while it is denied', async () => {
    const retry = vi.fn();
    const { page, show } = fakePage();
    const { permissions, set } = fakePermissions('denied');
    watchCameraRetry(retry, { page, permissions });
    await settle();
    show();
    expect(retry).not.toHaveBeenCalled();
    set('granted');
    expect(retry).toHaveBeenCalledTimes(1);
    set('prompt');
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('a browser that does not know the camera permission still retries on the page', async () => {
    const retry = vi.fn();
    const { page, show } = fakePage();
    watchCameraRetry(retry, { page, permissions: { query: () => Promise.reject(new TypeError('camera is not a permission name')) } });
    await settle();
    show();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('asks nothing once uninstalled, even when the permission answer arrives after', async () => {
    const retry = vi.fn();
    const { page, show } = fakePage();
    const { permissions, set } = fakePermissions('prompt');
    const stop = watchCameraRetry(retry, { page, permissions });
    stop();
    stop();
    await settle();
    show();
    set('granted');
    expect(retry).not.toHaveBeenCalled();
  });
});
