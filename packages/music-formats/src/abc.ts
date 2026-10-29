/**
 * ABC notation → {@link ScoreDoc}, on `musicxml-io`'s ABC parser, then the MusicXML route
 * (`scoreDocOf`: the library's MIDI export with its timing sidecar). The first tune of a file
 * with several (`X:` headers) is read. Reached only by a dynamic `import()`.
 */
import { parseAbc } from 'musicxml-io/browser';
import type { ScoreDoc } from '@thoremin/sdk/score/schema';
import { scoreDocOf } from './musicxml';

export function abcToScoreDoc(text: string, title?: string): ScoreDoc {
  return scoreDocOf(parseAbc(text), 'abc', title);
}
