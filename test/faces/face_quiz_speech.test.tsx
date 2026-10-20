// @vitest-environment jsdom
/**
 * Spoken quiz prompts (#445): with "Say the prompts out loud" on, the quiz says "Relax" and then
 * each category's name as the step changes, once per step; off, or with no speech provided, it is
 * silent and the written prompt carries on. The host's speech (`createPromptSpeech`) speaks only
 * behind the per-device voice preference.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createInMemoryProvider } from '@zodal/store';
import { exportCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { providePromptSpeech, type PromptSpeech } from '@thoremin/sdk-ui/enroll/speech';
import { scriptedCarve } from '../helpers/scripted_carve';
import { createFaceSessionStore } from '@thoremin/ext-faces/app/sessionStore';
import { createFaceTestStore } from '@thoremin/ext-faces/app/testStore';
import { createFaceModelStore, type FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { memoryThumbStore } from '@thoremin/ext-faces/app/thumbnails';
import { syntheticSource } from '@thoremin/ext-faces/app/sources';
import { syntheticExpressionVector } from '@thoremin/ext-faces/lib/synthetic';
import { FaceSessionView } from '@thoremin/ext-faces/panels/FaceSessionPanel';
import { createPromptSpeech } from '@/app/enroll/promptSpeech';
import { useVoice } from '@thoremin/sdk-ui/enroll/voiceRuntime';
import '@/app/dials/useDialsSettings';

let clock = 1000;
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
async function run(ms: number) {
  for (let t = 0; t < ms; t += 33) {
    clock += 33;
    await act(() => vi.advanceTimersByTimeAsync(33));
  }
}

function fakeSpeech() {
  const said: string[] = [];
  let on = false;
  const speech: PromptSpeech = { available: true, enabled: () => on, setEnabled: (v) => void (on = v), say: (t) => void said.push(t), stop: () => undefined };
  return { speech, said };
}

function opened() {
  const store = createFaceSessionStore({
    source: () => ({ ...syntheticSource(() => clock), video: () => null }),
    thumbs: memoryThumbStore(),
    frames: () => null,
    models: createFaceModelStore(createInMemoryProvider<FaceModelRecord>([], { idField: 'id', searchFields: ['name'] })),
    now: () => clock,
    pollMs: 33,
    claim: () => undefined,
    newTakeId: () => 'take-1',
    isoNow: () => '2026-10-19T00:00:00.000Z',
  });
  expect(store.getState().importFile(exportCategorizer(scriptedCarve()))).toBe(true);
  let frame = 0;
  const test = createFaceTestStore({
    source: () => ({ kind: 'synthetic', read: () => ({ vector: syntheticExpressionVector('rest', frame++), t: clock }), video: () => null, dispose: () => {} }),
    claim: () => undefined,
    now: () => clock,
    pollMs: 33,
    publishMs: 100,
  });
  render(<FaceSessionView store={store} test={test} />);
  return { test };
}

afterEach(() => {
  cleanup();
  providePromptSpeech(null);
  vi.useRealTimers();
  useVoice.setState({ enabled: false });
});

describe('the quiz says its prompts', () => {
  it('says Relax, then a category name, once each, when the box is ticked', async () => {
    vi.useFakeTimers();
    const { speech, said } = fakeSpeech();
    providePromptSpeech(speech);
    const { test } = opened();
    const box = document.querySelector('input[type="checkbox"]:not([data-faces-map-checkbox])') as HTMLInputElement;
    expect(box).not.toBeNull();
    act(() => void fireEvent.click(box));
    expect(speech.enabled()).toBe(true);
    act(() => void fireEvent.click(button('Quiz me')!));
    await run(300);
    expect(said).toEqual(['Relax']);
    await run(6000);
    expect(said.length).toBeGreaterThan(1);
    expect(said[1]).not.toBe('Relax');
    expect(new Set(said.slice(0, 2)).size).toBe(2);
    act(() => test.getState().stop());
  });

  it('is silent with the box off, and has no box where nothing speaks', async () => {
    vi.useFakeTimers();
    const { speech, said } = fakeSpeech();
    providePromptSpeech(speech);
    opened();
    act(() => void fireEvent.click(button('Quiz me')!));
    await run(300);
    expect(said).toEqual([]);
    cleanup();
    providePromptSpeech(null);
    opened();
    expect(document.querySelector('input[type="checkbox"]:not([data-faces-map-checkbox])')).toBeNull();
  });
});

describe('the host speech', () => {
  it('speaks only behind the voice preference, cutting off the last prompt', () => {
    const spoken: string[] = [];
    const cancel = vi.fn();
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
    const synth = { cancel, speak: (u: { text: string }) => void spoken.push(u.text) } as unknown as SpeechSynthesis;
    const speech = createPromptSpeech(() => synth);
    speech.say('frown');
    expect(spoken).toEqual([]);
    speech.setEnabled(true);
    expect(useVoice.getState().enabled).toBe(true);
    speech.say('frown');
    speech.say('  ');
    expect(spoken).toEqual(['frown']);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(createPromptSpeech(() => null).available).toBe(false);
    vi.unstubAllGlobals();
  });
});
