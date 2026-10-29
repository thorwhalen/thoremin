# Research notes

Research behind thoremin's design decisions, one note per question. Each note starts with a short summary and ends with its references.

- [air-instruments.md](air-instruments.md): Air instruments: prior art, a footage pipeline, and a first model (guitar chord shapes)
- [asl-recognition.md](asl-recognition.md): ASL recognition: moved
- [body-and-pace-research-map.md](body-and-pace-research-map.md): Body as a source, and pacing a song from the dancer's pulse: a research map
- [body-conducting-and-pose-categories.md](body-conducting-and-pose-categories.md): Body conducting and pose categories: which body channel carries the beat, and at which level
- [carve-quality-vs-live.md](carve-quality-vs-live.md): Carve quality chips against the live readout (#553)
- [chord-layouts.md](chord-layouts.md): Chord layouts: grids, lattices and wheels, and what is known about playing them
- [compendium.md](compendium.md): thoremin: a research compendium
- [conducting-and-virtual-orchestra-research-map.md](conducting-and-virtual-orchestra-research-map.md): Conducting gestures and a virtual orchestra: a research map
- [conducting-meter.md](conducting-meter.md): Can the conductor's hand pattern say 2, 3 or 4? (#187 PR 6)
- [datasets.md](datasets.md): Datasets thoremin has trained, tuned or measured on
- [drum-pattern-training.md](drum-pattern-training.md): Drum pattern training: fit a player's tempo and positions to a short score, then play them back snapped and humanised
- [face-categorizer-lighting-and-distance.md](face-categorizer-lighting-and-distance.md): Lighting and camera distance vs a personal face categorizer (#330 P3)
- [fingering-priors-and-sequence-training.md](fingering-priors-and-sequence-training.md): Fingering-chart priors and scripted sequence training for the air winds
- [harmony-relations-and-realization.md](harmony-relations-and-realization.md): Harmony as layers: chord relations, distances, layouts, navigation, realization and emotion
- [intent-and-subframe-timing.md](intent-and-subframe-timing.md): Intent, actuality, and sounding good: musical timing beyond the frame rate
- [latency-budget-and-browser-realtime.md](latency-budget-and-browser-realtime.md): Where the lag comes from, and whether another language would cut it
- [music-games-from-audio.md](music-games-from-audio.md): Music games and lessons that listen: melody and rhythm from live audio
- [rhythm-from-gesture-research-map.md](rhythm-from-gesture-research-map.md): Inferring Rhythm & Tempo from Low-Frame-Rate Gesture: A Research Map
- [subframe-impact-prediction.md](subframe-impact-prediction.md): Sub-frame impact prediction from body video: method, harness, numbers
- [trainer-mode.md](trainer-mode.md): Research: trainer mode — learning a player's own control categories from a live stream

## Research in related repositories

- **Augmented reality**: [thorwhalen/thoremin-ar](https://github.com/thorwhalen/thoremin-ar) studies drawing and moving virtual objects with the hands through the webcam, the browser AR stack (WebXR, MediaPipe, three.js) and Meta's glasses and Quest headsets as thoremin inputs and displays. Start with its [inventory of what thoremin already has](https://github.com/thorwhalen/thoremin-ar/blob/main/docs/research/00-what-we-have.md) and its [ranked recommendations](https://github.com/thorwhalen/thoremin-ar/blob/main/docs/research/99-recommendations.md).
- **Sign language**: [thorwhalen/thoremin-asl](https://github.com/thorwhalen/thoremin-asl) holds the ASL recognition research (see [asl-recognition.md](asl-recognition.md)).
