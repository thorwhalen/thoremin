/**
 * Conduct the Chords (Body): the chord chart conducted with the body (#375's body conductor), so
 * the seed composes the conductor reading the body camera, and the chord chart on its beat.
 */
import { describe, expect, it } from 'vitest';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';
import { branchIdsFor } from '@/app/graph';
import { BODY, CONDUCTOR, HARMONY } from '../helpers/extensions';

describe.runIf(HARMONY && CONDUCTOR && BODY)('Conduct the Chords (Body)', () => {
  it('conducts with the body: the conductor, the body camera and the chord chart', () => {
    const s = settingsFromLayer(SEED_INSTRUMENTS.find((x) => x.name === 'Conduct the Chords (Body)')!.layer) as unknown as Record<string, Record<string, unknown>>;
    expect(s.conductor).toMatchObject({ enabled: true, source: 'body', piece: 'haydn-op76-3' });
    expect(branchIdsFor(s as never)).toEqual(expect.arrayContaining(['conductor', 'body-source', 'chord-chart']));
  });
});
