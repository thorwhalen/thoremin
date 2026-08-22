# Research: trainer mode — learning a player's own control categories from a live stream

**Status:** research (evidence), not design (commitment). Point-in-time, 2026-08-22.
Re-verify library versions and claims before relying on them.
**Question it answers:** the player cannot reliably hit the expression categories the
shipped model recognises. Instead of tuning the model's categories, let the player
*carve their own* — move around in front of the camera, say how many categories they
want (before **or** after), and have the system find them. Generalise to any input
stream, not just the face.

---

## 0. The short version

1. **The complaint is a known, named, measured phenomenon**, not a tuning failure.
   It is *identity bias* / the subject-dependent accuracy gap in facial expression
   recognition, and the literature's answer is personalization — which is exactly what
   is being asked for [1][2][3].
2. **The dominant prior art is supervised and it is from this exact field.** Wekinator
   (Fiebrink) [4][5] and Mapping-by-Demonstration (Françoise/Bevilacqua, IRCAM) [7][8][9]
   are two decades of "the performer demonstrates, the system learns the mapping." The
   default answer to "how do I get categories that fit me" is *record a few seconds per
   category*, not *cluster an unlabelled stream*.
3. **But the unlabelled version — the one actually described — is also well-founded**,
   and it has one design move that makes "specify the count before *or afterwards*" fall
   out for free: **build a hierarchy once, cut it at whatever k is asked for** [16][17].
   The count stops being a training parameter and becomes a view.
4. **The "no man's land" is a first-class, well-studied thing**: the reject option /
   open-set recognition [12][13], and in the streaming-clustering family it is literally
   a tunable parameter — ART's *vigilance* [10][11].
5. **The invariance request is ~70% already built in this repo.** #131 shipped a declared
   `invariantTo` vocabulary (`scale` = camera distance, `position`, `yaw`/`pitch`/`roll`)
   on every catalog feature, plus `residual()`/`deconfound()` helpers in the Lab formula
   compiler. What is missing is a *consumer* that selects or down-weights features by
   that declaration — not new mathematics.
6. **The single highest-value recommendation:** build the trainer over the **feature
   vector**, not over the face. `src/features/catalog.ts` already emits a flat, named,
   normalized scalar vector from face *and* hands through one interface. Train on that
   and "generalizable to any input" is not a future refactor — it is the starting state.

---

## 1. Diagnosing the actual complaint first

It is worth being precise about *why* the current expression mapping is hard to hit,
because two different diagnoses imply two different products.

The current pipeline scores MediaPipe's 52 blendshapes against FACS-grounded emotion
prototypes. Issue #76 already established two independent reasons this is a poor control
surface: posed (volitional) and felt (spontaneous) facial movement are driven by
different neural pathways, so a player can only *pose a face they hope the classifier
reads as X*; and the channels the harder emotions lean on (`noseSneer`, `eyeWide`) are
under-reported by the model itself.

The research adds a third, and it is the decisive one for *this* request:

> Identity bias has always been a challenge for facial expression analysis, as
> expressions and identities are inherently entangled [1][3].

Expression recognisers trained on posed corpora carry a measurable **subject-dependent
accuracy gap**. The mitigation the field converges on is *personalization* — adapting to
the individual rather than normalising the individual away [1][2]. Some approaches
normalise identity out ("Norface" maps every face to a common identity before analysis
[3]); others fine-tune per subject, and note that this "depends on subject-specific
labels, which are often unavailable in real-world applications" [1].

**That caveat is the whole opportunity.** In a musical instrument, the player is present,
motivated, and holding the camera. Subject-specific labels are not unavailable — they are
*free*. The player will happily spend sixty seconds making faces at their own instrument.
This is a domain where personalization is unusually cheap, which is why the music-IML
tradition got here first.

**Conclusion:** the complaint is not that the model is badly tuned. It is that a
population model is the wrong object. The fix is a per-player model, and the reason to
build it is that acquiring one is cheap here.

---

## 2. What this is called, and the prior art that matters

### 2.1 Interactive Machine Learning (IML) — the tradition

The framing "user supplies examples in a tight loop and steers the model by demonstration
rather than by parameters" is **Interactive Machine Learning**. In music its canonical
artefact is **Wekinator** (Rebecca Fiebrink, 2008) [4][5]: a standalone tool that applies
supervised learning to real-time sensor→sound mapping, supporting classification
(category labels), regression (continuous values) and temporal modelling. It has been the
default answer for gesturally-controlled instruments for fifteen years.

The load-bearing observation from that tradition, and the one most relevant here: the
value is not the algorithm. It is that **the training loop is fast enough to be part of
playing**. Fiebrink's systems let a performer add examples, retrain, and immediately hear
the result — the model is an instrument you *play into shape*.

### 2.2 Mapping-by-Demonstration — the continuous cousin

IRCAM's ISMM team formalised **Mapping-by-Demonstration**: "crafting sonic interactions
from demonstrations of embodied associations between motion and sound" [7][8]. The
software artefact is **XMM**, a C++ library of Gaussian Mixture Models and Hierarchical
Hidden Markov Models for recognition *and regression* [6][9].

Two ideas worth stealing regardless of which algorithm ships:

- **Demonstrate the pairing, not the category.** The performer moves *while the sound
  plays*, and the system learns the joint motion↔sound relationship. The label never has
  to be named.
- **Recognition and continuous output from one model.** XMM's regression mode outputs
  synthesis parameters continuously, not a discrete class per frame. For an instrument
  this matters enormously — a hard classification into N categories is a *step function*,
  and step functions are not expressive.

### 2.3 Gesture Variation Follower — recognition *and* how you did it

**GVF** (Caramiaux, Montecchio, Tanaka, Bevilacqua) [14][15] uses sequential Monte Carlo
inference to simultaneously (a) recognise which template a gesture matches and (b)
estimate its *variation* — scale, orientation, speed — continuously, as the gesture is
still being performed.

This is directly relevant to the invariance question in §5. GVF does not throw away
camera distance or orientation; it **estimates them as separate outputs**. "Distance
shouldn't matter" and "distance is a usable control axis" become the same mechanism
looked at from two ends.

### 2.4 Teachable Machine — the UX benchmark

Google's Teachable Machine [18] is the interaction design to beat: pick a number of
classes, hold a button to record webcam samples for each, press train, use it. No
expertise, no code. Reported practice ranges from ~10 samples per class for a toy to
~250–300 for something robust [18].

Its relevant limitation: **the classes are named up front**. The request here explicitly
wants the count specifiable *afterwards*, which Teachable Machine cannot do — and which
§4 shows is cheap if the representation is chosen correctly.

---

## 3. Where do the examples come from? Two regimes, and a recommended hybrid

### 3.1 Regime A — supervised by demonstration (Wekinator / Teachable Machine)

Player says "this is category 1", holds a pose, records N frames. Repeat.

- **Pros:** the categories mean what the player intends. Trivially explainable. Robust
  with tiny data. This is what fifteen years of practice actually uses.
- **Cons:** requires the player to know their vocabulary up front, and to hold poses —
  which is the *very thing* they report struggling with.

### 3.2 Regime B — unsupervised carving (what was described)

Player moves freely for a minute. The system clusters the trajectory in feature space and
carves out k regions.

- **Pros:** zero organisation demanded. The categories are *discovered from what the
  player can actually reliably produce*, which is the exact failure mode being fixed.
- **Cons:** the clusters are unnamed and may not correspond to anything meaningful. A
  cluster can capture a *transition* rather than a *pose*, since a free-motion stream is
  mostly transitions. And k-means-style methods are sensitive to the dwell-time
  distribution — you get clusters where the player happened to pause.

**That last point is the real risk and deserves emphasis.** A continuous stream of
someone "moving their face around" is dominated by the paths between expressions, not the
expressions. Naive clustering of every frame finds the *centre of the motion envelope*,
not the extremes. The literature's answer is to segment first: unsupervised threshold
methods split a stream into *dynamic* and *static* segments using velocity/acceleration
derived from position, and cluster only the static ones [19][20].

> **Design consequence:** cluster the **still points**, not the frames. A velocity-gated
> sampler — "record a candidate only when the feature vector's rate of change drops below
> a threshold for ~200 ms" — turns a free-motion stream into a set of *poses the player
> actually held*, which is both a better clustering input and a much better match for
> "categories I can hit on purpose."

### 3.3 Recommended: B for discovery, A for confirmation

Run the unsupervised pass to *propose* categories, then let the player accept, merge,
split, or discard them — and optionally add a demonstration or two for one that is
wrong. The player never has to organise anything up front, and never has to accept a
category they cannot hit. This is the "minimum effort, minimum organisation" the request
asks for, without inheriting Regime B's failure mode.

---

## 4. "Specify k before **or afterwards**" — the design move that makes this free

This is the most useful single finding in this document.

If the trainer commits to a *partition* (k-means with k fixed, or an online clusterer with
a fixed vigilance), then k is a training parameter and changing it means retraining.

If instead the trainer produces a **hierarchy** — an agglomerative tree over the collected
still-points — then:

- the number of clusters need not be specified a priori; clusters are obtained by
  **cutting the dendrogram at a chosen level** [16][17];
- specifying k *after* the fact is exactly "choose the cut height that yields k branches"
  [16];
- and the *same recording* supports 3 categories, then 5, then 4, with no retraining and
  no new data — the player drags a slider and hears the vocabulary get finer or coarser.

That last property is not a technical convenience; it is the feature. "Carve the space I
just made into however many categories I want" **is** cutting a dendrogram, and it is a
slider.

Useful cut heuristics to *offer as suggestions* (never as the only option): the largest
gap between successive merge heights, which arguably indicates a natural clustering [17];
and the silhouette score [16]. Both are cheap over a few hundred points.

**One honest caveat from the same sources**, worth carrying into the UI: "it is generally
a mistake to use dendrograms as a tool for determining the number of clusters… dendrograms
often suggest a correct number of clusters when there is no real evidence to support the
conclusion" [16]. So: suggest a k, show the player *why*, and let them overrule it. Do not
present a discovered k as a fact.

### The scale question

Agglomerative clustering is O(n²) in memory. That is a non-issue here: a 60-second
recording gated to still-points yields *hundreds* of points, not millions. If unbounded
streaming ever becomes a requirement, the ART family (§5.2) is the streaming answer and
can be a second strategy behind the same interface.

---

## 5. The "no man's land" — a first-class concept, two ways to get it

The request's "maybe with an extra no-man's-land one" is not an afterthought; it is the
difference between an instrument that is playable and one that is possessed. Without a
reject region, **every frame is classified as something**, so the instrument is always
asserting a category — including while the player is between expressions, scratching
their nose, or talking.

### 5.1 As a threshold — open-set recognition

The literature calls this the **reject option** or **open-set recognition**: rather than
misclassifying an input as the most similar known class, reject it as "none of the above"
[12][13]. It is usually framed as a thresholding problem — accept a prediction only when
its confidence or distance score passes a bar, otherwise treat it as unknown [12].

The literature's warning is also the practical one: **threshold-tuning is crucial, and
different tasks need very different thresholds** [12]. So the bar must be a dial the
player can move, and — better — one they can set *by demonstration*: "hold your neutral
face; everything that looks like this is no-man's-land."

### 5.2 As a parameter of the clusterer — ART's vigilance

The Adaptive Resonance Theory family builds the reject region into the clustering itself.
ART clusters unlabelled data online with an unknown number of clusters, governed by a
**vigilance parameter ρ** which "controls when resonance happens" — i.e. how close an
input must be to an existing category to join it, versus spawning a new one [10][11]. It
is explicitly designed for streaming: samples are processed and discarded, with low
computational complexity and low noise sensitivity [10]. Later variants use *dual*
vigilance to separate cluster similarity from data quantization and so retrieve
arbitrarily-shaped clusters [11].

ART is the better fit if the trainer ever becomes *continuous* (always learning while you
play). It has a known weakness worth recording: **order dependence** — the result depends
on the sequence the data arrived in, which is addressed by pre/post-processing such as a
Merge-ART module [11]. For a fixed recording that is cut into a hierarchy (§4), order
dependence does not arise, which is one more argument for the agglomerative route first.

### 5.3 Recommendation

Ship the threshold form (§5.1) because it composes with the hierarchy: after cutting at k,
a point further than τ from every centroid is no-man's-land. Expose τ as a dial *and* as a
"hold your resting state" calibration. Keep ART on the shelf for a continuous-learning
mode.

**The musical detail that matters more than the algorithm:** no-man's-land should almost
certainly be *hysteretic* and *not silent*. Entering it should be harder than staying in a
category (the repo already uses dwell/hysteresis for handedness and expression), and it
probably means "hold the last category" rather than "stop making sound" — an instrument
that drops to silence whenever the classifier is unsure is unplayable.

---

## 6. Invariance — mostly already built here

The request: *"ways to specify some sensitivity and insensitivities… for example, whether
how close the face is shouldn't matter or not."*

There are three levels at which this can be answered, and this repo is already at level 1.

### Level 1 — invariance by construction (SHIPPED, #131)

`src/features/types.ts` already defines the vocabulary:

```ts
export type Invariance = 'scale' | 'position' | 'yaw' | 'pitch' | 'roll';
```

with `scale` documented as *camera distance* — the exact example asked about. Every
catalog feature can declare `invariantTo`, with deliberate three-state semantics: absent
= not assessed, `[]` = assessed and invariant to nothing, a listed axis = moving only
along that axis should not move this feature. The Lab formula compiler already ships
`residual(x, z)` and `deconfound(x, z1, z2, …)` to correct a feature for a confound it is
*not* invariant to.

**So the mechanism exists; nothing consumes it.** A trainer that lets the player tick
"camera distance shouldn't matter" needs to (a) prefer features declaring
`invariantTo: ['scale']`, (b) apply `residual()` against the scale proxy for those that
don't, and (c) *say* which features it dropped and why. That is a selection policy over
existing data, not new mathematics — by far the cheapest of the three levels.

A blunt but effective complement: normalise the landmark mesh itself (Procrustes-style —
translate, scale by inter-ocular distance, optionally rotate out head pose) before any
feature is computed. The catalog already computes `iod` as its face-scale reference.

### Level 2 — invariance by demonstration (the elegant answer)

The contrastive-learning literature's core mechanism: two transformed views of the same
thing form a *positive pair*, and the representation is trained so "the same sample after
different transformations should be consistent in the feature space", letting the network
"ignore some details" [21][22]. Standard practice bakes in invariance to a *pre-defined*
set of augmentations — but recent work introduces an explicit **invariance descriptor**
denoting whether a feature extractor should be invariant or *sensitive* to each factor of
variation [23], precisely because treating every augmentation equally "limits flexibility"
[24].

The translation to this instrument is direct and rather beautiful:

> **Let the player demonstrate the nuisance.** "Hold the same expression and move closer
> and further away." Every frame of that clip is a positive pair with every other. Learn
> a metric (or simply down-weight the feature directions with the highest variance across
> that clip) in which they are all the same point.

This needs no deep network — a linear whitening or a per-dimension variance down-weight
over the nuisance clip captures most of it, and it generalises to *any* nuisance the
player can perform, including ones nobody enumerated. It also matches the interaction
model already established: you teach it by doing it.

Note the honest caveat from the same literature: **there is no consensus on how to measure
invariance** of a learned representation to a nuisance factor [21]. So whatever ships must
show the player the effect (a meter that should stay flat while they move closer) rather
than claim a number.

### Level 3 — adversarial / disentangled invariance

Full nuisance-invariant representation learning [25][26]. Real, well-studied, and
comprehensively out of budget for a browser instrument. Recorded so it is knowingly
declined.

---

## 7. A sketch of what this could be in thoremin

Not a commitment — the design lives in the issue. But the substrate is unusually ready,
and the shape follows from §§3–6.

**Train on the feature vector, and modality-generality is free.** `src/features/catalog.ts`
already assembles face and hand features into "a flat, ordered registry of every scalar
feature id + its group" with a uniform `compute(ctx) → number` contract, an online
normalizer, and per-feature `invariantTo` / `controllability` declarations. A trainer that
takes `Record<featureId, number>` is, on day one, a *face* trainer, a *hand* trainer, and a
trainer for anything added to the catalog later — which is what "start with face but make
it generalizable to any inputs" asks for. Building it against `FaceFrame` instead would be
the single decision that makes it face-only forever.

Sketch of the pipeline, each stage a named seam:

| Stage | What it does | Prior art |
|---|---|---|
| **Sample** | velocity-gate the live feature vector; keep still-points | [19][20] |
| **Condition** | drop / `residual()` features against declared nuisance axes; optionally learn a down-weighting from a nuisance clip | #131, [21][23] |
| **Carve** | agglomerative hierarchy over still-points; cut at k (before or after) | [16][17] |
| **Reject** | distance threshold τ → no-man's-land, hysteretic | [12][13] |
| **Bind** | assign each category to a command / dial write | the #127 registry |

Two existing pieces make the last row nearly free. `#129` already ships discrete hand
poses → command dispatch with edge-triggering, hold and cooldown; a trained category is
just another discrete event feeding the same adapter. And `#127` (this session) makes
every param write a recorded, replayable, undoable command — so "bind category 3 to this"
is a command, and a mis-trained model's damage is one ⌘Z.

**And the honest warning, from #137 and #119:** a trainer buried in a settings panel is
not shipped. It needs an entry in `src/app/tools.ts` and a reachability test.

---

## 8. What NOT to do

- **Do not classify per frame into a hard category and drive sound from that.** Both XMM
  and GVF output continuously for a reason [9][14]. A step function is not expressive.
  Prefer per-category *membership weights* (soft assignment) as the mapping output, with
  the hard category available for discrete triggers.
- **Do not cluster raw frames.** The stream is mostly transitions; you will find the
  middle of the motion envelope (§3.2).
- **Do not train on the 52 raw blendshapes directly.** The catalog exists, is normalized,
  and carries the invariance metadata. Bypassing it forfeits §6 Level 1 entirely.
- **Do not present a discovered k as correct.** The dendrogram literature is explicit that
  it over-suggests structure [16].
- **Do not make no-man's-land silent** (§5.3).
- **Do not build Level 3 invariance** (§6).

---

## 9. Open questions for the maintainer

1. **Is the target a category set (discrete) or a continuous space (regression)?** The
   request says categories, but the whole IRCAM line argues that continuous is more
   musical and the Wekinator line supports both. Soft membership may be the answer that
   avoids choosing.
2. **Is training a session act or a persistent artefact?** A trained model is a per-player
   thing that should presumably persist alongside instruments — which makes it a zodal
   collection question, and would inherit the #82 fragment/composition thinking.
3. **Does a trained category map to a command, or to a continuous dial?** Both are
   possible on the #127 write path; they are different products.
4. **How much recording is acceptable?** 30 s, 60 s, 5 min? This bounds the algorithm
   choice more than anything else in this document.

---

## REFERENCES

1. [Progressive Multi-Source Domain Adaptation for Personalized Facial Expression Recognition](https://arxiv.org/pdf/2504.04252) — personalization depends on subject-specific labels usually unavailable in the wild.
2. [Personalized two-stage comparison-based framework for low-to-mid-intensity facial expression recognition in real-world scenarios](https://www.sciencedirect.com/science/article/pii/S2667305326000025)
3. [Norface: Improving Facial Expression Analysis by Identity Normalization](https://arxiv.org/pdf/2407.15617) — expressions and identities are inherently entangled.
4. [The Wekinator: A System for Real-time, Interactive Machine Learning in Music](https://archives.ismir.net/ismir2010/latebreaking/000012.pdf) — Fiebrink, ISMIR 2010 late-breaking.
5. [Wekinator — software for real-time, interactive machine learning](https://doc.gold.ac.uk/~mas01rf/Wekinator/) — classification, regression, temporal modelling.
6. [XMM — Probabilistic Models for Motion Recognition and Mapping](https://ismm.ircam.fr/software/xmm-probabilistic-models-for-motion-recognition-and-mapping/) — IRCAM ISMM.
7. [Motion-Sound Mapping through Interaction](https://hal.science/hal-02409300/file/TiiS_HCML___Mapping_through_Interaction.pdf) — Françoise & Bevilacqua.
8. [Motion-Sound Mapping by Demonstration](https://theses.hal.science/tel-01206009v2/file/2015PA066105.pdf) — Françoise PhD thesis, 2015.
9. [Gesture–Sound Mapping by Demonstration in Interactive Music Systems](https://hal.science/hal-01061221/document) — hierarchical HMM, user-authorable structure.
10. [Fractional Adaptive Resonance Theory (FRA-ART): an extension for a stream clustering method](https://doi.org/10.3390/math12132049) — ART for streams; vigilance; low complexity.
11. [Distributed dual vigilance fuzzy adaptive resonance theory learns online, retrieves arbitrarily-shaped clusters, and mitigates order dependence](https://arxiv.org/pdf/1901.00794) — dual vigilance; the order-dependence problem.
12. [Open Set Recognition — overview](https://www.sciencedirect.com/topics/computer-science/open-set-recognition) — thresholding formulation; threshold-tuning is crucial.
13. [Toward Open-Set Face Recognition](https://arxiv.org/pdf/1705.01567) — the "none of the above" option.
14. [Adaptive Gesture Recognition with Variation Estimation for Interactive Systems](https://research.gold.ac.uk/10541/1/gvf_tiis_si.pdf) — Caramiaux et al., ACM TiiS 4(4), 2014.
15. [ofxGVF — Gesture Variation Follower](https://github.com/bcaramiaux/ofxGVF) — reference implementation.
16. [Hierarchical clustering: cutting the dendrogram](https://www.displayr.com/what-is-dendrogram/) — cut at height h or specify k; and the caution against reading k off a dendrogram.
17. [Hierarchical agglomerative clustering](https://nlp.stanford.edu/IR-book/html/htmledition/hierarchical-agglomerative-clustering-1.html) — Manning, Raghavan & Schütze; the largest-gap cut heuristic.
18. [Teachable Machine](https://teachablemachine.withgoogle.com/) — the interaction benchmark; webcam samples per class.
19. [Unsupervised Gesture Segmentation by Motion Detection of a Real-Time Data Stream](https://ieeexplore.ieee.org/document/7576613/) — dynamic vs static segments from velocity/acceleration.
20. [Segmenting Continuous Motions with Hidden Semi-Markov Models and Gaussian Processes](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5742615/) — unsupervised segmentation of continuous time series.
21. [Weakly Supervised Invariant Representation Learning via Disentangling Known and Unknown Nuisance Factors](https://arxiv.org/pdf/2209.06827) — nuisance factors; no consensus on measuring invariance.
22. [Improving Transformation Invariance in Contrastive Representation Learning](https://arxiv.org/pdf/2010.09515)
23. [Amortised Invariance Learning for Contrastive Self-Supervision](https://arxiv.org/pdf/2302.12712) — the *invariance descriptor*: be invariant or sensitive, per factor.
24. [Rethinking the Augmentation Module in Contrastive Learning](https://arxiv.org/abs/2206.00227) — treating augmentations equally limits flexibility.
25. [Unsupervised Adversarial Invariance](https://arxiv.org/pdf/1809.10083)
26. [Unified Adversarial Invariance](https://arxiv.org/pdf/1905.03629)
