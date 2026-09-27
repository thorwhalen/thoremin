/**
 * Which microphone a take records (#247) — pure, so the browser recorder and the offline
 * pairing script agree on what a headset is.
 *
 * A real-versus-air take wants the COMPUTER's microphone. When Bluetooth headphones are
 * connected, macOS often makes their microphone the default input, and opening it puts
 * the headset into its phone-call profile: 8 to 16 kHz, heavy processing, extra latency,
 * and (on the output side) mono call-quality sound in the player's ears. The recorder
 * therefore opens the default input, and if its name says headset while another input
 * that does not is available, reopens with that one instead ({@link chooseMicrophone}).
 * The pairing script uses the same pattern to warn about a take recorded through one.
 *
 * Device names are the browser's labels ("MacBook Air Microphone", "AirPods Pro"), which
 * it only reveals once microphone permission is granted — which is why the choice is made
 * after the first open, not before.
 */

/** Device names that are a headset's microphone rather than the computer's. Deliberately
 *  broad: a false positive only means the computer's microphone is preferred, which is
 *  the point. */
export const HEADSET_MIC_PATTERN =
  /airpods|beats|headset|headphone|hands-?free|bluetooth|buds|bose|jabra|sony|sennheiser|\bwh-|\bwf-|plantronics|poly\b|shokz|aftershokz|skullcandy/i;

export const isHeadsetMic = (label: string): boolean => HEADSET_MIC_PATTERN.test(label);

/** The slice of `MediaDeviceInfo` this needs (structural, for tests). */
export interface InputDevice {
  deviceId: string;
  kind: string;
  label: string;
}

/**
 * The input to use instead of the one that opened, or null to keep it: when the opened
 * one is a headset's and another audio input is not, the first such (a built-in one
 * first, by name). The "default" and "communications" pseudo-devices are skipped: they
 * alias a real device, often the very headset being avoided.
 */
export function chooseMicrophone(devices: readonly InputDevice[], openedLabel: string): InputDevice | null {
  if (!isHeadsetMic(openedLabel)) return null;
  const candidates = devices.filter(
    (d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications' && d.label && !isHeadsetMic(d.label),
  );
  return candidates.find((d) => /built-?in|macbook|internal/i.test(d.label)) ?? candidates[0] ?? null;
}
