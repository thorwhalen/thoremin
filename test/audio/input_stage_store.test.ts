// @vitest-environment jsdom
/**
 * The device's input-stage record lives in the SDK's app half (#881), so the app, a slice and a
 * standalone page read and write ONE record: hydrated from the storage key the app always used,
 * written through on a set, refused when no device could have it, and still reached through the
 * app's old import path.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import * as sdk from '@thoremin/sdk-ui/audio/inputStage';
import * as app from '@/app/audio/inputStage';
import { createAudioInputHub, type HubDeps } from '@thoremin/sdk-ui/audio/hub';

const { INPUT_STAGE_STORAGE_KEY, createInputStageStore, parseInputStageRecord } = sdk;
const AT = '2026-11-03T10:00:00.000Z';
const fixedNow = () => new Date(AT);

describe('the input-stage store (@thoremin/sdk-ui/audio/inputStage)', () => {
  beforeEach(() => localStorage.clear());

  it('hydrates the record kept under the key the app always used', async () => {
    expect(INPUT_STAGE_STORAGE_KEY).toBe('thoremin.audio.inputStage');
    localStorage.setItem(INPUT_STAGE_STORAGE_KEY, JSON.stringify([{ id: 'device', seconds: 0.023, source: 'loopback', at: AT }]));
    const store = createInputStageStore();
    await store.getState().hydrate();
    expect(store.getState().stage).toEqual({ id: 'device', seconds: 0.023, source: 'loopback', at: AT });
  });

  it('writes a set through, so another page on the origin reads it', async () => {
    const page = createInputStageStore({ now: fixedNow });
    await page.getState().hydrate();
    page.getState().set({ seconds: 0.031, source: 'loopback' });
    await new Promise((r) => setTimeout(r, 0));
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
    expect(app.inputStageStore).toBe(sdk.inputStageStore);
    const hub = createAudioInputHub({ storedInputStage: sdk.storedInputStage } as unknown as HubDeps);
    app.setInputStage({ seconds: 0.027, source: 'loopback' });
    expect(hub.inputStage()).toEqual({ seconds: 0.027, source: 'loopback' });
    app.setInputStage(null);
    expect(hub.inputStage().source).toBe('prior');
  });
});
