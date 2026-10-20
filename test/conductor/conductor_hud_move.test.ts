/**
 * The beat ring's show flag moved from core's overlay dial (`overlay.conductorHud`) into the
 * conductor's own (`conductor.hudOnVideo`) with its element (#600 S18c): a returning player's hot
 * store and a saved instrument that hid the ring keep it hidden, and one already moved is left alone.
 */
import { describe, expect, it } from 'vitest';
import { normalizeLayer } from '@/app/dials/instruments';
import { mergeControls, migrateControls, useControls } from '@/app/store';
import { DEFAULT_CONDUCTOR, migrateConductorV2 } from '@/slices/conductor/schema';
import { CONDUCTOR } from '../helpers/extensions';

const hidden = { overlay: { conductorHud: { show: false } } };
/** The conductor dial as stored before the move: no `hudOnVideo` key at all. */
const { hudOnVideo: _moved, ...beforeMove } = DEFAULT_CONDUCTOR;
void _moved;

describe.runIf(CONDUCTOR)('the beat ring\'s show flag moves into the conductor dial', () => {
  it('a returning player who hid the ring keeps it hidden (blob written before the slice, and by #696)', () => {
    const rehydrate = (blob: Record<string, unknown>) => mergeControls(migrateControls(blob, 26), useControls.getState());
    for (const sliceVersions of [undefined, { conductor: 2 }]) {
      const state = rehydrate({ ...hidden, conductor: beforeMove, ...(sliceVersions ? { sliceVersions } : {}) });
      expect(state.conductor.hudOnVideo).toEqual({ show: false });
      expect((state.overlay as Record<string, unknown>).conductorHud).toBeUndefined();
    }
    // Nothing stored: the default, shown.
    expect(rehydrate({ conductor: { enabled: false } }).conductor.hudOnVideo).toEqual({ show: true });
  });

  it('a saved instrument that hid the ring keeps it hidden', () => {
    const healed = normalizeLayer({ ...hidden, conductor: beforeMove });
    expect((healed.conductor as { hudOnVideo: unknown }).hudOnVideo).toEqual({ show: false });
  });

  it('the step is idempotent and moves only a valid value', () => {
    const moved = { enabled: true, hudOnVideo: { show: true } };
    expect(migrateConductorV2(moved, hidden)).toBe(moved);
    expect(migrateConductorV2({ enabled: true }, { overlay: { conductorHud: { show: null } } })).toEqual({ enabled: true });
  });
});
