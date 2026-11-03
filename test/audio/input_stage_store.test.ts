// @vitest-environment jsdom
/**
 * The device's input-stage record lives in the SDK's app half (#881), so the app, a slice and a
 * standalone page read and write ONE record: hydrated from the storage key the app always used,
 * written through on a set, refused when no device could have it, still reached through the app's
 * old import path. And the review's cases (#881 review): a page with site data blocked still loads,
 * another tab's write is taken in, and a forget made before hydration is not undone by it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as sdk from '@thoremin/sdk-ui/audio/inputStage';
import * as app from '@/app/audio/inputStage';
import { createAudioInputHub, type HubDeps } from '@thoremin/sdk-ui/audio/hub';

const { INPUT_STAGE_STORAGE_KEY, createInputStageStore, parseInputStageRecord } = sdk;
const AT = '2026-11-03T10:00:00.000Z';
const fixedNow = () => new Date(AT);
const RECORD = { id: 'device', seconds: 0.023, source: 'loopback', at: AT };
/** Let the store's writes (promises on the provider) land. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the input-stage store (@thoremin/sdk-ui/audio/inputStage)', () => {
  beforeEach(() => localStorage.clear());

  it('hydrates the record kept under the key the app always used', async () => {
    expect(INPUT_STAGE_STORAGE_KEY).toBe('thoremin.audio.inputStage');
    localStorage.setItem(INPUT_STAGE_STORAGE_KEY, JSON.stringify([RECORD]));
    const store = createInputStageStore();
    await store.getState().hydrate();
    expect(store.getState().stage).toEqual(RECORD);
  });

  it('writes a set through, so another page on the origin reads it', async () => {
    const page = createInputStageStore({ now: fixedNow });
    await page.getState().hydrate();
    page.getState().set({ seconds: 0.031, source: 'loopback' });
    await settle();
    const camera = createInputStageStore();
    await camera.getState().hydrate();
    expect(camera.getState().stage).toEqual({ id: 'device', seconds: 0.031, source: 'loopback', at: AT });
  });

  it('refuses a stage no device may keep, and reads a broken record as none', async () => {
    const store = createInputStageStore();
    expect(() => store.getState().set({ seconds: -0.01, source: 'loopback' })).toThrow(RangeError);
    expect(() => store.getState().set({ seconds: 2, source: 'loopback' })).toThrow(/0\.\.1/);
    expect(parseInputStageRecord({ id: 'device', seconds: 0.02, source: 'guess', at: AT })).toBeNull();
    localStorage.setItem(INPUT_STAGE_STORAGE_KEY, JSON.stringify([{ id: 'device', seconds: 'soon' }]));
    const fresh = createInputStageStore();
    await fresh.getState().hydrate();
    expect(fresh.getState().stage).toBeNull();
  });

  it('is the store the app imports, and the hub converts with what it holds', () => {
    expect(app.setInputStage).toBe(sdk.setInputStage);
    expect(app.storedInputStage).toBe(sdk.storedInputStage);
    expect(app.inputStageStore()).toBe(sdk.inputStageStore());
    const hub = createAudioInputHub({ storedInputStage: sdk.storedInputStage } as unknown as HubDeps);
    app.setInputStage({ seconds: 0.027, source: 'loopback' });
    expect(hub.inputStage()).toEqual({ seconds: 0.027, source: 'loopback' });
    app.setInputStage(null);
    expect(hub.inputStage().source).toBe('prior');
  });

  it('a forget made before hydration finished stays forgotten', async () => {
    localStorage.setItem(INPUT_STAGE_STORAGE_KEY, JSON.stringify([RECORD]));
    const store = createInputStageStore();
    const hydrating = store.getState().hydrate();
    store.getState().set(null);
    await hydrating;
    await settle();
    expect(store.getState().stage).toBeNull();
    const fresh = createInputStageStore();
    await fresh.getState().hydrate();
    expect(fresh.getState().stage).toBeNull();
  });

  it('takes in a stage another tab measured (a storage event for the key)', async () => {
    const here = createInputStageStore();
    await here.getState().hydrate();
    const there = createInputStageStore({ now: fixedNow });
    there.getState().set({ seconds: 0.04, source: 'loopback' });
    await settle();
    expect(here.getState().stage).toBeNull();
    window.dispatchEvent(new StorageEvent('storage', { key: 'some.other.key' }));
    await settle();
    expect(here.getState().stage).toBeNull();
    window.dispatchEvent(new StorageEvent('storage', { key: INPUT_STAGE_STORAGE_KEY }));
    await settle();
    expect(here.getState().stage).toEqual({ id: 'device', seconds: 0.04, source: 'loopback', at: AT });
  });
});

describe('with site data blocked (touching localStorage throws)', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  });
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
  });

  it('the module loads, reads no stage, and keeps a set for the session', async () => {
    const m = await import('@thoremin/sdk-ui/audio/inputStage');
    expect(m.storedInputStage()).toBeNull();
    await m.hydrateInputStage();
    m.setInputStage({ seconds: 0.03, source: 'loopback' });
    await settle();
    expect(m.storedInputStage()).toEqual({ seconds: 0.03, source: 'loopback' });
  });
});
