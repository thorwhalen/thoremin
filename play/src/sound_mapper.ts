/**
 * The Sound mapper on a page of its own (`play/sound-mapper.html`): teach it a few struck sounds,
 * give each a drum, and every tap plays its drum. No camera, no graph, no React: the store
 * (`@thoremin/sound-mapper/store`, its map kept in the browser), the audio-input hub's browser
 * half over the page's own AudioContext, and the panel (`./sound_mapper_view`). The bundle check
 * (`scripts/check_play_bundle.ts`) keeps it that way.
 *
 * The AudioContext is made inside the click that first needs sound (Teach or Play), which is when a
 * browser lets a page start one; the mapper's drums play on the audio thread to its destination.
 */
import { createBrowserAudioInput } from '@/audio/browser';
import { createSoundMapperStore } from '@thoremin/sound-mapper/store';
import { mountSoundMapper, type SoundMapperActions } from './sound_mapper_view';

let ctx: AudioContext | undefined;
const hub = createBrowserAudioInput({ audio: () => ctx });
const store = createSoundMapperStore({ hub: () => hub });

/** Make and resume the page's AudioContext (from a click), then let the hub retry. */
function ensureAudio(): void {
  ctx ??= new AudioContext({ latencyHint: 'interactive' });
  void ctx.resume().then(() => hub.poke());
  hub.poke();
}

const s = store.getState();
const actions: SoundMapperActions = {
  ...s,
  teach: (id) => {
    if (id !== null) ensureAudio();
    s.teach(id);
  },
  play: (on) => {
    if (on) ensureAudio();
    s.play(on);
  },
};

mountSoundMapper(document.getElementById('mapper')!, store, actions);
void s.hydrate();

/** What the browser smoke reads (`smoke/tests/sound_mapper.smoke.ts`). */
(window as unknown as { thoreminPlay: unknown }).thoreminPlay = { mic: () => hub.status().state, audio: () => ctx, state: () => store.getState() };
