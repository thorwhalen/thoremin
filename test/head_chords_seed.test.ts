/**
 * The head-pose chord (#76) has an instrument: Head Chords composes the face's control axes and
 * the pose chord (the `face-controls` branch), voice-led, and no emotion chord.
 */
import { describe, it, expect } from 'vitest';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';
import { branchIdsFor } from '@/app/graph';

describe('Head Chords', () => {
  it('plays the pose chord from the head, voice-led', () => {
    const s = settingsFromLayer(SEED_INSTRUMENTS.find((x) => x.name === 'Head Chords')!.layer);
    expect(s.faceMapping).toBe('controls');
    expect(s.faceChord.voicing).toBe('voiceLed');
    const ids = branchIdsFor(s);
    expect(ids).toContain('face-controls');
    expect(ids).not.toContain('face-chord');
  });
});
