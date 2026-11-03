/**
 * JSON for files a person may open (#754): objects indented, but every array of plain values (a
 * gesture trace's row, its frame times, a sample's support frame, a list of ids) on ONE line.
 *
 * Why: a categorizer file pretty-printed by `JSON.stringify(v, null, 2)` puts every number of a
 * trace on its own line, so a dozen gestures of five repetitions came to about 700 kB against
 * 230 kB compact (the review of #753). One line per row keeps the file close to the compact size
 * and still readable and diffable: a row is a frame, a line.
 *
 * Same values as `JSON.stringify` (`undefined` and functions left out of objects, `null` in
 * arrays, non-finite numbers as `null`), only the whitespace differs. Pure.
 */

/** A value JSON writes as one token. */
const isPlain = (v: unknown): boolean => v === null || (typeof v !== 'object' && typeof v !== 'function');

/** One plain value as JSON (`undefined` in an array, like a non-finite number, is `null`). */
const token = (v: unknown): string => JSON.stringify(v) ?? 'null';

/** `value` as JSON, objects indented by `indent` spaces, arrays of plain values on one line. */
export function rowJson(value: unknown, indent = 2): string {
  const pad = (depth: number) => ' '.repeat(depth * indent);
  const write = (v: unknown, depth: number): string => {
    if (isPlain(v)) return token(v);
    if (Array.isArray(v)) {
      if (v.every(isPlain)) return `[${v.map(token).join(',')}]`;
      return `[\n${v.map((x) => pad(depth + 1) + (x === undefined || typeof x === 'function' ? 'null' : write(x, depth + 1))).join(',\n')}\n${pad(depth)}]`;
    }
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined && typeof x !== 'function');
    if (entries.length === 0) return '{}';
    return `{\n${entries.map(([k, x]) => `${pad(depth + 1)}${JSON.stringify(k)}: ${write(x, depth + 1)}`).join(',\n')}\n${pad(depth)}}`;
  };
  return write(value, 0);
}
