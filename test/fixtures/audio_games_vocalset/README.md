# audio_games_vocalset

Sung vowels from two trained singers (VocalSet's `m2`, male, and `f1`, female), for the vowel cursor, the player calibration and the synthesiser round trip in the Vowels games ([#866](https://github.com/thorwhalen/thoremin/issues/866), [#888](https://github.com/thorwhalen/thoremin/issues/888)). Measured with `scripts/audio_games/measure_vowels.ts`; tested in `test/games/vowel_voice.test.ts`.

| Files | Take | Used for |
|---|---|---|
| `<singer>_scales_straight_{a,i,u}.wav` | a scale on one vowel, straight tone | the calibration ("ah", "ee", "oo") |
| `<singer>_arpeggios_vibrato_{a,e,i,o,u}.wav` | an arpeggio on one vowel, with vibrato | held out: scored through the calibration fitted on the scales |

Each is a 3 s excerpt (from 0.5 s in), mono, 11.025 kHz (the formant analyser's own rate), 16-bit, cut by `python3 -I scripts/audio_games/fetch_vocalset.py test/fixtures/audio_games_vocalset`, which reads only these members of the archive over HTTP range requests.

**Attribution (CC BY 4.0).** Wilkins, J., Seetharaman, P., Wahl, A. and Pardo, B. (2018). *VocalSet: A Singing Voice Dataset* (1.2). Zenodo. [doi:10.5281/zenodo.1442513](https://doi.org/10.5281/zenodo.1442513). Licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changes: excerpted, downmixed and resampled.
