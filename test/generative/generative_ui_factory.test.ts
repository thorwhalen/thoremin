/**
 * The generative layer slice's React half (#600 S14) installs the browser engine factory and a
 * status hook; neither was reached by a test. Pinned here: with no Gemini key, or no audio graph
 * yet, the factory says so as a TRANSIENT unavailability (`retry`, so pasting the key or tapping
 * to play brings the layer alive without switching it off and on) and never loads the Lyria
 * adapter; with both it loads the adapter and hands it over; and the status hook's reset pauses a
 * transport left playing (a rebuilt engine must not auto-start a paid stream), harmlessly where
 * there is no hot store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerativeEngineFactory } from '@/slices/generative/nodes/generative';
import { provideControls, type ControlsHost } from '@thoremin/sdk-ui/host';
import { provideProviderKeys } from '@thoremin/sdk-ui/keys';
import { GENERATIVE } from '../helpers/extensions';

const h = vi.hoisted(() => ({ factory: null as null | GenerativeEngineFactory, adapter: vi.fn() }));
vi.mock('@/slices/generative/nodes/lyria', async (orig) => ({
  ...(await orig<object>()),
  provideGenerativeEngineFactory: (f: GenerativeEngineFactory | null) => {
    h.factory = f;
  },
}));
vi.mock('@/slices/generative/app/lyria_engine', () => ({
  createLyriaEngine: async (opts: unknown) => (h.adapter(opts), { resource: 'engine', message: 'Generative engine ready' }),
}));

const signal = new AbortController().signal;
const audio = { audioContext: {} as AudioContext, destination: {} as AudioNode, signal };

beforeEach(() => {
  h.adapter.mockReset();
});
afterEach(() => {
  provideProviderKeys(null);
});

describe.runIf(GENERATIVE)('the generative slice React half', () => {
  const ui = async () => (await import('@/slices/generative/ui')).GENERATIVE_UI;

  it('installs a factory that asks for a key first, as a transient reason, without loading the adapter', async () => {
    await ui();
    expect(await h.factory!(audio)).toMatchObject({ resource: null, reason: 'no-key', retry: true });
    expect(h.adapter).not.toHaveBeenCalled();
  });

  it('then asks for a tap when there is no audio graph yet', async () => {
    await ui();
    provideProviderKeys({ get: () => 'key' });
    expect(await h.factory!({ signal })).toMatchObject({ resource: null, reason: 'no-audio', retry: true });
    expect(await h.factory!({ audioContext: audio.audioContext, signal })).toMatchObject({ reason: 'no-audio' });
    expect(h.adapter).not.toHaveBeenCalled();
  });

  it('with a key and the audio graph it loads the Lyria adapter and hands it over', async () => {
    await ui();
    provideProviderKeys({ get: () => 'key' });
    expect(await h.factory!(audio)).toEqual({ resource: 'engine', message: 'Generative engine ready' });
    expect(h.adapter).toHaveBeenCalledWith(audio);
  });

  it('the status hook reset pauses a transport left playing, and only then', async () => {
    const hook = (await ui()).statusHooks![0];
    const setTransient = vi.fn();
    let playing = true;
    provideControls({ get: () => ({ steerPlaying: playing }), setTransient, setHush: () => {}, setPref: () => {}, subscribe: () => () => {} } as ControlsHost);
    hook.reset!();
    expect(setTransient).toHaveBeenCalledWith('steerPlaying', false);
    playing = false;
    hook.reset!();
    expect(setTransient).toHaveBeenCalledOnce();
  });

  it('the status hook reset is harmless where there is no hot store', async () => {
    const hook = (await ui()).statusHooks![0];
    provideControls(null as unknown as ControlsHost);
    expect(() => hook.reset!()).not.toThrow();
  });
});
