/**
 * Preset-SPECIFIC persistence: what the settings schema round-trips (voices, the octave
 * range, the overlay element config) and how it migrates/heals older preset blobs.
 *
 * The generic CRUD contract these presets share with the saved lab views (slug ids,
 * save/overwrite, ordering, remove, missing → null) is asserted once for both in
 * `named_collection.test.ts`. Uses an in-memory provider, so it runs in Node with no
 * localStorage.
 */
import { describe, it, expect } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { createPresetStore } from '@/settings/presets';
import { PresetSchema, SettingsSchema, DEFAULT_FACE_CHORD, type Preset, type Settings } from '@/settings/schema';
import { expressionThresholds, DEFAULT_EXPRESSION_TO_DEGREE } from '@/music/expression';

function sampleSettings(overrides: Partial<Settings> = {}): Settings {
  return SettingsSchema.parse({
    right: { root: 0, type: 'pentatonic', octaves: 2, baseOctave: 3, sound: 'warmPad' },
    left: { root: 0, type: 'pentatonic', octaves: 2, baseOctave: 3, sound: 'glass' },
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

  it('round-trips the settings payload (voices + master volume)', async () => {
    const s = store();
    await s.save('Swing Lead', sampleSettings({ masterVolume: 0.7 }), 1000);
    const loaded = await s.load('swing-lead');
    expect(loaded?.settings.masterVolume).toBeCloseTo(0.7);
    expect(loaded?.settings.right.sound).toBe('warmPad');
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

  it('round-trips a per-voice fractional octave range (#63)', async () => {
    const s = store();
    const settings = sampleSettings({
      right: { root: 0, type: 'pentatonic', octaves: 3, baseOctave: 3, sound: 'warmPad', rangeLow: 0.5, rangeHigh: 1 },
    });
    await s.save('Wide Range', settings, 1000);
    const loaded = await s.load('wide-range');
    expect(loaded?.settings.right.rangeLow).toBe(0.5);
    expect(loaded?.settings.right.rangeHigh).toBe(1);
    // A voice without range is preserved as absent (the legacy octaves span → identical sound).
    expect(loaded?.settings.left.rangeLow).toBeUndefined();
  });


  it('rejects out-of-range settings at the schema boundary', () => {
    expect(() => sampleSettings({ masterVolume: 5 })).toThrow();
    expect(() =>
      SettingsSchema.parse({ ...sampleSettings(), right: { ...sampleSettings().right, sound: 'bogus' } }),
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

  it('a pre-kiss faceExpr blob: the consumer heals the missing kiss key', () => {
    // The preset schema (z.record.default) does NOT backfill per-key, so a blob with
    // only the six original emotions leaves `kiss` undefined — the CONSUMERS fill it.
    const parsed = SettingsSchema.parse({
      ...sampleSettings(),
      faceExpr: {
        sensitivity: { happy: 0.5, sad: 0.5, angry: 0.5, surprised: 0.5, fearful: 0.5, disgusted: 0.5 },
        degrees: { happy: 0, fearful: 1, disgusted: 2, surprised: 3, angry: 4, sad: 5, neutral: -1 },
      },
    });
    expect(parsed.faceExpr.sensitivity.kiss).toBeUndefined(); // schema leaves it absent
    // expressionThresholds heals via ?? DEFAULT_EXPRESSION_SENSITIVITY.kiss → bar 0.375.
    expect(expressionThresholds(parsed.faceExpr.sensitivity as never).kiss).toBeCloseTo(0.375);
    // expression-chord's degreeFor falls back to the kiss default (vii°) for the missing key.
    expect(parsed.faceExpr.degrees.kiss ?? DEFAULT_EXPRESSION_TO_DEGREE.kiss).toBe(6);
  });

  it('persists a player-set silence assignment and rejects an out-of-range degree', () => {
    // A non-neutral expression assigned to silence (-1) must survive the schema.
    const parsed = SettingsSchema.parse({ ...sampleSettings(), faceExpr: { degrees: { happy: -1 } } });
    expect(parsed.faceExpr.degrees.happy).toBe(-1);
    // The new lower bound (min -1) still rejects -2 and the max still rejects 7.
    expect(SettingsSchema.safeParse({ ...sampleSettings(), faceExpr: { degrees: { happy: -2 } } }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...sampleSettings(), faceExpr: { degrees: { happy: 7 } } }).success).toBe(false);
  });

  it('migrates a pre-rename preset (instrument → sound, per-hand + chord) on load', () => {
    const legacy = {
      id: 'old-sound',
      name: 'Old Sound',
      createdAt: 1,
      settings: {
        right: { root: 0, type: 'pentatonic', octaves: 2, baseOctave: 3, instrument: 'bell' }, // old key
        left: { root: 0, type: 'pentatonic', octaves: 2, baseOctave: 3, instrument: 'square' },
        syncHands: true,
        masterVolume: 0.4,
        faceChord: { instrument: 'triangle', volume: 0.22, voicing: 'spread', rendering: 'sustained', bpm: 100 },
        overlay: {},
      },
    };
    const parsed = PresetSchema.parse(legacy);
    expect(parsed.settings.right.sound).toBe('bell'); // returning preset keeps its sound
    expect(parsed.settings.left.sound).toBe('square');
    expect(parsed.settings.faceChord.sound).toBe('triangle');
    expect((parsed.settings.right as Record<string, unknown>).instrument).toBeUndefined();
  });

  it('migrates a pre-#64 preset (boolean faceEnabled) to faceMapping on load', () => {
    const legacy = {
      id: 'legacy',
      name: 'Legacy',
      createdAt: 1,
      settings: {
        right: { root: 0, type: 'pentatonic', octaves: 2, baseOctave: 3, sound: 'warmPad' },
        left: { root: 0, type: 'pentatonic', octaves: 2, baseOctave: 3, sound: 'glass' },
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
