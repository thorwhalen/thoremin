/**
 * Recording naming helpers (#88): the pure stem/timestamp/filename composition
 * that all sinks share. Mirrors the style of test/recording.test.ts for the
 * older `recordingFilename` helper it supersedes.
 */
import { describe, it, expect } from 'vitest';
import { compactStamp, prefillName, recordingStem, fileName } from '@/app/recording/naming';

const ISO = '2026-07-05T14:30:12.345Z';

describe('compactStamp', () => {
  it('drops colons and fractional seconds, keeps the sortable T form', () => {
    expect(compactStamp(ISO)).toBe('2026-07-05T14-30-12');
  });
  it('accepts a Date as well as an ISO string', () => {
    expect(compactStamp(new Date(ISO))).toBe('2026-07-05T14-30-12');
  });
  it('handles a stamp without fractional seconds', () => {
    expect(compactStamp('2026-07-05T14:30:12Z')).toBe('2026-07-05T14-30-12');
  });
});

describe('prefillName', () => {
  it('composes {tag-}{instrument}-{stamp}, slugging id tokens', () => {
    expect(prefillName({ instrument: 'theremin', tag: 'demo', date: ISO })).toBe(
      'demo-theremin-2026-07-05T14-30-12',
    );
  });
  it('omits the tag cleanly when absent (no double dash)', () => {
    expect(prefillName({ instrument: 'theremin', date: ISO })).toBe('theremin-2026-07-05T14-30-12');
  });
  it('slugs a spaced/cased instrument id', () => {
    expect(prefillName({ instrument: 'Swing Piano', date: ISO })).toBe(
      'swing-piano-2026-07-05T14-30-12',
    );
  });
});

describe('recordingStem', () => {
  it('preserves case and the timestamp T, collapsing unsafe runs to one dash', () => {
    expect(recordingStem('My Take!! 2026-07-05T14-30-12')).toBe('My-Take-2026-07-05T14-30-12');
  });
  it('replaces path separators and dots', () => {
    expect(recordingStem('a/b\\c.d')).toBe('a-b-c-d');
  });
  it('falls back to "recording" for an empty/blank name', () => {
    expect(recordingStem('   ')).toBe('recording');
    expect(recordingStem('!!!')).toBe('recording');
  });
});

describe('fileName', () => {
  it('composes a bare primary-ext name with no role', () => {
    expect(fileName('stem', { ext: 'webm' })).toBe('stem.webm');
  });
  it('inserts the role as a secondary extension', () => {
    expect(fileName('stem', { role: 'overlay', ext: 'webm' })).toBe('stem.overlay.webm');
    expect(fileName('stem', { role: 'features', ext: 'jsonl' })).toBe('stem.features.jsonl');
  });
});
