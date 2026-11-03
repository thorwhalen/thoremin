/**
 * What the app says about a player's moving gestures (#954), in one place: the carve tool's Trying
 * and the Gestures tool's Your categories say the same thing when the same thing happens.
 *
 * Words for the player belong to the app half, not to the pure listener that only reports its
 * state (`@thoremin/sdk/enroll/gestures/listen`: `warming()`).
 */

/** Said while a gesture listener is `warming()`: its noise unit is not learned yet, so a gesture
 *  made now is not heard (a set made active mid-move, the first movement after a hush). */
export const LISTEN_WARMING_SAY = 'Getting ready to listen: hold still for a moment. A gesture made before then is not heard.';

/** The quiz's prompt for an asked gesture: made once, never held. */
export const gesturePrompt = (label: string): string => `Make: ${label} (once)`;
