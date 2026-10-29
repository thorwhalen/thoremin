/** The audio-input hub's state in the player's words, for the sound mapper's page. Pure. */
import type { HubStatus } from '@thoremin/sdk-ui/audio/hub';

/** What to tell the player about the microphone (null: nothing to say). */
export function describeInput(status: HubStatus | null): string | null {
  switch (status?.state) {
    case 'waiting-audio':
      return 'Tap anywhere on the page to start the sound first.';
    case 'opening':
      return 'Opening the microphone...';
    case 'denied':
      return 'The microphone was refused. Allow it in the browser (the icon in the address bar), then try again.';
    case 'unsupported':
      return 'This browser cannot listen to a microphone here.';
    case 'failed':
      return `The microphone could not start: ${status.error ?? 'unknown error'}`;
    case 'live':
      return status.source === 'microphone' ? `Listening${status.device ? ` (${status.device})` : ''}.` : `Listening to the ${status.source} sound.`;
    default:
      return null;
  }
}
