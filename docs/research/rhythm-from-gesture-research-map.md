# Inferring Rhythm & Tempo from Low-Frame-Rate Gesture: A Research Map

*Thor Whalen — 2026-07-06*

## 0. Problem statement

A camera-based instrument turns face/hand landmarks into musical control. Melodic,
harmonic and timbral mapping works, because those are (near-)continuous parameters that
tolerate a 30–60 Hz control rate. **Rhythm does not**: perceptually meaningful timing
lives at the ~1–20 ms scale, well below the video frame period (16.7–33 ms). Literal
frame-to-onset mapping therefore cannot resolve rhythmic placement.

The proposed escape is to exploit the fact that rhythm is *highly structured* (low
entropy): fuse the low-rate gesture stream with a strong prior over musical time to
**infer the intended** onsets/tempo rather than measure them directly. This is correct,
and it is a well-studied class of problem — but it is best framed not as "inpainting" or
"upsampling" but as **model-based Bayesian estimation of a latent high-rate timing
process from low-rate, noisy observations**.

---

## 1. The right framing (and why your analogy is exact)

Your "obfuscated shapes" analogy is precisely **amodal completion** — the perceptual
filling-in of occluded structure from a learned prior over likely forms — and the Gestalt
*law of closure* [1]. The modern computational account is the **Bayesian brain / predictive
coding** view: perception is inference of hidden causes under a generative prior, with the
prior doing exactly the "filling" work when observations are sparse [2,3].

The rigorous, quantitative version of your "music has far less entropy than all sound"
intuition is **sparsity**. An onset train is a stream of Diracs — a canonical
**finite-rate-of-innovation (FRI)** signal with few degrees of freedom per second [4].
FRI and compressed-sensing theory [5,6,7] establish that such signals are recoverable
**below the Nyquist rate**: the sampling rate must exceed the *rate of innovation* (how
often a genuinely new timing decision occurs), not the timing *resolution* you ultimately
render. That is the formal license for the whole project — and it reframes the design
question from "can we?" to "what prior, and how do we do the inference causally?"

Two consequences to keep in mind:

- **Inpainting / interpolation is two-sided** (uses past *and* future → offline). Live
  performance is **one-sided/causal**: you have past frames + prior only, so you are doing
  **filtering + forecasting**, not smoothing. This single distinction should drive the
  architecture (Sec. 6).
- Generic temporal super-resolution / video frame interpolation is a *cousin*, not the
  tool: it interpolates pixels/motion, not a structured symbolic timing grid.

---

## 2. Signal-theory backbone — sparsity, FRI, compressed sensing

Establishes *why* sub-frame-rate recovery is possible and gives reconstruction machinery.

- **Finite rate of innovation** [4]: sample and perfectly reconstruct streams of
  Diracs/pulses at the rate of innovation using a suitable kernel. Onsets are the textbook
  case.
- **Compressed sensing** [5,6]: recover sparse signals from few measurements via ℓ₁ /
  greedy methods. Sparsity = your "low entropy."
- **Sub-Nyquist sampling / Xampling** [7] (Eldar and collaborators): a practical framework
  for structured sub-Nyquist acquisition and recovery, incl. model-based deep learning /
  algorithm unrolling [8] — a natural way to *learn* the groove prior while keeping the
  reconstruction interpretable (fits a facade/plugin design).

Caveat: pure CS/FRI assumes a linear measurement model. Gesture→onset is nonlinear and
temporal, so CS/FRI is best used as *conceptual grounding + a sparsity regularizer*, with
the actual inference done by the state-space / dynamical models below.

---

## 3. Bayesian generative models of rhythm & tempo — the core match

This is the literature that already does "fuse noisy timing observations with a strong
musical prior via probabilistic inference." Swap *audio onset features* for *gesture
features* and it is your problem.

- **Cemgil switching state-space model** [9,10,11]: hidden state = discrete score position
  (switch variable) + continuous tempo; tempo-tracking and rhythm-quantization posed as
  filtering / MAP estimation; inference via sequential Monte Carlo (particle filtering).
  Start here — it is the cleanest formalization of exactly your fusion task.
- **Bar-pointer model** [12]: hidden "pointer" sweeps through a bar; jointly infers
  position-in-bar, tempo, and rhythmic pattern. This *is* a generative prior over metrical
  time you can condition gesture observations on.
- **Efficient particle-filter beat/downbeat tracking** [13] (Krebs–Böck–Widmer; the
  `madmom` lineage): a compact, real-time-capable state space over tempo × metrical
  position. Good engineering reference and reusable code.
- Audiovisual extensions of these state-space beat trackers exist (visual cues fused with
  audio), which is direct precedent for driving the *same* inference engine from a visual
  modality — verify current instances before relying on specifics.

---

## 4. Dynamical-systems / entrainment — the causal real-time engine

Where Sec. 3 gives the probabilistic prior, this gives the **online predict-then-correct**
mechanism: an internal oscillator that phase- and period-locks to sparse events and
*predicts* onset times between frames. Effectively a musically-informed phase-locked loop,
and the most implementation-ready path to real-time gap-filling.

- **Adaptive oscillators / resonance** [14] (Large & Kolen): phase + period adaptation;
  mode-locking (Arnold tongues) at small integer ratios → this is where metrical hierarchy
  and subdivision "come for free."
- **Dynamic Attending Theory** [15] (Large & Jones): oscillator + attentional pulse (von
  Mises window) predicting *when* the next event is expected — a ready-made likelihood for
  scoring gesture-derived onset candidates.
- Adaptive-oscillator variants (McAuley; phase-reset models) [16] give design choices for
  how hard to snap phase on each confirmed anchor.

The oscillator can be read as a degenerate particle filter (a point estimate of phase +
tempo with a predictive window), so Secs. 3 and 4 are two ends of one continuum: start
with an oscillator for latency/robustness, upgrade to a particle filter when you need
multi-hypothesis meter/groove inference.

---

## 5. Conducting-gesture systems — the closest applied analog

An entire sub-field maps low-rate conductor gestures to beat/tempo, and it names your
granularity problem explicitly.

- **Conductor's Jacket** [17] (Marrin Nakra): extracts beat/tempo/dynamics from expressive
  gesture and re-synthesizes.
- **"You're the Conductor"** [18] (Lee–Nakra–Borchers, NIME'04): real-time
  gesture→tempo/dynamics playback control for non-experts.
- **Real-time virtual-orchestra control from a skeleton tracker** [19] (recent, 2026):
  visual skeleton → estimate *phase within the bar* → speed control. This is essentially a
  contemporary instance of your pipeline; good baseline to benchmark against.
- The field states the core issue plainly: tempo is only observable at gesture "ictus"
  turning points, leaving **~200 ms–2 s gaps** to bridge with a model [20] — which is
  exactly the interpolation-under-prior task, and empirically solvable.

---

## 6. Mapping onto your system (architecture sketch)

A layered, plugin-friendly decomposition (single source of truth = the musical-time state):

```
gesture landmarks (30–60 Hz)
        │
        ▼
[AnchorDetector]  ── extract sparse, high-confidence timing anchors
        │             (velocity zero-crossings / ictus / acceleration peaks;
        │              a beat *candidate* with a confidence, not a hard onset)
        ▼
[RhythmInferenceEngine]  ── latent state: (phase-in-bar, tempo[, groove/meter])
        │             causal filter: predict → correct on each anchor
        │             swappable backend: adaptive oscillator  |  particle filter
        ▼
[MusicalTimeState]  ── SSOT: current phase, tempo, meter, next-onset forecast
        │
        ▼
[Quantizer + GrooveModel]  ── emit high-res onset grid; apply learned microtiming
                              (swing etc.) as a prior, not a measurement
```

Design notes matched to how you build:

- **`RhythmPrior` as an injected dependency** (open-closed): a plain oscillator, a
  bar-pointer particle filter, or a learned/unrolled model [8] all satisfy the same
  `predict(dt) -> expected_onsets` / `update(anchor) -> posterior` interface. Facade over
  the family; compose, don't subclass.
- **Anchors are observations with likelihoods**, never direct onsets. The engine decides
  whether a gesture confirms the predicted beat, signals a tempo change, or is noise — this
  is where the low-entropy prior earns its keep.
- **Groove/microtiming is a separable, learnable layer** (Desain & Honing quantization
  [21], modern data-driven grooves). Keeps "where is the beat" (inference) orthogonal to
  "how is it felt" (rendering).
- **Two-clock discipline**: run the inference engine on its own high-resolution audio/tempo
  clock, *driven* (not gated) by the frame clock. The frames correct the phase estimate;
  the audio clock emits onsets. This is the concrete cash-value of the smoothing-vs-filtering
  distinction in Sec. 1.

Latency reality check: causal inference means you either (a) accept a small look-ahead
buffer (a few tens of ms) to disambiguate, or (b) commit early and phase-correct on the
next anchor. For an expressive instrument, a short adaptive latency tied to tempo
confidence is usually the right trade.

---

## 7. Suggested search terms

`switching state-space tempo tracking`, `bar pointer model beat tracking`,
`particle filter downbeat madmom`, `adaptive oscillator beat entrainment`,
`dynamic attending theory expectation`, `conducting gesture tempo NIME`,
`finite rate of innovation Diracs`, `compressed sensing sparse recovery`,
`audiovisual beat tracking state space`, `predictive coding Bayesian brain`,
`groove microtiming quantization`, `algorithm unrolling model-based deep learning`.

---

## REFERENCES

[1] Kanizsa G. *Organization in Vision: Essays on Gestalt Perception*. Praeger; 1979.

[2] Rao RPN, Ballard DH. Predictive coding in the visual cortex: a functional interpretation of some extra-classical receptive-field effects. *Nat Neurosci*. 1999;2(1):79–87. [https://www.nature.com/articles/nn0199_79](https://www.nature.com/articles/nn0199_79)

[3] Friston K. The free-energy principle: a unified brain theory? *Nat Rev Neurosci*. 2010;11(2):127–138. [https://www.nature.com/articles/nrn2787](https://www.nature.com/articles/nrn2787)

[4] Vetterli M, Marziliano P, Blu T. Sampling signals with finite rate of innovation. *IEEE Trans Signal Process*. 2002;50(6):1417–1428. [https://ieeexplore.ieee.org/document/1003065](https://ieeexplore.ieee.org/document/1003065)

[5] Candès EJ, Romberg J, Tao T. Robust uncertainty principles: exact signal reconstruction from highly incomplete frequency information. *IEEE Trans Inf Theory*. 2006;52(2):489–509. [https://ieeexplore.ieee.org/document/1580791](https://ieeexplore.ieee.org/document/1580791)

[6] Donoho DL. Compressed sensing. *IEEE Trans Inf Theory*. 2006;52(4):1289–1306. [https://ieeexplore.ieee.org/document/1614066](https://ieeexplore.ieee.org/document/1614066)

[7] Eldar YC. *Sampling Theory: Beyond Bandlimited Systems*. Cambridge University Press; 2015. [https://www.cambridge.org/core/books/sampling-theory/](https://www.cambridge.org/core/books/sampling-theory/9781107003392)

[8] Monga V, Li Y, Eldar YC. Algorithm unrolling: interpretable, efficient deep learning for signal and image processing. *IEEE Signal Process Mag*. 2021;38(2):18–44. [https://ieeexplore.ieee.org/document/9363511](https://ieeexplore.ieee.org/document/9363511)

[9] Cemgil AT, Kappen B. Monte Carlo methods for tempo tracking and rhythm quantization. *J Artif Intell Res*. 2003;18:45–81. [https://arxiv.org/abs/1106.4863](https://arxiv.org/abs/1106.4863)

[10] Cemgil AT. *Bayesian Music Transcription* [PhD thesis]. Radboud University Nijmegen; 2004. [https://repository.ubn.ru.nl/handle/2066/59219](https://repository.ubn.ru.nl/handle/2066/59219)

[11] Cemgil AT, Kappen B, Barber D. A generative model for music transcription. *IEEE Trans Audio Speech Lang Process*. 2006;14(2):679–694. [https://ieeexplore.ieee.org/document/1597309](https://ieeexplore.ieee.org/document/1597309)

[12] Whiteley N, Cemgil AT, Godsill S. Bayesian modelling of temporal structure in musical audio. In: *Proc. ISMIR*. 2006. [https://ismir2006.ismir.net/PAPERS/ISMIR0625_Paper.pdf](https://ismir2006.ismir.net/PAPERS/ISMIR0625_Paper.pdf)

[13] Krebs F, Böck S, Widmer G. An efficient state-space model for joint tempo and meter tracking. In: *Proc. ISMIR*. 2015. [https://archives.ismir.net/ismir2015/paper/000091.pdf](https://archives.ismir.net/ismir2015/paper/000091.pdf)

[14] Large EW, Kolen JF. Resonance and the perception of musical meter. *Connect Sci*. 1994;6(2–3):177–208. [https://www.tandfonline.com/doi/abs/10.1080/09540099408915723](https://www.tandfonline.com/doi/abs/10.1080/09540099408915723)

[15] Large EW, Jones MR. The dynamics of attending: how people track time-varying events. *Psychol Rev*. 1999;106(1):119–159. [https://psycnet.apa.org/record/1999-10197-006](https://psycnet.apa.org/record/1999-10197-006)

[16] McAuley JD. *Perception of Time as Phase: Toward an Adaptive-Oscillator Model of Rhythmic Pattern Processing* [PhD thesis]. Indiana University; 1995.

[17] Marrin Nakra T. *Inside the Conductor's Jacket: Analysis, Interpretation and Musical Synthesis of Expressive Gesture* [PhD thesis]. MIT Media Lab; 2000. [https://www.media.mit.edu/publications/inside-the-conductors-jacket/](https://www.media.mit.edu/publications/inside-the-conductors-jacket-analysis-interpretation-and-musical-synthesis-of-expressive-gesture/)

[18] Lee E, Marrin Nakra T, Borchers J. You're the conductor: a realistic interactive conducting system for children. In: *Proc. NIME*. 2004:68–73. [https://www.nime.org/proceedings/2004/nime2004_068.pdf](https://www.nime.org/proceedings/2004/nime2004_068.pdf)

[19] Pascoe E, Kjellström H. Real-time control of a virtual orchestra by recognition of conducting gestures. *arXiv preprint*. 2026. [https://arxiv.org/abs/2604.27957](https://arxiv.org/abs/2604.27957)

[20] Behringer R. Gesture interaction for electronic music performance. In: *HCI International*. Springer; 2007. [https://link.springer.com/chapter/10.1007/978-3-540-73335-5_63](https://link.springer.com/chapter/10.1007/978-3-540-73335-5_63)

[21] Desain P, Honing H. The quantization of musical time: a connectionist approach. *Comput Music J*. 1989;13(3):56–66. [https://www.jstor.org/stable/3680012](https://www.jstor.org/stable/3680012)

---

*Note on citations: entries [1]–[21] are standard/verifiable references, but a few
URLs (esp. proceedings PDFs and the 2026 preprint) should be confirmed before use in a
publication, as archival links occasionally move.*
