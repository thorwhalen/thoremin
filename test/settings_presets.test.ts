/**
 * Tests the preset persistence core (src/settings) against the zodal
 * `DataProvider` contract, using an in-memory provider so it runs in Node with no
 * localStorage. Proves the backend is swappable (the same PresetStore works over
 * any provider) and that the schema round-trips voices + overlay element config.
 */
import { describe, it, expect } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { createPresetStore, presetId } from '@/settings/presets';
import { PresetSchema, SettingsSchema, DEFAULT_FACE_CHORD, type Preset, type Settings } from '@/settings/schema';

function sampleSettings(overrides: Partial<Settings> = {}): Settings {
  return SettingsSchema.parse({
    right: { root: 0, type: 'pentatonic', octaves: 2, baseOctave: 3, instrument: 'warmPad' },
    left: { root: 0, type: 'pentatonic', octaves: 2, baseOctave: 3, instrument: 'glass' },
    syncHands: true,
    masterVolume: 0.4,
    overlay: {}, // overlay element defaults fill in
    ...overrides,
  });
}

function store() {
  return createPresetStore(createInMemoryProvider<Preset>([], { searchFields: ['name'] }));
}

describe('preset persistence', () => {
  it('presetId slugifies names into stable ids', () => {
    expect(presetId('My Cool Setup!')).toBe('my-cool-setup');
    expect(presetId('  Bossa   Nova  ')).toBe('bossa-nova');
    expect(presetId('***')).toBe('preset'); // never empty
  });

  it('saves, lists, and round-trips a preset', async () => {
    const s = store();
    await s.save('Swing Lead', sampleSettings({ masterVolume: 0.7 }), 1000);
    const list = await s.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'swing-lead', name: 'Swing Lead', createdAt: 1000 });

    const loaded = await s.load('swing-lead');
    expect(loaded?.settings.masterVolume).toBeCloseTo(0.7);
    expect(loaded?.settings.right.instrument).toBe('warmPad');
  });

  it('persists overlay element config (the composable overlay state)', async () => {
    const s = store();
    const settings = sampleSettings({
      overlay: SettingsSchema.shape.overlay.parse({
        indexGuide: { show: true, dashed: false },
        video: { show: true, alpha: 0.1 },
      }),
    });
    await s.save('Index Guide On', settings, 2000);
    const loaded = await s.load('index-guide-on');
    expect(loaded?.settings.overlay.indexGuide.show).toBe(true);
    expect(loaded?.settings.overlay.indexGuide.dashed).toBe(false);
    expect(loaded?.settings.overlay.video.alpha).toBeCloseTo(0.1);
  });

  it('saving the same name overwrites instead of duplicating', async () => {
    const s = store();
    await s.save('My Setup', sampleSettings({ masterVolume: 0.2 }), 1000);
    await s.save('My Setup', sampleSettings({ masterVolume: 0.9 }), 2000);
    const list = await s.list();
    expect(list).toHaveLength(1);
    const loaded = await s.load('my-setup');
    expect(loaded?.settings.masterVolume).toBeCloseTo(0.9);
    expect(loaded?.createdAt).toBe(2000);
  });

  it('orders newest first and removes by id', async () => {
    const s = store();
    await s.save('Old', sampleSettings(), 1000);
    await s.save('New', sampleSettings(), 3000);
    expect((await s.list()).map((p) => p.id)).toEqual(['new', 'old']);

    await s.remove('old');
    expect((await s.list()).map((p) => p.id)).toEqual(['new']);
  });

  it('load of a missing preset returns null', async () => {
    expect(await store().load('nope')).toBeNull();
  });

  it('rejects out-of-range settings at the schema boundary', () => {
    expect(() => sampleSettings({ masterVolume: 5 })).toThrow();
    expect(() =>
      SettingsSchema.parse({ ...sampleSettings(), right: { ...sampleSettings().right, instrument: 'bogus' } }),
    ).toThrow();
  });

  it('defaults faceMapping to none when omitted', () => {
    expect(sampleSettings().faceMapping).toBe('none');
  });

  it('defaults faceChord when omitted (pre-chord-feature presets)', () => {
    expect(sampleSettings().faceChord).toEqual(DEFAULT_FACE_CHORD);
  });

  it('defaults faceExpr when omitted (pre-expression-mapping presets)', () => {
    const fe = sampleSettings().faceExpr;
    expect(fe.sensitivity.angry).toBe(0.45); // DEFAULT_EXPRESSION_SENSITIVITY.angry
    expect(fe.degrees.neutral).toBe(-1); // SILENCE_DEGREE — a resting face plays nothing by default
    expect(fe.degrees.happy).toBe(0); // emotions keep the confusion-aware default (happy → tonic)
  });

  it('persists a player-set silence assignment and rejects an out-of-range degree', () => {
    // A non-neutral expression assigned to silence (-1) must survive the schema.
    const parsed = SettingsSchema.parse({ ...sampleSettings(), faceExpr: { degrees: { happy: -1 } } });
    expect(parsed.faceExpr.degrees.happy).toBe(-1);
    // The new lower bound (min -1) still rejects -2 and the max still rejects 7.
    expect(SettingsSchema.safeParse({ ...sampleSettings(), faceExpr: { degrees: { happy: -2 } } }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...sampleSettings(), faceExpr: { degrees: { happy: 7 } } }).success).toBe(false);
  });

  it('migrates a pre-#64 preset (boolean faceEnabled) to faceMapping on load', () => {
    const legacy = {
      id: 'legacy',
      name: 'Legacy',
      createdAt: 1,
      settings: {
        right: { root: 0, type: 'pentatonic', octaves: 2, baseOctave: 3, instrument: 'warmPad' },
        left: { root: 0, type: 'pentatonic', octaves: 2, baseOctave: 3, instrument: 'glass' },
        syncHands: true,
        masterVolume: 0.4,
        faceEnabled: true, // the old boolean flag
        overlay: {},
      },
    };
    const parsed = PresetSchema.parse(legacy);
    expect(parsed.settings.faceMapping).toBe('timbre');
    expect((parsed.settings as Record<string, unknown>).faceEnabled).toBeUndefined();

    // The false branch maps to 'none'.
    const off = { ...legacy, settings: { ...legacy.settings, faceEnabled: false } };
    expect(PresetSchema.parse(off).settings.faceMapping).toBe('none');
  });
});
