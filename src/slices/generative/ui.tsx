/**
 * The generative layer slice's React half (#600 S14): the Generative editor section, its status
 * hook (the `lyria` node's status into the store the section reads; hand-wired in `useEngine.ts`
 * before), the `steer.*` commands, the transport's `p` key, the rule that
 * switching the layer off pauses the transport, and the browser engine factory.
 */
import type { ExtensionUi } from '@thoremin/sdk-ui/types';
import { providerKey } from '@thoremin/sdk-ui/keys';
import { GenerativeControls } from './panels/generative';
import { ABSENT_GENERATIVE_STATUS, GENERATIVE_NODE_ID, makeGenerativeReporter, useGenerativeStatus } from './app/generativeStatus';
import { STEER_COMMANDS } from './app/steerCommands';
import { PLAYING_FIELD, pauseWhenDisabled, togglePlaying } from './app/transport';
import { controls } from '@thoremin/sdk-ui/host';
import { provideGenerativeEngineFactory, LYRIA_KEY_PROVIDER } from './nodes/lyria';

// The node's browser engine, installed when this half loads (before any engine starts). A missing
// key or a not-yet-tapped audio graph is a TRANSIENT unavailability (`retry`): the resource asks
// again after a pause, so pasting the key or tapping to play brings the layer alive without
// switching it off and on (a review catch on #188 PR 4). `@google/genai` loads only here, on demand.
provideGenerativeEngineFactory(async (opts) => {
  if (!providerKey(LYRIA_KEY_PROVIDER)) {
    return { resource: null, reason: 'no-key', retry: true, message: 'Add a Gemini API key (the assistant’s Google key) to enable the generative layer.' };
  }
  if (!opts.audioContext || !opts.destination) {
    return { resource: null, reason: 'no-audio', retry: true, message: 'Tap to play first: the generative layer needs the audio graph.' };
  }
  const { createLyriaEngine } = await import('./app/lyria_engine');
  return createLyriaEngine(opts);
});

export const GENERATIVE_UI: ExtensionUi = {
  id: 'generative-layer',
  panels: [{ instrumentId: 'generative', section: 'Generative', Controls: GenerativeControls, Readout: () => null, readoutOn: () => false }],
  statusHooks: [
    {
      nodeId: GENERATIVE_NODE_ID,
      make: (engine) => makeGenerativeReporter(engine),
      onRemoved: () => useGenerativeStatus.getState().report(ABSENT_GENERATIVE_STATUS),
      // The engine is gone: a rebuilt one must not auto-start a paid stream from a stale transport.
      reset: () => {
        useGenerativeStatus.getState().reset();
        try {
          if (controls().get()[PLAYING_FIELD] === true) controls().setTransient(PLAYING_FIELD, false);
        } catch {
          // No hot store in this host (a headless test): no transport to pause.
        }
      },
    },
  ],
  onMount: [pauseWhenDisabled],
  commands: STEER_COMMANDS,
  // The transport is a key ACTION, not a command (no assistant tool, no gesture binding).
  keybindings: [{ key: 'p', run: togglePlaying, help: 'play / pause the generative layer (when it is on)' }],
};

export default GENERATIVE_UI;
