# The direct ↔ indirect mapping spectrum

Thoremin's expressive power comes from *how* sensor features map to musical
intent. This is one continuum, not two apps — a configurable mapping stage in
the DAG.

```
DIRECT ◀──────────────────────────────────────────────────▶ INDIRECT
gesture = note/parameter          gesture = high-level idea, interpreted
(theremin, Mi.Mu gloves)          (conductor; steering a generative model)

x → pitch (scale-snapped)   …   openness → "density"   …   gesture shape → weighted
y → volume                       smile → "brightness"        text prompts → Lyria
pinch → trigger                  beat pattern → tempo         contour → chord progression
```

## Direct end (implemented)

`voice-mapping` maps continuous features straight to synth parameters:
- **x → pitch**, snapped toward a chosen scale by a `magnetism` 0..1
  (`magneticPitch` in `src/music/theory.ts`): 0 = free glide, 1 = hard snap to
  scale notes, in-between = expressive pull toward in-tune notes.
- **y → volume**; openness/pinch available for brightness/gating.

Tonal guidance keeps the player "in key" while preserving continuous
expression — the core of making movement sound musical rather than random.

## Indirect end (planned, M3+)

Gestures express a high-level musical *idea* that gets interpreted:
- `indirect-map`: gesture features → a **weighted-prompt vector** + config dials
  (density, brightness, bpm, tension), smoothed/throttled, steering **Lyria
  RealTime** (the one production-grade real-time *steerable* generative engine;
  batch engines like Suno/MusicGen can only pre-render loops, not gesture-react).
- Harmony/melody from contour: gesture shape → chord progression (Roman-numeral
  grammar / Markov) or melodic contour, voiced with Tonal.js.

## "Conductor" mode (planned, M5)

A point on the spectrum where you direct an *existing* piece:
- an immutable **`score`** node holds the notes;
- a **`performance`** overlay node maps conducting gestures → tempo
  (`Tone.Transport.bpm`), dynamics (velocity), and articulation.
The same overlay driven by low-amplitude noise instead of gestures = expressive
**humanization** of an otherwise mechanical render.

## User-authored mappings (later)

A trainable `learned-map` node (Wekinator / ml5-style regression+classification)
lets a user demonstrate gesture→sound pairings and learn the mapping — bridging
beginner accessibility and deep expressive control without hand-coding every
rule.

## Scaling the learning curve

Beginners start at the indirect end (small gestures → big, always-musical
results via AI). As skill grows, dial toward the direct end (finer, more
constraint-rich control). The same DAG supports both by swapping/parameterizing
the mapping layer — which is exactly why the architecture is a re-wirable graph.
