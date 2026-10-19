/**
 * The generative TRANSPORT (#188; the slice's since #600 S14): play / pause the stream. Like the
 * master mute it is deliberately NOT a dial (a dial rides saved instruments, and an instrument
 * saved while playing would start a paid cloud stream on load) and NOT a command (a command is an
 * assistant tool, a palette entry and a bindable gesture: nothing but a human press on the Play
 * button or the `p` key may start a paid stream). It is the slice's transient field
 * `steerPlaying`, written through the SDK's controls seam. Play only while the layer is enabled: a
 * transport left on over a disabled layer would make the next enable auto-start a paid stream
 * with no Play press ({@link pauseWhenDisabled} keeps that true when the layer is switched off).
 */
import { controls } from '@thoremin/sdk-ui/host';

/** The transient field the `lyria` node's `playing` input reads. */
export const PLAYING_FIELD = 'steerPlaying';

const state = () => controls().get() as { steer?: { enabled?: boolean }; steerPlaying?: boolean | null };
const layerEnabled = (): boolean => state().steer?.enabled === true;
const isPlaying = (): boolean => state().steerPlaying === true;
const setPlaying = (playing: boolean): void => controls().setTransient(PLAYING_FIELD, playing);

/** Toggle the transport (the Play button, the `p` key); a no-op while the layer is off. */
export function togglePlaying(): void {
  if (!layerEnabled()) return;
  setPlaying(!isPlaying());
}

/** Switching the layer OFF pauses the transport (#188), for the app's lifetime: a mount effect. */
export function pauseWhenDisabled(): () => void {
  const check = () => {
    if (!layerEnabled() && isPlaying()) setPlaying(false);
  };
  check();
  return controls().subscribe(check);
}
