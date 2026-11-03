/**
 * Asking for the camera again after a refusal (#960 item 2).
 *
 * Why. A camera opened late (an instrument switch, a tool that comes to read it, #869) can be
 * refused: the player said no, dismissed the prompt, or there is no camera. The instrument then
 * plays on without it, and the reader is still there. Before this, a player who then granted the
 * permission in the browser had to switch instruments to get the camera; the request was never
 * repeated on its own.
 *
 * When. Only on an event that can change the answer, never on a timer:
 *
 *  - the camera permission turning `granted` (the Permissions API, where the browser has it: the
 *    player allowed it from the address bar, which does not hide the page). A request then cannot
 *    prompt, so this trigger stays armed for the watch's life;
 *  - the page shown again (`visibilitychange` to visible: the player went to the browser's
 *    settings, or another tab, and came back), skipped while the permission is known to be
 *    `denied`. This one CAN prompt (where the permission is `prompt`, or unknown: Firefox rejects
 *    the query), and a prompt dismissed again and again gets the camera embargoed by the browser
 *    (Chrome blocks it for days after a few dismissals). So it fires ONCE per watch, then drops:
 *    at most one prompt-capable retry per refusal.
 *
 * The host arms a fresh watch only on the refusal of a request the player caused (a reader
 * appearing), never on a retry's own refusal, so nothing here can turn into a loop of prompts. The
 * toast is not repeated by these retries: it was said once, for the request the player caused.
 *
 * Pure of React and of the engine: the page and the Permissions API are seams with the browser's
 * own as defaults, so a test drives the events itself.
 */

/** The page whose visibility is watched. */
export type RetryPage = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

/** The Permissions API, or the part of it read here. */
export type RetryPermissions = Pick<Permissions, 'query'>;

export interface CameraRetryOptions {
  /** Default `document`, where there is one. */
  page?: RetryPage;
  /** Default `navigator.permissions`, where the browser has it. */
  permissions?: RetryPermissions;
}

/** The permission name the Permissions API knows the camera by (not in every browser's list). */
const CAMERA_PERMISSION = 'camera' as PermissionName;

/**
 * Call `retry` on each event after which a refused camera may now open (see the module header).
 * Returns the uninstall: idempotent, and safe before the permission query has answered.
 */
export function watchCameraRetry(
  retry: () => void,
  { page = typeof document === 'undefined' ? undefined : document, permissions = typeof navigator === 'undefined' ? undefined : navigator.permissions }: CameraRetryOptions = {},
): () => void {
  let installed = true;
  let status: PermissionStatus | undefined;
  const onPermission = () => {
    if (status?.state === 'granted') retry();
  };
  const onVisibility = () => {
    if (page?.visibilityState !== 'visible' || status?.state === 'denied') return;
    // The one prompt-capable retry: spent.
    page.removeEventListener('visibilitychange', onVisibility);
    retry();
  };
  page?.addEventListener('visibilitychange', onVisibility);
  // A browser that does not know the camera's permission name rejects the query: the page's
  // visibility is then the only trigger.
  permissions
    ?.query({ name: CAMERA_PERMISSION })
    .then((s) => {
      if (!installed) return;
      status = s;
      s.addEventListener('change', onPermission);
    })
    .catch(() => undefined);
  return () => {
    if (!installed) return;
    installed = false;
    page?.removeEventListener('visibilitychange', onVisibility);
    status?.removeEventListener('change', onPermission);
  };
}
