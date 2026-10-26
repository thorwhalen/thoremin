---
tool: replay
title: Replay
do:
  - Record a take with **Record**, ticking *Feature stream (JSONL)*.
  - Open Tools, then Replay, and pick the take's `.features.jsonl`.
  - The instrument plays your recorded hands instead of the camera. Press Stop to use the camera again.
---
Hear again exactly what an instrument did with your hands: a chord that flickered, a sign it misread, a note that came late. Replay plays a recorded take's hands into whatever instrument is loaded, over and over, so you can switch instruments or settings and compare them on the same take.

:::details What it reads
The Record tool's feature stream (`.features.jsonl`, the hands are kept from it), or a recorded hands stream (`.ndjson`, gzipped or not). Only the hands are replayed: your camera picture, the face and the body are still live, so a face or body instrument hears the camera, not the take. A file that is not a recording is refused with the reason, and lines that cannot be read are skipped and counted.
:::

:::details From a link
Add `?replay=` and the address of a recording to the app's address to open it straight away: handy for sending a take to someone together with what to listen for. If it cannot be read, the Replay tool opens and says why, and the camera stays on.
:::
