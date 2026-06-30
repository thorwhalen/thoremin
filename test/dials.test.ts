/**
 * thoreminDials — the zodal-dials settings surface + the nested↔flat bridge that
 * lets the dials layer (panel + instruments) drive the nested Settings the store
 * and persistence speak. Pins: the dials defaults equal the Settings defaults, the
 * settingsToLayer/layerToSettings bijection round-trips, and the chord-needs-a-
 * 7-note-scale constraint fires.
 */
import { describe, it, expect } from 'vitest';
import { thoreminDials, settingsToLayer, layerToSettings } from '@/settings/dials';
import { SettingsSchema, type Settings } from '@/settings/schema';

const sample = (over: Partial<Settings> = {}): Settings =>
  SettingsSchema.parse({
    right: { root: 7, type: 'major', octaves: 3, baseOctave: 4, sound: 'bell' },
    left: { root: 0, type: 'pentatonic', octaves: 2, baseOctave: 3, sound: 'glass' },
    syncHands: false,
    masterVolume: 0.6,
    faceMapping: 'chord',
    overlay: {},
    ...over,
  });

describe('thoreminDials', () => {
  it('exposes the full keyspace with defaults matching the Settings defaults', () => {
    const { effective } = thoreminDials.resolve([{ scope: 'default', layer: thoreminDials.defaults }]);
    expect(effective['master.volume']).toBe(0.4);
    expect(effective['master.syncHands']).toBe(true);
    expect(effective['right.sound']).toBe('warmPad');
    expect(effective['left.sound']).toBe('glass');
    expect(effective['right.type']).toBe('pentatonic');
    expect(effective['face.mapping']).toBe('none');
    expect(effective['faceChord.voicing']).toBe('spread');
    // The structured (object) dials carry whole values.
    expect((effective['faceExpr.degrees'] as Record<string, number>).neutral).toBe(-1);
    expect((effective['overlay'] as { video: { show: boolean } }).video.show).toBe(true);
  });

  it('the dials defaults map back to a valid Settings with the canonical defaults', () => {
    const s = layerToSettings(thoreminDials.defaults as Record<string, unknown>);
    expect(s.masterVolume).toBe(0.4);
    expect(s.syncHands).toBe(true);
    expect(s.right).toEqual({ root: 0, type: 'pentatonic', octaves: 2, baseOctave: 3, sound: 'warmPad' });
    expect(s.left).toEqual({ root: 0, type: 'pentatonic', octaves: 2, baseOctave: 3, sound: 'glass' });
    expect(s.faceMapping).toBe('none');
    expect(s.faceChord.sound).toBe('warmPad');
  });

  it('settingsToLayer → layerToSettings round-trips (defaults + a custom snapshot)', () => {
    for (const s of [sample(), sample({ masterVolume: 0.9, faceMapping: 'timbre' })]) {
      expect(layerToSettings(settingsToLayer(s))).toEqual(s);
    }
  });

  it('enforces the chord-needs-a-7-note-scale constraint', () => {
    const base = thoreminDials.defaults as Record<string, unknown>;
    expect(thoreminDials.validate({ ...base, 'face.mapping': 'chord', 'right.type': 'pentatonic' }).ok).toBe(false);
    expect(thoreminDials.validate({ ...base, 'face.mapping': 'chord', 'right.type': 'major' }).ok).toBe(true);
    expect(thoreminDials.validate({ ...base, 'face.mapping': 'timbre', 'right.type': 'pentatonic' }).ok).toBe(true);
  });
});
