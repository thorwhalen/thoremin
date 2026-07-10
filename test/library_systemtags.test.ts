/**
 * System-tag derivation (issue #114), exercised against the real seed instruments. Every
 * derived tag must be namespaced `sys:*` (so it can never be stored as a custom
 * association), scale quality always leads, and the mode/split/finger-FX tags appear
 * exactly when the instrument's parametrization calls for them.
 */
import { describe, it, expect } from 'vitest';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { layerToSettings } from '@/settings/dials';
import { systemTagsForSettings } from '@/app/library/systemTags';
import { SYSTEM_TAG_PREFIX } from '@/app/library/model';

const idsOf = (name: string): string[] => {
  const seed = SEED_INSTRUMENTS.find((s) => s.name === name);
  if (!seed) throw new Error(`seed not found: ${name}`);
  return systemTagsForSettings(layerToSettings(seed.layer)).map((t) => t.id);
};

describe('deriveSystemTags (seed fixtures)', () => {
  it('every derived id is namespaced and every tag carries an emoji + label', () => {
    for (const seed of SEED_INSTRUMENTS) {
      const tags = systemTagsForSettings(layerToSettings(seed.layer));
      for (const t of tags) {
        expect(t.id.startsWith(SYSTEM_TAG_PREFIX)).toBe(true);
        expect(t.emoji.length).toBeGreaterThan(0);
        expect(t.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('scale quality always leads the list', () => {
    for (const seed of SEED_INSTRUMENTS) {
      const tags = systemTagsForSettings(layerToSettings(seed.layer));
      expect(tags[0]?.id.startsWith(`${SYSTEM_TAG_PREFIX}scale:`)).toBe(true);
    }
  });

  it('the gentle default: pentatonic-major + index, nothing else', () => {
    const ids = idsOf('Pentatonic');
    expect(ids).toContain(`${SYSTEM_TAG_PREFIX}scale:pentatonicMajor`);
    expect(ids).toContain(`${SYSTEM_TAG_PREFIX}note:index`);
    expect(ids.some((i) => i.startsWith(`${SYSTEM_TAG_PREFIX}face:`))).toBe(false);
    expect(ids).not.toContain(`${SYSTEM_TAG_PREFIX}voices:split`);
    expect(ids).not.toContain(`${SYSTEM_TAG_PREFIX}fingerfx`);
  });

  it('Split Voices flags split + major', () => {
    const ids = idsOf('Split Voices');
    expect(ids).toContain(`${SYSTEM_TAG_PREFIX}voices:split`);
    expect(ids).toContain(`${SYSTEM_TAG_PREFIX}scale:major`);
  });

  it('Finger FX flags wrist + finger FX', () => {
    const ids = idsOf('Finger FX');
    expect(ids).toContain(`${SYSTEM_TAG_PREFIX}note:wrist`);
    expect(ids).toContain(`${SYSTEM_TAG_PREFIX}fingerfx`);
  });

  it('face modes: Glass Bells -> chord, Everything -> expression', () => {
    expect(idsOf('Glass Bells')).toContain(`${SYSTEM_TAG_PREFIX}face:chord`);
    expect(idsOf('Everything')).toContain(`${SYSTEM_TAG_PREFIX}face:expression`);
  });
});
