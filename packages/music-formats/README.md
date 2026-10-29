# @thoremin/music-formats

Music files in and out, for every part of thoremin that reads a score or a song.

- `@thoremin/music-formats/midi`: `midiToScoreDoc(bytes)` (on `@tonejs/midi`) and `songToMidi(song)`, a one-track Standard MIDI File (a rhythm as hand claps on the percussion channel).
- `@thoremin/music-formats/musicxml`: `musicxmlToScoreDoc(bytesOrText)`, for `.musicxml`, `.xml` and compressed `.mxl` (on `musicxml-io`, through its MIDI export and timing sidecar).
- `@thoremin/music-formats/abc`: `abcToScoreDoc(text)`, ABC notation by the same library and the same route.

Each module imports its parser statically, so import the module itself dynamically (`await import('@thoremin/music-formats/midi')`): a page that never opens a file never downloads a parser. A `ScoreDoc` (`@thoremin/sdk/score/schema`) is the conductor's whole score; `songFromScore` (`@thoremin/sdk/score/song`) reduces one to the single line of notes the listening games read.

## The pack: open any of these as a song

`@thoremin/music-formats/pack` registers all of the above with [formatcast](https://github.com/thorwhalen/formatcast), with two in-memory kinds, `score` (a `ScoreDoc`) and `song`, plus the compact note text (`.notes`) and a song as JSON, YAML or TOML:

```ts
import { createRegistry } from 'formatcast';
import { musicPack } from '@thoremin/music-formats/pack';

const formats = createRegistry({ packs: [musicPack] });
const song = await formats.decode(file, { to: 'song' });           // .mid, .musicxml, .mxl, .abc, .notes, .json, .yaml, .toml
const midi = await formats.encode(song, { format: 'midi', from: 'song' });
```

The format is found from the file's name, type and first bytes; only the matching parser is downloaded.
