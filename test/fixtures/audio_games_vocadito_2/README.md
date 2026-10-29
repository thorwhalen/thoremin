# audio_games_vocadito_2

Seven seconds of solo singing from **vocadito** (track 2), for the pitch estimator and the singing games ([#866](https://github.com/thorwhalen/thoremin/issues/866)).

- `audio.wav`: mono, 22.05 kHz, 16-bit, cut from the original 44.1 kHz recording.
- `f0.csv`: the dataset's frame-level f0 (`t,f0`, Hz, 0 = unvoiced), times shifted to the cut.
- `notes.csv`: annotator 1's notes (`start,hz,duration`) wholly inside the cut.

Made by `scripts/audio_games/cut_vocadito.sh <vocadito dir> 2 1.0 7 test/fixtures/audio_games_vocadito_2`.

**Attribution (CC BY 4.0).** R. M. Bittner, K. Pasalo, J. J. Bosch, G. Meseguer-Brocal, D. Rubinstein, *vocadito: A dataset of solo vocals with f0, note, and lyric annotations*, 2021, [Zenodo 5578807](https://zenodo.org/records/5578807), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changes: excerpted, resampled to 22.05 kHz, annotations cut and re-timed.
