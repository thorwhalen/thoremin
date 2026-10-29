# @thoremin/music-formats

Music files in and out, for every part of thoremin that reads a score or a song.

- `@thoremin/music-formats/midi`: `midiToScoreDoc(bytes)` (on `@tonejs/midi`) and `songToMidi(song)`, a one-track Standard MIDI File (a rhythm as hand claps on the percussion channel).
- `@thoremin/music-formats/musicxml`: `musicxmlToScoreDoc(bytesOrText)`, for `.musicxml`, `.xml` and compressed `.mxl` (on `musicxml-io`, through its MIDI export and timing sidecar).
- `@thoremin/music-formats/abc`: `abcToScoreDoc(text)`, ABC notation by the same library and the same route.

Each module imports its parser statically, so import the module itself dynamically (`await import('@thoremin/music-formats/midi')`): a page that never opens a file never downloads a parser. A `ScoreDoc` (`@thoremin/sdk/score/schema`) is the conductor's whole score; `songFromScore` (`@thoremin/sdk/score/song`) reduces one to the single line of notes the listening games read.
