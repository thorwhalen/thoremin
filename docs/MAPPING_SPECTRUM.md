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

> **Two different states, kept apart below.** A node can be **built + tested** (it
> exists in the registry, has unit tests, appears in [CATALOG.md](CATALOG.md)) and
> still **not be wired into the default graph** (nothing in `src/app/graph.ts`
> references it, so it does not run in the deployed instrument). Most of the indirect
> and conductor-mode machinery is in the first state. Saying "planned" for those would
> be wrong; so would saying "shipped".

## Direct end — built, and wired into the default graph

`voice-mapping` maps continuous features straight to synth parameters:
- **x → pitch**, snapped toward a chosen scale by a `magnetism` 0..1
  (`magneticPitch` in `src/music/theory.ts`): 0 = free glide, 1 = hard snap to
  scale notes, in-between = expressive pull toward in-tune notes.
- **y → volume**; openness/pinch available for brightness/gating.

Tonal guidance keeps the player "in key" while preserving continuous
expression — the core of making movement sound musical rather than random.

## The middle — built, and wired in

Face-driven harmony is the part of the spectrum that *did* reach the default graph.
`face-expression → expression-chord` (a facial expression selects a diatonic triad)
and `face-controls → pose-chord` (deliberate head/jaw/brow pose plays a chord) are
neither "a gesture is a note" nor "steer a model": the gesture names a **musical
intent** and the music-logic layer realizes it in key. Both run in the deployed app,
and since #75 they draw from a **chord-source scale decoupled from the melody scale**.

## Indirect end — built + tested, NOT wired into the default graph

The nodes exist and are unit-tested (against a mock engine); no generative layer runs
in the DAG app. The only *running* generative surface is the AI-DJ plugin in the
**frozen** legacy view (`?engine=legacy`). Issue **#128** decides whether this gets
ported into the default graph or the legacy view is formally retired.

- `indirect-map` **(built, not wired)**: gesture features AND/OR face expressions → a
  **weighted-prompt vector** + config dials (density, brightness, bpm, tension),
  smoothed/throttled, steering **Lyria RealTime** (the one production-grade real-time
  *steerable* generative engine; batch engines like Suno/MusicGen can only pre-render
  loops, not gesture-react).
- `lyria` **(built, not wired)**: the generative-engine node behind the
  `GenerativeEngine` facade.
- Harmony/melody from contour **(not built)**: gesture shape → chord progression
  (Roman-numeral grammar / Markov) or melodic contour. The `progression` + `chord`
  nodes that would back it are built and tested, but also not in the default graph.

## "Conductor" mode — built + tested, NOT wired into the default graph

A point on the spectrum where you direct an *existing* piece. All three nodes exist
(`transport`, `score`, `performance`) and are unit-tested; nothing in `src/app/graph.ts`
uses them.

- an immutable **`score`** node holds the notes;
- a **`performance`** node maps conducting gestures → tempo, dynamics (velocity), and
  articulation;
- a **`transport`** node integrates BPM into a beat position.

The same overlay driven by low-amplitude noise instead of gestures = expressive
**humanization** of an otherwise mechanical render.

## User-authored mappings (later)

A trainable `learned-map` node (Wekinator / ml5-style regression+classification)
lets a user demonstrate gesture→sound pairings and learn the mapping — bridging
beginner accessibility and deep expressive control without hand-coding every
rule.

The **Feature Instrumentation Lab** (#119, shipped) is the reconnaissance for this:
before you can learn a mapping, you need to know which of the 248 catalogued face/hand
features a performer can actually drive on purpose, and which are just restating each
other. See [design/feature-lab.md](design/feature-lab.md).

## Scaling the learning curve

Beginners start at the indirect end (small gestures → big, always-musical
results via AI). As skill grows, dial toward the direct end (finer, more
constraint-rich control). The same DAG supports both by swapping/parameterizing
the mapping layer — which is exactly why the architecture is a re-wirable graph.
