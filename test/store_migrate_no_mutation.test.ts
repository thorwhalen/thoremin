/**
 * `migrateControls` never mutates the blob it is given (#391 item 8). The persisted blob is
 * the caller's (zustand's rehydrate, a test, an import), and `migrateControls` only
 * shallow-copies it, so a step that edits a nested object in place edits theirs.
 *
 * The v<3 step (`migrateInstrumentField`, the `instrument` -> `sound` rename) and the v<5
 * step (the fearful / disgusted sensitivity retune) used to (#392 item 2, which names
 * both); they now copy, as the v<7, v<18 and v<21 steps do.
 */
import { describe, it, expect } from 'vitest';
import { migrateControls } from '@/app/store';

/** Run a migration and report the result and whether the input changed (deeply). */
function migrate(blob: Record<string, unknown>, version: number) {
  const before = structuredClone(blob);
  const out = migrateControls(blob, version) as unknown as Record<string, unknown>;
  return { out, before, after: blob };
}

describe('migrateControls does not mutate its input', () => {
  it('v<3: the instrument -> sound rename copies the per-hand and chord objects (#392 item 2)', () => {
    const blob = {
      right: { instrument: 'bell', octave: 4 },
      left: { instrument: 'reed' },
      faceChord: { instrument: 'glass', enabled: true },
    };
    const { out, before, after } = migrate(blob, 2);
    // The migration itself works...
    expect(out.right).toMatchObject({ sound: 'bell', octave: 4 });
    expect((out.right as Record<string, unknown>).instrument).toBeUndefined();
    expect(out.faceChord).toMatchObject({ sound: 'glass' });
    // ...and the caller's blob is untouched.
    expect(after).toEqual(before);
  });

  it('v<5: the fearful / disgusted retune copies faceExpr.sensitivity (#392 item 2)', () => {
    const blob = { faceExpr: { sensitivity: { fearful: 0.5, disgusted: 0.5, happy: 0.5 } } };
    const { out, before, after } = migrate(blob, 4);
    expect((out.faceExpr as { sensitivity: Record<string, number> }).sensitivity).toEqual({ fearful: 0.7, disgusted: 0.7, happy: 0.5 });
    expect(after).toEqual(before);
  });

  it('v<2: the faceEnabled -> faceMapping step', () => {
    const { out, before, after } = migrate({ faceEnabled: true }, 1);
    expect(out.faceEnabled).toBeUndefined();
    expect(out.faceMapping).toBeDefined();
    expect(after).toEqual(before);
  });

  it('v<7: lifting featureLab out of the overlay', () => {
    const { out, before, after } = migrate({ overlay: { featureLab: { show: true, columns: 5 }, landmarks: { show: true } } }, 6);
    expect(out.featureLab).toEqual({ show: true, columns: 5 });
    expect((out.overlay as Record<string, unknown>).featureLab).toBeUndefined();
    expect(after).toEqual(before);
  });

  it('v<18 and v<21: the trainer HUD default and the legacy conductor prior', () => {
    const { out, before, after } = migrate({ trainerHud: { show: true, position: 'top' }, conductor: { enabled: true } }, 17);
    expect((out.trainerHud as Record<string, unknown>).show).toBe(false);
    expect((out.conductor as Record<string, unknown>).prior).toBeDefined();
    expect(after).toEqual(before);
  });

  it('a v1 blob through every step leaves the input untouched (#392 item 2)', () => {
    const blob = {
      faceEnabled: true,
      right: { instrument: 'bell' },
      left: { instrument: 'reed' },
      faceChord: { instrument: 'glass' },
      faceExpr: { sensitivity: { fearful: 0.5, disgusted: 0.5 } },
      overlay: { featureLab: { show: true } },
      trainerHud: { show: true },
      conductor: { enabled: false },
    };
    const { before, after } = migrate(blob, 1);
    expect(after).toEqual(before);
  });
});
