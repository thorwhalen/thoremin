# Live audio-to-audio in the browser, and sound-triggered sampling

Research for thoremin: what a browser can do with a live microphone or line stream turned into a live audio stream, with the main theme being "hit a sound, hear a sample" (percussive classification and triggering). Written 2026-10-29. Figures marked (secondary) were read from a summary or a retailer page and not from the primary paper; they are flagged so nobody builds on them unchecked.

## Summary

- The latency floor of a browser instrument is set by the platform, not the algorithm: one AudioWorklet render quantum is 128 frames, 2.67 ms at 48 kHz [38], and the round trip microphone to speaker in a desktop browser is typically tens of milliseconds, so the algorithm's own budget should be a few milliseconds and must be measured on the target device, not assumed (thoremin already has a latency probe with a microphone strike test for exactly this).
- Perceptual targets: ~10 ms (secondary) with jitter under 1 ms is the classic "intimate control" criterion [16]; Lago and Kon argue 20-30 ms can be acceptable for many purposes and that jitter matters more than latency [17]; a continuous-sound instrument tolerated up to 120 ms with little error growth, but percussion is far stricter [18].
- A sound-triggered sampler is a "segment and classify" problem [11]: causal onset detection is cheap (energy or spectral-flux detectors fire within one analysis hop, [2]), the expensive part is that classes are only separable once enough of the sound has been heard. Stowell and Plumbley found beatbox classification improved when the analysis started 23 ms after the onset (secondary figure via [13], [14]), which is the core tension of the whole design.
- The practical resolution is "decide late, sound early": fire a class-agnostic or provisional-class transient at the onset, refine the class from a 3-12 ms attack window plus a later window, and crossfade or re-layer. Commercial trigger tools expose the same trade-off as latency modes (Trigger 2 advertises a live mode "as low as 4 ms", a vendor claim [48]).
- Embedding models (YAMNet 0.96 s windows [32], PANNs [33], CLAP [34], OpenL3 [35]) are too slow to decide a trigger, but are good for offline enrolment and for choosing which hand-made features to trust; per-user few-shot adaptation with a nearest-prototype classifier is what the vocal-percussion literature converges on [11], [14].
- Native Web Audio nodes cover filters, delay, convolution reverb, waveshaping and analysis; pitch shifting, granular, vocoder and anything custom needs an AudioWorklet. Neural timbre transfer (RAVE, DDSP) runs in real time natively (nn~, VST) but in-browser real time is still marginal; treat it as a later seed, not a v1 dependency.
- Licence trap: Essentia.js is AGPLv3 (commercial licence on request) [37]; thoremin is a public static bundle, so linking it would impose AGPL on the whole bundle. Prefer Meyda (MIT) [36] or hand-written worklet features.
- Recommendation: one AudioWorklet that does onset detection, early-window features, nearest-prototype classification and sample playback with no main-thread round trip (section 8).

## 1. Effects

Which are native nodes and which need an AudioWorklet (the worklet is the only place to run custom per-sample code with deterministic block timing [38], [39]).

| Effect | Method | Native node? | Added latency | Notes |
|---|---|---|---|---|
| Filters (LP/HP/BP/shelf/peaking) | biquad | `BiquadFilterNode` | ~0 | Native, zero-latency; an envelope-modulated filter is an AudioParam automation |
| Delay / echo | delay line plus feedback | `DelayNode` (min one render quantum inside a feedback loop) | by design | Feedback loops add a 128-frame floor per loop pass |
| Convolution reverb | partitioned FFT convolution | `ConvolverNode` | ~0 to a few ms (partitioning) | Best for real spaces; cost grows with impulse length |
| Algorithmic reverb | feedback delay network or Dattorro plate [45] | no (compose delays and filters, or a worklet) | ~0 | Cheaper than convolution, tweakable decay, no impulse file |
| Distortion / waveshaping | static nonlinearity | `WaveShaperNode` (oversample option) | small with oversampling | Aliasing is the issue; use `oversample: '4x'` |
| Compressor / gate | dynamics | `DynamicsCompressorNode` (compressor only; no gate/expander) | lookahead fixed by the browser | A gate is an envelope follower in a worklet |
| Pitch shift, time domain (granular / overlap-add) | two crossfading delay taps, or grain clouds | no | grain length (10-50 ms) | Simple, glitchy on tonal material, fine on percussion and voice effects |
| Pitch shift, phase vocoder | STFT with phase locking [43] | no | window length (20-60 ms) | Smears transients; use transient detection |
| Pitch shift, PSOLA | pitch-synchronous overlap-add [44] | no | a few pitch periods | Excellent for monophonic voice, needs a pitch tracker |
| Vocoder | band-pass bank plus envelope followers | filters native; followers need a worklet or `AnalyserNode` polling | ~ a block | Classic and cheap |
| Harmoniser | pitch shifter copies at scale intervals | no | as the shifter | Pair with a scale quantiser, like the existing chord instruments |
| Granular | grains from a live ring buffer | no | grain length | Natural fit for "live audio into a texture" |

Library verdicts: Tone.js wraps all the native nodes with a scheduler and ships a granular player and pitch shifter [54] (MIT; depend if a high-level scheduler is wanted, but thoremin already owns its own graph and clock, so study it only). Signalsmith Stretch [46] (MIT, an AudioWorklet time-stretch and pitch-shift library thoremin already uses for the song player) is the best off-the-shelf pitch shifter and is "depend". Faust compiled to WebAssembly [58] gives a large effects library as worklets (the compiler is GPL; the licence of generated code should be checked per library before shipping). Superpowered [57] is commercial and not suitable for a free public bundle.

## 2. Analysis-driven effects

An envelope follower is the base of everything here: rectify, then one-pole smoothing with separate attack and release coefficients, one multiply-add per sample, trivial in a worklet. It drives filter cutoff (auto-wah), ducking, gating and vocoder bands, and is also the first stage of the trigger of section 4.

Pitch tracking turns audio into a control voltage plus gate, which can drive any thoremin voice (a pitch-tracked synth, a harmoniser).

| Tracker | Idea | Latency | Verdict |
|---|---|---|---|
| YIN [28] | cumulative-mean-normalised difference function, absolute threshold | needs ~2 periods of the lowest pitch (about 25-50 ms at 40-80 Hz) | Implement in a worklet; small and well understood |
| McLeod Pitch Method [29] | normalised square difference, peak picking with a clarity measure | similar to YIN, often faster to a decision | Good default for voice and instruments; permissive implementations exist |
| pYIN [30] | YIN candidates plus HMM smoothing | offline-ish (Viterbi) | Study; the causal part is YIN |
| CREPE [27] | CNN on 1024-sample frames (64 ms at 16 kHz) | frame length plus inference (tfjs) | Accurate on noisy input, heavier; optional, off the audio thread |
| Basic Pitch [31] | lightweight polyphonic note transcription and multipitch (audio to MIDI) | windowed (about 2 s context), not real time | Offline "audio to MIDI" import, not a live trigger; the TypeScript package runs on tfjs |

Audio-to-MIDI live is therefore: monophonic tracker (YIN or MPM) plus onset detector plus note state machine; polyphonic live audio-to-MIDI in a browser is research, not product.

## 3. Timbre transfer

- DDSP [23]: differentiable harmonic-plus-noise synthesis controlled by pitch and loudness; the "tone transfer" demo [50] and DDSP-VST [49] show it real time on desktop. The decoder is small, so a tfjs or ONNX port is plausible, but the published real-time path is native.
- RAVE [24]: a variational autoencoder with a multiband decoder trained adversarially, fast enough for real time on a laptop CPU as a native model; the real-time route is the nn~ external for Max and Pd [51]. Latency is dominated by the model's block size (a few hundred milliseconds in the stock configurations is common; verify per model).
- Neural codecs EnCodec [25] and DAC [26] compress audio into discrete tokens; useful as a representation for generative work, not as a live effect (frame-rate and decoder cost, no browser real-time demonstrations that I could verify).
- In-browser: ONNX Runtime Web [52] (WebAssembly, WebGPU) and TF.js [53] can run such decoders, but a real-time guarantee needs the inference in a worker feeding a worklet ring buffer, which adds block-sized latency. Verdict: study; a seed for later, gated behind a model download.

## 4. Sound-triggered sampling and percussive classification (the main theme)

### 4.1 Commercial prior art

- Drum replacement plug-ins (Slate Trigger 2 [48], Massey DRT, tracker modes in drum libraries): detect a hit on a drum-track audio, then play a layered sample chosen by velocity. They are offline-first tools with a "live" latency mode; Trigger 2 lists several latency modes and a live mode as low as 4 ms (vendor claim [48]), and a leakage-suppression stage for mic bleed. The common pattern is: very fast peak/threshold detection, velocity from the peak, and a user-set detail or look-ahead window that trades timing for fidelity. I could not find primary documentation for Massey DRT.
- Sensory Percussion (Sunhouse) [47]: a contact sensor on the drum head, machine learning that learns up to ten zones per drum from three training levels, mapping zones and dynamics to samples and effects. It sidesteps the microphone classification problem with a clean, bleed-free sensor signal. No latency figures are published in the sources I found.

### 4.2 Research on vocal percussion (beatboxing) to drums

- Hazan: segmentation, descriptor and learning stages, packaged as the BillaBoop voice-driven drum generator [9], [10]. This is the archetype of segment, describe, classify with user training.
- Stowell and Plumbley: "delayed decision-making": classification improves if the first analysis frame starts later than the onset (reported as 23 ms in later papers [13], [14]); the thesis [8] frames this as the central real-time trade-off, and proposes triggering something immediately and deciding the class afterwards.
- Ramires et al.: Live Vocalised Transcription (LVT), a user-specific segment-and-classify system for Ableton, compared against Ableton's own drums-to-MIDI [11].
- Delgado et al.: the AVP dataset (28 participants, 9780 utterances of kick, snare, closed and open hi-hat) [12]; query by vocal percussion comparisons [13]; user-based deep embeddings for robust personal classification [14].
- Mehrabi et al.: learned features (convolutional autoencoders) predict perceived similarity of vocal imitations to drum sounds better than MFCCs, and temporal information matters more than spectral resolution [15].

### 4.3 Drum transcription (ADT)

The Wu et al. review [4] frames ADT as onset detection plus classification (NMF and RNN families); Southall et al. [5], [6] and Vogl et al. [7] moved to bidirectional RNNs, attention and CNNs; Thompson et al. classify bar-level patterns [59]. These are offline, bidirectional, polyphonic and trained on large corpora, so they are the wrong tool for a causal, per-user trigger but show which features and activations matter. The segment-and-classify school [11] is the right ancestor for thoremin.

### 4.4 Few-shot classification

Prototypical networks [20] classify by distance to class means of embedded support examples; Wang et al. adapt metric-based few-shot learning to sound event detection [19]; the DCASE 2021 task 5 on few-shot bioacoustic detection [21] with prototypical-network entries [22] shows the paradigm on long recordings. For thoremin the useful content is the shape: a handful of enrolled examples per class (the user hits or says each sound five to ten times), a distance to class means, and a rejection threshold for "none of these" (thoremin's trainer already has the enrolment, noise-unit and nearest-centroid machinery in the SDK).

## 5. Methods

### 5.1 Onset detection

- Bello et al. tutorial [1]: energy, high-frequency content (HFC), spectral flux, phase and complex-domain detection functions followed by peak picking. For percussion, energy and HFC suffice; spectral flux generalises.
- Online variants: Böck et al. [2] adapt detectors to be causal (no look-ahead beyond the frame) and show online accuracy close to offline with the right preprocessing; SuperFlux [3] adds a maximum filter that suppresses vibrato false positives and remains causal.
- Latency of detection = analysis frame centre delay + peak-picking confirmation. A time-domain detector (fast envelope against a slow envelope, ratio above a threshold, then a refractory period) can fire within 1 ms of the rise; STFT detectors pay roughly half a window (5-12 ms for 512-1024 samples at 44.1-48 kHz) plus a one-frame peak-pick delay. For a trigger, the fast time-domain detector decides when; the spectrum decides what.

### 5.2 Features and their windows

| Feature | Window needed | Use |
|---|---|---|
| Log energy in 3-4 bands (low/mid/high), time-domain filters | 1-5 ms | Kick vs snare vs hat first guess |
| Zero-crossing rate | 2-10 ms | Noisy (hat) vs tonal (kick) |
| Spectral centroid, rolloff, flatness | 5-12 ms (64-512 samples, FFT) | Brightness |
| Attack slope / rise time | 2-10 ms | Hit sharpness, velocity |
| MFCC (13-20) | 10-25 ms frames, 2-4 frames after onset | Standard timbre; Meyda computes them [36] |
| YAMNet embedding | 0.96 s window [32] | Far too long to trigger; offline use only |
| PANNs [33], CLAP [34], OpenL3 [35] | seconds | Offline enrolment, retrieval, clustering |

### 5.3 Classifiers

k-NN and nearest centroid on standardised features need no training loop, adapt instantly as the user adds examples, and cost a few multiply-adds per class per hit; templates plus dynamic time warping help for longer gestures but not for 10 ms attacks. Prototype methods with a rejection radius are what to ship first [20], [14].

## 6. Latency physics and the trigger trade-off

- Render quantum: the AudioWorklet processes 128 frames per call; 128 / 48000 = 2.67 ms (2.9 ms at 44.1 kHz) [38], [39]. A worklet that detects an onset in block n can start playback in block n+1 at the earliest, or at a sample offset inside block n+1 if it schedules in its own output loop.
- `AudioContext({ latencyHint: 'interactive' })` asks for the smallest safe buffer; `baseLatency` reports the context's processing latency and `outputLatency` an estimate of the hardware path [40], [41]. Both are estimates; Safari and Firefox historically differ in what they report. thoremin's timing resource already folds these with a measured pair.
- Input side: `getUserMedia` with `echoCancellation`, `noiseSuppression` and `autoGainControl` all set to false [42]. Reasons: they add processing delay (tens of ms in some stacks), they gate and compress transients (a hit is a transient; noise suppression treats it as noise and AGC flattens velocity), and echo cancellation ducks the input when speakers play, which a sampler that plays what it hears will trigger constantly. Browsers may ignore the constraints, so read back `getSettings()`.
- Round trip: typical reports for Chrome on macOS with built-in audio are in the 20-40 ms range for microphone to speaker, and Windows without a low-latency driver commonly 40-100 ms or more; Bluetooth adds 100-300 ms. These are folklore ranges, not values from a controlled source; measure with the strike test and display it to the player.
- Perceptual thresholds: Wessel and Wright ask for latency around 10 ms (secondary) with jitter within 1 ms [16]; Lago and Kon review the data and say 20-30 ms can be acceptable and recommend trading jitter for latency [17]; Mäki-Patola and Hämäläinen found errors in a continuous-sound instrument rose about 80% at 240 ms while up to 120 ms barely mattered [18]. A percussionist hears flams and comb filtering once the sample and the acoustic sound are offset by a few milliseconds if both are audible, so a pure sampler (no acoustic sound reaching the ear) can tolerate more than a hybrid kit.
- The trade-off, as budget: total = input path + detection + (optional classification wait) + output path. The first and last are fixed by the platform; the player controls only the middle term. Waiting 12 ms for a better class costs 12 ms of felt latency for every hit; waiting 0 ms costs accuracy on the confusable pairs (snare vs clap, closed vs open hat).
- Strategies that remove the wait:
  1. Provisional class: classify from the first 3-5 ms, play that sample, and if the later window disagrees, fade it quickly and start the correct one (audible as a flam if the error is slow, so keep the correction under ~10 ms or crossfade).
  2. Class-agnostic transient: play a shared click or a brief noise burst immediately, then the class sample after the decision with a short fade-in; the transient hides the delay (this is the logic of "predict, then correct" and of Stowell's thesis [8]).
  3. Per-class lead: record the class sample with its own pre-roll trimmed so the sample's attack lands inside the decision delay.
  4. Zones from the sensor, not the microphone (Sensory Percussion [47]): avoid the problem by a cleaner signal; not available to a webcam-and-microphone web page.

## 7. Browser libraries

| Library | Licence | Maturity | What it gives | Verdict |
|---|---|---|---|---|
| Web Audio API and AudioWorklet [38], [39] | W3C spec, built in | Stable in all current engines | Everything above | Depend |
| Meyda [36] | MIT | Mature, low activity (last push 2024) | MFCC, centroid, rolloff, ZCR, flux, in worklet or main thread | Wrap or study: use for offline enrolment; the worklet's hot path should be hand-written |
| Essentia.js [37] | AGPLv3; commercial licence on request | Mature (ISMIR 2020 library), ~200 WASM algorithms | Onsets, MFCC, key, beats, TF models | Avoid for the bundle (AGPL on a public client-side app); study the algorithms |
| TF.js [53] | Apache-2.0 | Mature | Run YAMNet, CREPE, Basic Pitch [31], [32] | Depend lazily for offline analysis, never on the audio thread |
| ONNX Runtime Web [52] | MIT | Mature | WASM and WebGPU model inference | Depend lazily if a model needs it |
| Tone.js [54] | MIT | Mature | Scheduler, effects, granular | Study; thoremin owns its clock |
| ml5.js [55] | MIT | Education-grade | TF.js wrappers, sound classifier | Avoid for a latency-critical path |
| aubio (WASM builds) [56] | GPL-3 | Mature C library; web ports are community | Onset (several functions), pitch (YIN, YINFFT), tempo | Study; the GPL blocks linking into this bundle |
| Superpowered [57] | Commercial | Mature | Low-latency analyzers, effects in WASM | Avoid (licence, closed) |
| Faust to WASM [58] | Compiler GPL; check generated-code terms per library | Mature | DSP effects as worklets | Wrap for effects seeds after checking terms |
| Signalsmith Stretch [46] | MIT | Mature | Pitch and time shift worklet | Depend (already used) |

Licence summary: thoremin is public and static, so any library linked into the shipped bundle must be compatible with distribution of its full source; AGPL and GPL components cannot be bundled without relicensing thoremin, which is why the recommendation hand-writes the three or four features it needs.

## 8. What thoremin should build

### 8.1 The sound-triggered sampler ("Hit Sampler")

One AudioWorklet node, `sound-trigger`, with the microphone as its only input and the audio output a normal node output. Everything between the hit and the sample's first sample happens inside `process()`:

1. Input: `getUserMedia` with echo cancellation, noise suppression and automatic gain off, mono, read back with `getSettings()`.
2. Detector: a time-domain detector (fast envelope over ~1 ms against a slow floor of ~50 ms, ratio threshold, adaptive floor, refractory ~30-50 ms). It runs per sample, so the onset time is known to the sample, not the block.
3. Early window: on onset, copy the next 3-12 ms (default 8 ms, a dial) of samples from a ring buffer that already holds the previous few ms (pre-onset context makes the attack slope measurable). Compute hand-made features: log energy in 3 bands, zero-crossing rate, spectral centroid from a small FFT or a 3-filter bank, rise time, peak level (for velocity).
4. Classification: nearest prototype in a standardised feature space with a rejection radius, using the enrolment code already present in the SDK for noise units and prototypes. Provisional class at 3 ms, final class at the window end.
5. Playback from the worklet itself: sample buffers decoded on the main thread and transferred once to the worklet, then played from a voice pool in `process()`; no `postMessage` between hit and sound. Provisional class starts at once; if the final class differs, the provisional voice gets a 5 ms fade and the final voice starts (or, option B, a short class-agnostic transient plays first).
6. Messages out (class, confidence, velocity, time) go to the main thread asynchronously for the overlay and for other nodes, never on the critical path.
7. Enrolment: a trainer cue "hit it 8 times", per class, storing features and the raw early windows as the sample set (samples as the SSOT, model derived, like the other categorizers); a "none" class from room noise.
8. Verification: replay recorded hits through a headless worklet harness; the existing latency probe's strike test gives glass-to-air numbers per device and the classification accuracy per window length gets a table in this document's successor (evaluate on AVP [12] for voice and on a short self-recorded set for tapping and table hits).

Open questions to settle by measurement, not by argument: how short a window still separates kick, snare and hat for vocal and for tapped sounds; how often the provisional class is wrong; and the felt cost of correction versus waiting.

### 8.2 Further audio-to-audio seeds, ranked

1. Envelope-driven filter and gate (auto-wah, ducking, noise gate): native nodes plus one follower worklet, the cheapest win and reuses the follower of the trigger.
2. Pitch-tracked synth ("sing a melody, hear a synth"): MPM or YIN in a worklet plus the existing voices and scale quantiser; also a harmoniser feeding the chord instruments.
3. Live granular looper: record a ring buffer, play grains with hand position as the grain position and density; fits the camera instruments as the gesture source.
4. Vocoder: speak into the microphone, a thoremin voice as the carrier (filter bank plus followers, native filters).
5. Loop-and-layer sampler on onsets: use the same detector to start and stop a looper without touching the keyboard.
6. Pitch shifter and harmoniser using Signalsmith Stretch, with hand height as interval.
7. Convolution and algorithmic reverb space control, with hand position as size and mix.
8. Neural timbre transfer (RAVE/DDSP via ONNX Runtime Web in a worker, block-sized latency): last, and only behind an explicit download and a stated latency.

## References

[1] J. P. Bello, L. Daudet, S. Abdallah, C. Duxbury, M. Davies, M. B. Sandler. A tutorial on onset detection in music signals. IEEE Trans. Speech Audio Process. 2005. [doi](https://doi.org/10.1109/TSA.2005.851998)
[2] S. Böck, F. Krebs, M. Schedl. Evaluating the online capabilities of onset detection methods. ISMIR 2012. [PDF](https://archives.ismir.net/ismir2012/paper/000049.pdf)
[3] S. Böck, G. Widmer. Maximum filter vibrato suppression for onset detection (SuperFlux). DAFx-13. [DAFx archive](https://dafx.de/paper-archive/details/0oee-99Z88WL7pSo749gcA)
[4] C.-W. Wu, C. Dittmar, C. Southall, R. Vogl, G. Widmer, J. Hockman, M. Müller, A. Lerch. A review of automatic drum transcription. IEEE/ACM TASLP 26(9), 2018. [accepted version](https://www.open-access.bcu.ac.uk/6180/)
[5] C. Southall, R. Stables, J. Hockman. Automatic drum transcription for polyphonic recordings using soft attention mechanisms and convolutional neural networks. ISMIR 2017. [record](https://www.open-access.bcu.ac.uk/4747)
[6] C. Southall, R. Stables, J. Hockman. Automatic drum transcription using bi-directional recurrent neural networks. ISMIR 2016. [record](https://pureportal.bcu.ac.uk/en/publications/automatic-drum-transcription-using-bi-directional-recurrent-neura-2/)
[7] R. Vogl, G. Widmer, P. Knees. Towards multi-instrument drum transcription. DAFx 2018. [arXiv 1806.06676](https://arxiv.org/abs/1806.06676)
[8] D. Stowell. Making music through real-time voice timbre analysis: machine learning and timbral control. PhD thesis, Queen Mary University of London, 2010. [EURASIP thesis page](https://theses.eurasip.org/document/making-music-through-real-time-voice-timbre-analysis-machine-learning-and-timbral-control/)
[9] A. Hazan. Towards automatic transcription of expressive oral percussive performances. IUI 2005. [record](https://researchr.org/publication/Hazan05)
[10] A. Hazan. Performing expressive rhythms with BillaBoop voice-driven drum generator. DAFx 2005. [PDF](https://www.dafx.de/paper-archive/2005/P_254.pdf)
[11] A. Ramires, F. Penha, M. Davies. User specific adaptation in automatic transcription of vocalised percussion. arXiv 2018. [arXiv 1811.02406](https://arxiv.org/abs/1811.02406)
[12] A. Delgado, C. McDonald, R. Stables, et al. A new dataset for amateur vocal percussion analysis. [arXiv 2009.11737](https://arxiv.org/abs/2009.11737)
[13] A. Delgado, C. Saitis, M. Sandler. Learning models for query by vocal percussion: a comparative study. [arXiv 2110.09223](https://arxiv.org/abs/2110.09223)
[14] A. Delgado, et al. Deep embeddings for robust user-based amateur vocal percussion classification. [arXiv 2204.04646](https://arxiv.org/abs/2204.04646)
[15] A. Mehrabi, K. Choi, S. Dixon, M. Sandler. Similarity measures for vocal-based drum sample retrieval using deep convolutional auto-encoders. ICASSP 2018. [arXiv 1802.05178](https://arxiv.org/abs/1802.05178)
[16] D. Wessel, M. Wright. Problems and prospects for intimate musical control of computers. NIME 2001. [NIME proceedings](https://nime.org/proc/nime2001_wessel/)
[17] N. P. Lago, F. Kon. The quest for low latency. ICMC 2004. [USP repository](https://repositorio.usp.br/item/003187161)
[18] T. Mäki-Patola, P. Hämäläinen. Effect of latency on playing accuracy of two gesture controlled continuous sound instruments without tactile feedback. DAFx-04. [PDF](https://dafx.de/paper-archive/2004/P_011.PDF)
[19] Y. Wang, J. Salamon, N. J. Bryan, J. P. Bello. Few-shot sound event detection. ICASSP 2020. [PDF](https://njb.github.io/research/icassp2020_few_shot_sed.pdf)
[20] J. Snell, K. Swersky, R. Zemel. Prototypical networks for few-shot learning. NeurIPS 2017. [arXiv 1703.05175](https://arxiv.org/abs/1703.05175)
[21] V. Morfi, I. Nolasco, et al. Few-shot bioacoustic event detection: a new task at the DCASE 2021 challenge. [record](https://research.tilburguniversity.edu/en/publications/few-shot-bioacoustic-event-detection-a-new-task-at-the-dcase-2021/)
[22] M. Anderson, N. Harte. Bioacoustic event detection with prototypical networks and data augmentation. [arXiv 2112.09006](https://arxiv.org/abs/2112.09006)
[23] J. Engel, L. Hantrakul, C. Gu, A. Roberts. DDSP: differentiable digital signal processing. ICLR 2020. [arXiv 2001.04643](https://arxiv.org/abs/2001.04643)
[24] A. Caillon, P. Esling. RAVE: a variational autoencoder for fast and high-quality neural audio synthesis. 2021. [arXiv 2111.05011](https://arxiv.org/abs/2111.05011)
[25] A. Défossez, J. Copet, G. Synnaeve, Y. Adi. High fidelity neural audio compression (EnCodec). 2022. [arXiv 2210.13438](https://arxiv.org/abs/2210.13438)
[26] R. Kumar, et al. High-fidelity audio compression with improved RVQGAN (DAC). NeurIPS 2023. [arXiv 2306.06546](https://arxiv.org/abs/2306.06546)
[27] J. W. Kim, J. Salamon, P. Li, J. P. Bello. CREPE: a convolutional representation for pitch estimation. ICASSP 2018. [arXiv 1802.06182](https://arxiv.org/abs/1802.06182)
[28] A. de Cheveigné, H. Kawahara. YIN, a fundamental frequency estimator for speech and music. JASA 111(4), 2002. [doi](https://doi.org/10.1121/1.1458024)
[29] P. McLeod, G. Wyvill. A smarter way to find pitch. ICMC 2005. [PDF](https://www.cs.otago.ac.nz/tartini/papers/A_Smarter_Way_to_Find_Pitch.pdf)
[30] M. Mauch, S. Dixon. pYIN: a fundamental frequency estimator using probabilistic threshold distributions. ICASSP 2014. [doi](https://doi.org/10.1109/ICASSP.2014.6853678)
[31] R. M. Bittner, et al. A lightweight instrument-agnostic model for polyphonic note transcription and multipitch estimation (Basic Pitch). ICASSP 2022. [arXiv 2203.09893](https://arxiv.org/abs/2203.09893)
[32] YAMNet, TensorFlow Models (Apache-2.0). [repository](https://github.com/tensorflow/models/tree/master/research/audioset/yamnet)
[33] Q. Kong, et al. PANNs: large-scale pretrained audio neural networks for audio pattern recognition. [arXiv 1912.10211](https://arxiv.org/abs/1912.10211)
[34] B. Elizalde, et al. CLAP: learning audio concepts from natural language supervision. [arXiv 2206.04769](https://arxiv.org/abs/2206.04769)
[35] OpenL3, audio embeddings (MARL, NYU). [repository](https://github.com/marl/openl3)
[36] H. Rawlinson, N. Segal, J. Fiala. Meyda: an audio feature extraction library for the Web Audio API. WAC 2015. [repository](https://github.com/meyda/meyda)
[37] A. Correya, D. Bogdanov, L. Joglar-Ongay, X. Serra. Essentia.js: a JavaScript library for music and audio analysis on the web. TISMIR 2021. [article](https://transactions.ismir.net/articles/111)
[38] W3C. Web Audio API specification. [spec](https://www.w3.org/TR/webaudio/)
[39] H. Choi. Audio worklet design pattern. Chrome for Developers. [article](https://developer.chrome.com/blog/audio-worklet-design-pattern)
[40] MDN. AudioContext: baseLatency property. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/baseLatency)
[41] MDN. AudioContext: outputLatency property. [MDN](https://developer.mozilla.org/docs/Web/API/AudioContext/outputLatency)
[42] MDN. MediaTrackConstraints: echoCancellation property. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/echoCancellation)
[43] J. Laroche, M. Dolson. Improved phase vocoder time-scale modification of audio. IEEE Trans. Speech Audio Process. 1999. [doi](https://doi.org/10.1109/89.759041)
[44] E. Moulines, F. Charpentier. Pitch-synchronous waveform processing techniques for text-to-speech synthesis using diphones. Speech Communication 1990. [doi](https://doi.org/10.1016/0167-6393(90)90021-Z)
[45] J. Dattorro. Effect design, part 1: reverberator and other filters. JAES 1997. [PDF](https://ccrma.stanford.edu/~dattorro/EffectDesignPart1.pdf)
[46] Signalsmith Stretch (MIT). [repository](https://github.com/Signalsmith-Audio/signalsmith-stretch)
[47] Sensory Percussion (Sunhouse), as distributed by D'Addario. [product page](https://www.daddario.com/pages/learn-earn-sensory-percussion)
[48] Steven Slate Trigger 2 Platinum (vendor listing, source of the latency-mode claim). [listing](https://www.sweetwater.com/store/detail/Trigger2PL)
[49] Magenta. DDSP-VST. [page](https://magenta.tensorflow.org/ddsp-vst)
[50] Google Research. Tone Transfer. [page](https://sites.research.google/tonetransfer)
[51] ACIDS-IRCAM. nn~ (nn_tilde), neural network external for Max and Pd. [repository](https://github.com/acids-ircam/nn_tilde)
[52] ONNX Runtime Web. [documentation](https://onnxruntime.ai/docs/tutorials/web/)
[53] TensorFlow.js. [site](https://www.tensorflow.org/js)
[54] Tone.js. [site](https://tonejs.github.io/)
[55] ml5.js. [site](https://ml5js.org/)
[56] aubio. [site](https://aubio.org/)
[57] Superpowered. [site](https://superpowered.com/)
[58] Faust (GRAME). [site](https://faust.grame.fr/)
[59] L. Thompson, M. Mauch, S. Dixon. Drum transcription via classification of bar-level rhythmic patterns. ISMIR 2014. [record](https://ir.webis.de/anthology/2014.ismir_conference-2014.31/)
