/**
 * taglog affordances — the pure, framework-free core (Zod schemas + logic).
 *
 * Re-exports the schemas, the toggle state machine, interval resolution, lead-in
 * correction, and the event codecs. Import from here (or from `@/taglog`) rather
 * than reaching into individual files, so the extraction boundary stays clean:
 * nothing in this layer imports React, storage, or timers.
 */
export * from './schema';
export * from './leadIn';
export * from './time';
export * from './codec';
export * from './toggle';
export * from './resolve';
