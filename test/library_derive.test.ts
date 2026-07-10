/**
 * The instrument -> derived-view bridge (issues #114/#115), exercised against the REAL
 * seeded profile store: after seeding, every shipped instrument projects to a summary +
 * system tags, and the derivation resolves a sparse/UNSET-bearing saved layer to the same
 * effective facts the engine would see.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { ensureSeeded, SEED_INSTRUMENTS, instruments } from '@/app/dials/instruments';
import { deriveForName, deriveForNames, settingsFromLayer } from '@/app/library/derive';
import { UNSET } from '@zodal/dials-core';

const NAMES = SEED_INSTRUMENTS.map((s) => s.name);

describe('deriveForNames (seeded store)', () => {
  beforeAll(async () => {
    await ensureSeeded();
  });

  it('projects every seeded instrument to a summary + system tags', async () => {
    const derived = await deriveForNames(NAMES);
    for (const name of NAMES) {
      expect(derived[name]).toBeDefined();
      expect(derived[name].systemTags.length).toBeGreaterThan(0);
      expect(derived[name].summary.scaleLabel.length).toBeGreaterThan(0);
    }
  });

  it('deriveForName returns null for a missing instrument', async () => {
    expect(await deriveForName('No Such Instrument')).toBeNull();
  });

  it('Split Voices derives the split-voices system tag', async () => {
    const d = await deriveForName('Split Voices');
    expect(d?.systemTags.some((t) => t.id === 'sys:voices:split')).toBe(true);
  });
});

describe('settingsFromLayer', () => {
  it('lets a default win where the saved layer UNSETs a key', async () => {
    const layer = await instruments.load('Pentatonic');
    expect(layer).toBeTruthy();
    // Reset the right-hand scale in the saved layer -> the dials default (pentatonic) wins.
    const withUnset = { ...(layer as Record<string, unknown>), 'right.type': UNSET };
    const s = settingsFromLayer(withUnset as never);
    expect(s.right.type).toBe('pentatonic');
  });
});
