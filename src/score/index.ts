/**
 * The score pipeline (#187 PR 3): a symbolic score model (`ScoreDoc`), lazy loaders
 * for MIDI and MusicXML, and the score library (shipped demos + the player's saved
 * scores). Nothing here schedules or sounds; the `score` node reads a `ScoreDoc` and
 * the conductor supplies the time. The parser modules (`./midi`, `./musicxml`) are
 * NOT re-exported: reaching them statically would put both parsers in the main
 * chunk — `loadScore` is the way in.
 */
export * from './schema';
export * from './library';
export { loadScore, loadScoreWithStatus, fetchDemo, sniffFormat, titleFromFilename, defaultParsers } from './load';
export type { ScoreFormat, ScoreParsers } from './load';
