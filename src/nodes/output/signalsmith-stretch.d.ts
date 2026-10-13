/**
 * The song player's Signalsmith stretcher (#187 PR 7) imports the package's file as a
 * verbatim asset URL (`?url`), never as a bundled module: see the header of
 * `song_stretcher_signalsmith.ts` for why.
 */
declare module 'signalsmith-stretch?url' {
  const url: string;
  export default url;
}
