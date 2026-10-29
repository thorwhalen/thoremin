/**
 * The app's audio-input hub (`docs/design/audio-input.md`): the browser hub (`src/audio/browser.ts`)
 * over the app's one AudioContext, which `useEngine` creates on the first gesture and announces
 * here through {@link provideAudioOutput}; until then a lease waits. Its output goes to the
 * master gain, so the instrument's volume and mute apply to a triggered sample. The measured
 * input stage is the app's persisted record (`./inputStage.ts`). `?audio.source=` forces a source.
 */
import { createBrowserAudioInput } from '@/audio/browser';
import { provideAudioInput, type ContextLike } from '@thoremin/sdk-ui/audio/hub';
import { storedInputStage } from './inputStage';

export type { AudioInputHub, AudioInputLease, AudioSourceKind, HubStatus, LeaseEvent } from '@thoremin/sdk-ui/audio/hub';

/** The resources key the `audio-events` node reads the hub from. */
export const AUDIO_INPUT_RESOURCE_KEY = 'audioInput';

let output: { audio(): AudioContext | undefined; destination(): AudioNode | undefined } = { audio: () => undefined, destination: () => undefined };

/** The page's one hub, installed for the extensions (`audioInput()` in `@thoremin/sdk-ui/audio/hub`). */
export const audioInput = createBrowserAudioInput({ audio: () => output.audio(), destination: () => output.destination() }, { storedInputStage });
provideAudioInput(audioInput);

/** Called by the engine host once its AudioContext and master gain exist. */
export function provideAudioOutput(o: { audio(): AudioContext | undefined; destination(): AudioNode | undefined }): void {
  output = o;
  audioInput.poke();
}

export type { ContextLike };
