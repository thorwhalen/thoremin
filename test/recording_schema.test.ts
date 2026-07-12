/**
 * Recording-session schema (#88): defaults, forward-compat (`.default` on every
 * field), and the safeParse-with-fallback the persistence layer relies on.
 *
 * Also pins the SSOT link for the format default. That one needs a SOURCE-TEXT
 * check, not a value check: a re-hardcoded `['webm']` literal in the schema
 * agrees with the constant today, so every value assertion stays green while the
 * duplication is back. See `takes its formats default FROM the constant` below.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  RecordingSessionSchema,
  DEFAULT_RECORDING_SESSION,
  parseSession,
  hasAnyStream,
} from '@/app/recording/schema';
import { DEFAULT_RECORDING_FORMATS } from '@/app/recording/formats';

const SCHEMA_SOURCE = readFileSync(
  fileURLToPath(new URL('../src/app/recording/schema.ts', import.meta.url)),
  'utf8',
);

/**
 * The source text of a `RecordingSessionSchema` field's `.default(...)` argument.
 * Field boundary = the next key at the object's indent, so a prettier reflow of
 * the field across lines doesn't break this.
 */
function defaultExprSource(field: string): string {
  const at = SCHEMA_SOURCE.indexOf(`\n  ${field}:`);
  if (at < 0) throw new Error(`schema.ts: no field "${field}"`);
  const rest = SCHEMA_SOURCE.slice(at + 1);
  const nextField = rest.search(/\n {2}[A-Za-z_]\w*:/);
  const fieldSource = nextField < 0 ? rest : rest.slice(0, nextField);

  const open = fieldSource.indexOf('.default(');
  if (open < 0) throw new Error(`schema.ts: field "${field}" has no .default(...)`);
  const argStart = open + '.default('.length;
  let depth = 1;
  let i = argStart;
  while (i < fieldSource.length && depth > 0) {
    if (fieldSource[i] === '(') depth += 1;
    else if (fieldSource[i] === ')') depth -= 1;
    i += 1;
  }
  return fieldSource.slice(argStart, i - 1);
}

describe('DEFAULT_RECORDING_SESSION', () => {
  it('is audio-only, downloads, 30fps, webm', () => {
    expect(DEFAULT_RECORDING_SESSION.location).toBe('downloads');
    expect(DEFAULT_RECORDING_SESSION.fps).toBe(30);
    expect(DEFAULT_RECORDING_SESSION.formats).toEqual(['webm']);
    expect(DEFAULT_RECORDING_SESSION.streams.audio).toBe(true);
    expect(DEFAULT_RECORDING_SESSION.streams.overlayVideo).toBe(false);
    expect(DEFAULT_RECORDING_SESSION.singleFileWhenAlone).toBe(false);
  });

  // The format default has ONE home: the registry constant. A value assertion
  // CANNOT pin that — reverting the schema to `.default(['webm'])` re-creates the
  // duplication while every value stays identical. Only the source text can tell
  // "derived" from "coincidentally equal", so that is what we assert.
  it('takes its formats default FROM the constant, not a re-hardcoded literal', () => {
    const expr = defaultExprSource('formats');
    expect(expr).toContain('DEFAULT_RECORDING_FORMATS');
    // No string literal anywhere in the default expression: a format id spelled
    // out here would be a second home for the shipped default.
    expect(expr).not.toMatch(/['"`]/);
    // ...and the derived value is in fact the constant's.
    expect(DEFAULT_RECORDING_SESSION.formats).toEqual([...DEFAULT_RECORDING_FORMATS]);
  });

  // `readonly` is a TYPE-level guard: it stops our own code from mutating the
  // shipped default in place. It is NOT a runtime aliasing fix — zod's z.array
  // rebuilds the array on every parse, so a parsed session never aliases the
  // constant regardless. The guard therefore has to be asserted at compile time.
  it('keeps DEFAULT_RECORDING_FORMATS readonly (mutating it must not compile)', () => {
    const mutate = () => {
      // @ts-expect-error `readonly string[]` has no `push`. Drop the `readonly`
      // and this directive goes unused → `npm run typecheck` fails here.
      DEFAULT_RECORDING_FORMATS.push('wav');
    };
    expect(mutate).toBeTypeOf('function'); // compile-time assertion; never invoked
    expect(DEFAULT_RECORDING_FORMATS).toEqual(['webm']);
  });
});

describe('parseSession', () => {
  it('heals null/garbage to the default', () => {
    expect(parseSession(null)).toEqual(DEFAULT_RECORDING_SESSION);
    expect(parseSession('nope')).toEqual(DEFAULT_RECORDING_SESSION);
  });

  it('fills missing stream fields with their defaults (partial blob)', () => {
    const s = parseSession({ streams: { overlayVideo: true } });
    expect(s.streams.overlayVideo).toBe(true);
    expect(s.streams.audio).toBe(true); // default preserved
    expect(s.streams.featureEdges).toEqual([]);
  });

  it('keeps a valid overwritten name + location', () => {
    const s = parseSession({ name: 'my-take', location: 'directory' });
    expect(s.name).toBe('my-take');
    expect(s.location).toBe('directory');
  });
});

describe('schema forward-compat', () => {
  it('an empty object parses to the full default (every field defaulted)', () => {
    expect(RecordingSessionSchema.parse({})).toEqual(DEFAULT_RECORDING_SESSION);
  });
});

describe('hasAnyStream', () => {
  it('is true for the default (audio on) and false when everything is off', () => {
    expect(hasAnyStream(DEFAULT_RECORDING_SESSION.streams)).toBe(true);
    expect(
      hasAnyStream({
        audio: false,
        overlayVideo: false,
        pureVideo: false,
        pureVideoAudio: false,
        overlayAlpha: false,
        features: false,
        featureEdges: [],
      }),
    ).toBe(false);
  });
});
