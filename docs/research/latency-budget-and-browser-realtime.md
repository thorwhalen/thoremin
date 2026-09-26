# Where the lag comes from, and whether another language would cut it

Measured 2026-09-26. Answers the question: *"Where is the lag being created? Would using a different programming language or framework help us reduce this lag? Rust, or since we're in the browser, WebAssembly? What tech do people doing browser-based real-time reactive software use?"* Replaces the estimated budget in [`intent-and-subframe-timing.md`](intent-and-subframe-timing.md) §2.1 with measurements where a browser can take them, and says how to measure the rest (issue #227).

## 0. The short answer

**The lag is made in four places, and none of them is code a different language would speed up.** On an M1 Max MacBook Pro in Chrome 153, with real hand footage fed through the camera path, a hand movement reaches the loudspeaker in about **100 ms** before counting the camera hardware itself, and the camera hardware adds an amount only a physical test can show (one published breakdown attributes about 100 ms to camera and USB on Linux [1]; glass-to-glass tests, which also include the frame wait and a display, measure 50 to 108 ms [2][3]). The four places:

1. **Waiting for the camera** (about 17 ms on average at 30 fps, plus the camera's own sensor-to-computer delay). Fixed by hardware and frame rate, not by code.
2. **The hand-tracking model** (21 ms per frame on the GPU). It is *already* C++ compiled to WebAssembly plus GPU shaders [4]. Its pure-WebAssembly (CPU) path, which is what "rewrite it in a compiled language" amounts to, measured **twice as slow**: 42 ms.
3. **The audio output path** (32 ms from the moment the app writes a new pitch to the moment the speaker plays it, plus 6 ms of look-ahead in the synth's output compressor). This is the operating system's and the browser's buffering, below anything a web page can rewrite.
4. **The synth's deliberate smoothing** (a 30 ms glide: 21 ms to reach half of a new pitch, 69 ms to reach 90 %). A design choice, not a speed problem.

**The code thoremin wrote, the whole DAG tick that turns landmarks into sound and draws the overlay, takes 0.3 ms.** A Rust or WebAssembly rewrite could save at most that 0.3 ms out of about 100, and would add a JavaScript-to-WebAssembly crossing on every tick. The browser software that does real-time audio and video well uses TypeScript for orchestration, C++/Rust/Faust compiled to WebAssembly only for heavy kernels, the GPU for vision and the AudioWorklet thread for audio (§3), which is the shape thoremin already has. The levers that do move the number are architectural (§4): the smoothing constant, the compressor, a camera frame rate of 60, inference in a worker, and, for the part no pipeline can remove, **anticipating the gesture** rather than reacting to it.

## 1. The measured budget

One reactive path: a hand moves, the camera sees it, the model finds it, the tick maps it to a pitch, the synth glides to it, the speaker plays it. "Measured" means taken on the running, built app under `?probe=latency` by `smoke/latency/measure.mjs` (§5); mean ± standard deviation over 596 to 1656 samples, because jitter is judged as harshly as latency (`intent-and-subframe-timing.md` §1).

**Machine:** MacBook Pro, Apple M1 Max, Chrome for Testing 153 (headed), WebGL through ANGLE on Metal, display refresh 120 Hz, output to the built-in speakers at 44.1 kHz. **Camera:** Chromium's fake capture device playing 6 s of 1280x720 30 fps footage with two hands in view (hands found in 68 % of frames), so every stage from the browser onward is real, and the stage before it (the physical camera) is not.

| # | Stage | Measured | How | Would Rust/WASM or another framework help? |
|---|---|---|---|---|
| 1 | Wait for the frame that contains the motion | 0 to 33 ms, mean 16.7 (frame period measured 33.3 ± 3.4 ms) | capture stamps of consecutive frames | **No.** Only a higher frame rate: 60 fps halves it [2][5] |
| 2 | Sensor exposure and readout, ISP, USB, OS capture stack | **not measurable in a page**; one breakdown attributes ~100 ms to camera + USB on Linux [1]. Glass-to-glass figures (108 ms for one webcam [3]) also contain stage 1 and a display, so they bound this stage from above | the strike test (§5.2) measures it with a microphone | **No.** None of this code runs in the page [6] |
| 3 | Capture stamp to the frame reaching inference | 4.1 ± 2.5 ms (fake camera; a real one adds its own driver path) | `FrameTiming.lag` from `requestVideoFrameCallback`'s `captureTime` (#226) | **No** language effect |
| 4 | Hand landmark inference, main thread, GPU delegate | **20.5 ± 4.1 ms** (p95 26.5) in the app; 21.0 ± 4.5 in isolation | tick clock minus (capture + lag), which is inference plus any other animation-frame work before the tick (none here: face and body are off by default); a standalone `detectForVideo` loop | **No, it would be slower**: the same model on MediaPipe's CPU delegate, which is its WebAssembly + SIMD (XNNPACK) path [4], measured **42.4 ± 9.1 ms** |
| 5 | Wait for the tick after inference | ~0 ms, *inferred*: the in-app figure equals the isolated inference time | the frame pump's animation-frame callback is registered before the engine clock's, so the tick runs right after inference in the same frame. That order is an accident of start-up: a live source swap (`applyGraph` re-initialising the camera node) would register the pump after the clock and add a frame of wait, which stage 4 would then show | **No** |
| 6 | The DAG tick: every node, the mapping, the synth's parameter writes, the overlay's canvas calls | **0.27 ± 0.20 ms** (p95 0.5) | from the tick's clock reading to the Applier's first sink, right after `engine.tick()` returns (`performance.now()` is coarsened to ~0.1 ms on this page, so this is a mean of quantised samples) | **No.** This is the only stage a Rust/WASM rewrite could touch, and it is 0.3 % of the budget |
| 7 | Parameter write to loudspeaker | **31.9 ± 1.6 ms** (the context reports `baseLatency` 5.8 and `outputLatency` 29 ms; Chrome's output timestamp is not simply their sum) | `AudioContext.getOutputTimestamp()` against `currentTime` at the tick | **No.** OS and browser buffering [7][8]. An AudioWorklet does not shorten it [9] |
| 8 | The synth bus's `DynamicsCompressorNode` look-ahead | **6.0 ms**, fixed | an impulse through the synth's compressor settings, `OfflineAudioContext` | **No** language effect; a different limiter would remove it (§4) |
| 9 | The synth's pitch glide, `setTargetAtTime`, 30 ms time constant | 20.8 ms to half the new pitch, 69 ms to 90 %, 90 ms to 95 % | a step through the same constant, offline | **No.** A design constant [10] |

**Total, hand movement to the pitch being half-way to its new value:** 16.7 + [camera] + 4.1 + 20.5 + 0 + 0.3 + 31.9 + 6.0 + 20.8 ≈ **100 ms plus the camera hardware** (stage 2, which only the strike test in §5.2 can size on a given machine), against 20 to 30 ms for continuous control and about 10 ms for percussive control (`intent-and-subframe-timing.md` §1; Wessel and Wright's bound is 10 ms with 1 ms of jitter [11]).

**What else the measurement showed.**

- **Main-thread inference makes the tick stutter on a 120 Hz display.** The engine ticks on `requestAnimationFrame`, and a 21 ms synchronous `detectForVideo` does not fit in an 8.3 ms frame: tick intervals measured 12.1 ± 12.4 ms, p95 33 ms, where a 120 Hz display should give 8.3. At 60 Hz the frame is 16.7 ms and inference still overruns it. This is the jitter argument for moving inference into a worker (§4).
- **The camera period jitters by ± 3.4 ms** (p5 28.0, p95 38.9 ms) even from a file-backed fake device, so any timing estimate that assumes an even 33.3 ms grid inherits that; this is why #226 stamps each frame with its own capture time.
- **`latencyHint` buys little on this machine.** `interactive` (the app's choice): base 5.8 + output 29 ms. `0` (the lowest the browser will grant): 2.9 + 23 ms, 9 ms less. `balanced`: 10 + 35. `playback`: 23 + 47. The measured `outputLatency` for the built-in speakers is 29 ms, far above the 128 frames (about 3 ms) Chrome's launch notes describe for macOS [12]; the MacBook speakers' own processing is the likely difference (unsourced), and wired headphones should be measured before concluding anything about them. Bluetooth output has been measured at 178 ms [13], more than every other stage together.
- **Headless Chromium is not this machine.** The same script headless reports a software WebGL renderer (SwiftShader) and a virtual audio device; its numbers are recorded in the script's output but are not the budget.

## 2. Stage by stage: would a different language or framework help?

**Camera (stages 1 to 3).** The wait for the frame is uniform over the frame period [5], so the only code-level lever is asking for more frames (`frameRate: {ideal: 60}` [14]) and keeping auto-exposure from lowering the rate in dim light [15]. Everything between the sensor and the `<video>` element is the camera, USB, the operating system's capture framework and Chrome's capture service [6]; a page cannot rewrite it in any language. The one browser-side architectural option is `MediaStreamTrackProcessor`, which hands frames to a worker without the video element [16]; it removes the element and compositor hop, whose cost stage 3 puts at a few ms here.

**Inference (stage 4).** MediaPipe on the web is Google's C++ compiled to WebAssembly with Emscripten, TFLite with XNNPACK on the CPU and WebGL for the GPU [4][17]. So "use Rust/WASM" is already true for the only heavy computation in the pipeline, and its CPU/WASM path is the slow one: 42 ms against 21 ms on the GPU here. WebAssembly runs 45 to 55 % slower than native code on SPEC benchmarks [18], which is why the GPU path wins. What could make inference faster is a different *runtime*, not a different language: WebGPU (MediaPipe Tasks has no WebGPU backend; the request is open [19]; LiteRT.js [20] and ONNX Runtime Web [21] do, but would mean rebuilding the detect-crop-track pipeline MediaPipe provides), a smaller input (the model sees 192 to 224 px crops [22], the app captures 1280x720), or the lite model [23].

**Scheduling (stages 5 and 6).** Measured at about 0.3 ms, the TypeScript is not a cost. The main thread is: inference blocks it (§1), and every main-thread task competes with the tick [24]. The fix is structural, a worker, not linguistic. Figma's well-known WebAssembly speed-up was load time, not per-frame glue [25].

**Audio (stages 7 to 9).** Oscillators and gains already render on the audio thread; a main-thread parameter change lands on the next 128-frame render quantum (2.9 ms at 44.1 kHz) [7]. `baseLatency` and `outputLatency` are the browser's and the OS's buffers [7][8][26]. An AudioWorklet is a jitter and robustness fix (it runs on the real-time thread and is immune to main-thread stalls) and a place to put sample-accurate interpolation or prediction, not a latency cut for voices built from native nodes [9][27]. A `SharedArrayBuffer` ring buffer to a worklet needs cross-origin isolation [28], which the jsDelivr-hosted MediaPipe files would have to accommodate. Faust, C++ or Rust compiled to WebAssembly inside a worklet is how serious web DSP is written [29][30], and for a few oscillators it makes no audible difference.

## 3. What browser real-time software actually uses

| Product | Stack, from its authors | Lesson |
|---|---|---|
| Google Meet background blur (2020) | MediaPipe compiled to WASM, XNNPACK on WASM SIMD, float16 TFLite model, WebGL2 rendering; 8.3 ms inference at 256x144 on a 2018 MacBook Pro [31] | The same stack as thoremin's hand path; real time came from a small input and the GPU, not a language change |
| MediaPipe on the web (2020) | Emscripten C++, WebGL calculators, TFLite + XNNPACK [4] | `@mediapipe/tasks-vision` is already the C++/WASM answer |
| TF.js hand pose (2021) | Two runtimes for one model: MediaPipe (WASM + GPU) and TF.js WebGL; which is faster depends on the device [23] | Measure on the target machine, as §1 does |
| Zoom web client | Own codecs compiled to WASM, audio through Web Audio and AudioWorklet [32] | Heavy kernels in WASM, audio on the worklet thread, orchestration in JS |
| Figma | C++ renderer compiled to WASM; the headline 3x was load time [25] | WASM's win is heavy code, not glue |
| Web Audio Modules 2.0 | Plugins are `AudioWorkletProcessor`s [33] | The web plugin ecosystem standardises on AudioWorklet |
| Faust (faustwasm) | Faust DSP compiled to WASM as AudioWorklet nodes [29] | The path for non-trivial DSP |
| Elementary Audio | Declarative JS graph over a native-speed engine [30] | Closest in spirit to thoremin's typed DAG |
| Tone.js | Look-ahead scheduling on the audio clock; `lookAhead: 0` for lowest latency [34] | Look-ahead is for events known in advance [35] |
| JackTrip, Jamulus | Low-latency networked music ships native clients; JackTrip's browser path is the higher-latency one [36][37] | Beating the platform's floor means native code or scheduling ahead |

The common pattern: TypeScript orchestrates; heavy kernels are C++, Rust or Faust compiled to WebAssembly (with SIMD) or GPU shaders; audio lives on the AudioWorklet thread; and anything that must beat the platform floor either goes native or schedules ahead. None of these sources moved sub-millisecond glue into WebAssembly for latency.

## 4. What would actually cut the lag, ranked by milliseconds per unit of effort

Audio-path items are proposals, tracked in an issue, not changes made here (this work does not touch audio scheduling). Effort: S an hour or two, M a day or two, L a week or more.

| # | Change | Saves (measured basis) | Effort |
|---|---|---|---|
| 1 | Shorten the pitch glide, or replace it with a linear ramp over one frame period (`linearRampToValueAtTime`) | 21 → about 7 ms to half-way with a 10 ms constant; 69 → 23 ms to 90 % (stage 9) | S |
| 2 | Warn when `outputLatency` exceeds about 40 ms (Bluetooth) | up to ~150 ms when it applies [13] | S |
| 3 | Replace the output compressor with a zero-look-ahead limiter (a soft-clip `WaveShaperNode`, or a limiter in an AudioWorklet) | 6 ms (stage 8) | S to M |
| 4 | Request `frameRate: {ideal: 60}` and check what the camera grants | ~8 ms of mean frame wait (stage 1); more in dim light [15] | S |
| 5 | Capture at 640x480 instead of 1280x720; try the lite hand model | unmeasured; both reduce stages 3 and 4 [22][23] | S |
| 6 | Move inference into a dedicated worker (`MediaStreamTrackProcessor`, `ImageBitmap` fallback [16][38]) | ~0 ms of mean latency; removes the 21 ms main-thread block and the tick stutter (§1) | M |
| 7 | `latencyHint: 0` where the browser grants it | ~9 ms here (§1) | S, but test for glitches |
| 8 | Anticipate: evaluate the hand trajectory at the audio output time, schedule onsets on the audio clock | the only lever on stages 1 to 3; see `subframe-impact-prediction.md` and the `ictus` work | L |
| 9 | Rewrite the DAG or mapping in Rust/WASM | at most 0.3 ms (stage 6). Not recommended | L |

Items 1 and 3 together take about 20 ms off the time to reach half of a new pitch, and about 50 ms off the time to reach 90 %, without touching the camera; item 2 prevents the one case (Bluetooth) that would dwarf everything else. Everything below the camera pipeline can only be removed by producing the sound before the event is observed, which is `intent-and-subframe-timing.md` §5.2's argument, now with numbers under it.

## 5. How to measure on your own machine

### 5.1 The probe, with your webcam

1. Open the app with `?probe=latency` (for example `https://apps.thorwhalen.com/thoremin/?probe=latency`, or `http://localhost:3000/thoremin/?probe=latency` under `npm run dev`). A small panel appears at the bottom right.
2. Tap to play, and play for 20 seconds or more with a hand in view. Press **Reset** after the first few seconds so the model's warm-up is not counted.
3. Read the panel, or press **Copy JSON** and paste it into #146. `captureToDelivery` is the first number a real camera changes; `deliveryToTick` is inference; `scheduleToSpeaker` is your audio device.
4. Repeat with wired headphones and with Bluetooth ones: `scheduleToSpeaker` should move, nothing else.

### 5.2 The strike test: glass to air, with a microphone

The only way to see stages 1 and 2 (and the DAC after stage 7) is to listen. The strike test does that without any calibration, because the microphone hears both the event and the app's answer, and its own delay cancels (`src/latency/onsets.ts`).

1. Under `?probe=latency`, tap to play, press **M** to mute the instrument (its own sound would otherwise be in the recording; the test's beep bypasses the mute), then press **Strike test: start** and allow the microphone. Use the laptop speakers or a speaker near the microphone, not headphones (the microphone must hear the answer).
2. Keep one hand in view, flat, a hand's height above a table. Slap the table 20 or more times, about a second apart. On each slap the app plays a short high beep the moment the camera shows your hand has stopped.
3. Press **Strike test: stop**. The panel prints the latency (mean ± jitter) from slap to beep, and how many slaps it paired. Copy the JSON into #146.

This number is the reactive onset latency of the whole instrument, glass to air, including the one frame a reactive detector needs to see that the hand has stopped. It is the baseline the impact predictor (`src/ictus/impact.ts`) is meant to beat. The beep bypasses the synth's bus, so add stage 8's 6 ms for a synth voice's own path. The copied JSON carries no device identifiers or local paths, so it is safe to paste into a public issue.

### 5.3 The script

```bash
npm run build && npm run smoke:setup
node smoke/latency/measure.mjs --headed --video ~/.local/share/thoremin/latency/hands.y4m --seconds 20 --out report.json
```

It serves the built bundle, drives `?probe=latency` in Chromium (muted, unless `--audible`), times the hand model on both delegates, reads every `latencyHint`, and measures the compressor and the glide offline. The camera clip is data and stays out of the repository; the script's header shows how to make one with `ffmpeg`. Without `--video` the source is `synthetic-hands` and only the tick and audio stages are measured.

## 6. Caveats

- **One machine, one browser.** An M1 Max is fast; a mid-range Windows laptop will have slower inference and a different audio stack [8][39]. The script and the probe exist so the table can be re-taken anywhere.
- **The fake camera is not a camera.** Stage 3's 4.4 ms is Chromium's own path from a file-backed device; a real camera's `captureTime` may be stamped at exposure or at delivery, which the sources do not settle (unsourced). The strike test is the check.
- **The tick measures JavaScript, not pixels.** Stage 6 covers the overlay's canvas calls; the GPU raster and compositing that follow run off the main thread and are not in it.
- **Samples come from 20 s runs.** Enough for means and standard deviations to a fraction of a millisecond; tails (p95, max) will move between runs.

## REFERENCES

1. Transitive Robotics. [WebRTC Latency: A Breakdown](https://transitiverobotics.com/blog/webrtc-latency-breakdown/). 6 May 2026.
2. Bachhuber C, Steinbach E. [A System for High Precision Glass-to-Glass Delay Measurements in Video Communication](https://arxiv.org/pdf/1510.01134). IEEE ICIP 2016. doi:10.1109/ICIP.2016.7532735.
3. Tsao P. [Webcam-Latency-Measurement](https://github.com/perrytsao/Webcam-Latency-Measurement). GitHub; the README's example run measures 108 ms for one USB webcam.
4. Hays M, Mullen T. [MediaPipe on the Web](https://developers.googleblog.com/en/mediapipe-on-the-web/). Google Developers Blog, 28 Jan 2020.
5. Bachhuber C, Steinbach E, Freundl M, Reisslein M. [On the Minimization of Glass-to-Glass and Glass-to-Algorithm Delay in Video Communication](https://faculty.engineering.asu.edu/mre/wp-content/uploads/sites/31/2020/02/DelVidComm.pdf). IEEE Transactions on Multimedia 20(1):238-252, 2018. doi:10.1109/TMM.2017.2726189.
6. The Chromium Projects. [Video Capture (design document)](https://www.chromium.org/developers/design-documents/video-capture/). Accessed 2026-09-26.
7. W3C Audio WG. [Web Audio API 1.1](https://webaudio.github.io/web-audio-api/). Editor's Draft, 9 Sep 2026.
8. Adenot P. [Web Audio API performance and debugging notes](https://padenot.github.io/web-audio-perf/). Mozilla, circa 2016.
9. Choi H. [Audio worklet design pattern](https://developer.chrome.com/blog/audio-worklet-design-pattern). Chrome for Developers, updated 18 Jun 2018.
10. MDN. [AudioParam: setTargetAtTime()](https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/setTargetAtTime). Accessed 2026-09-26.
11. Wessel D, Wright M. [Problems and Prospects for Intimate Musical Control of Computers](https://opensoundcontrol.stanford.edu/files/p1-wessel-1.pdf). Computer Music Journal 26(3), 2002.
12. blink-dev. [Intent to Ship: AudioContext.outputLatency](https://groups.google.com/a/chromium.org/g/blink-dev/c/dTQniJNVVMY). Chrome M98, 12 Nov 2021.
13. jamieonkeys. [Keeping audio and visuals in sync with the Web Audio API](https://www.jamieonkeys.dev/posts/web-audio-api-output-latency/). Jul 2022.
14. MDN. [MediaTrackConstraints: frameRate](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/frameRate). Accessed 2026-09-26.
15. docam.io. [Webcam Low FPS: Why It Drops and How to Get Smooth 30 or 60 Frames](https://docam.io/knowledge/webcam-low-fps-fix). Updated Jun 2026.
16. MDN. [MediaStreamTrackProcessor](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrackProcessor). Accessed 2026-09-26.
17. Gandluri D, Lively T, Stepanyan I. [Fast, parallel applications with WebAssembly SIMD](https://v8.dev/features/simd). V8 blog, 30 Jan 2020, updated 6 Nov 2022.
18. Jangda A, Powers B, Berger ED, Guha A. [Not So Fast: Analyzing the Performance of WebAssembly vs. Native Code](https://www.usenix.org/conference/atc19/presentation/jangda). USENIX ATC 2019.
19. google-ai-edge/mediapipe. [WebGPU support for Vision Tasks, issue 5826](https://github.com/google-ai-edge/mediapipe/issues/5826). Opened 15 Jan 2025.
20. Google Developers Blog. [LiteRT.js, Google's high performance Web AI Inference](https://developers.googleblog.com/en/litertjs-googles-high-performance-web-ai-inference/). 9 Jul 2026.
21. Microsoft Open Source Blog. [ONNX Runtime Web unleashes generative AI in the browser using WebGPU](https://opensource.microsoft.com/blog/2024/02/29/onnx-runtime-web-unleashes-generative-ai-in-the-browser-using-webgpu/). 29 Feb 2024.
22. Google AI Edge. [Hand landmarks detection guide (HandLandmarker)](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker). Accessed 2026-09-26.
23. TensorFlow Blog. [3D Hand Pose with MediaPipe and TensorFlow.js](https://blog.tensorflow.org/2021/11/3D-handpose.html). 15 Nov 2021.
24. MDN. [PerformanceLongTaskTiming](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming). Accessed 2026-09-26.
25. Wallace E. [WebAssembly cut Figma's load time by 3x](https://www.figma.com/blog/webassembly-cut-figmas-load-time-by-3x/). Figma blog, 8 Jun 2017.
26. MDN. [AudioContext: outputLatency](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency). Accessed 2026-09-26.
27. Choi H. [Enter Audio Worklet](https://developer.chrome.com/blog/audio-worklet). Chrome for Developers, 14 Dec 2017.
28. Kitamura E. [A guide to enable cross-origin isolation](https://web.dev/articles/cross-origin-isolation-guide). web.dev, updated 9 Feb 2021.
29. GRAME. [faustwasm](https://github.com/grame-cncm/faustwasm). GitHub, accessed 2026-09-26.
30. Elementary Audio. [elemaudio/elementary](https://github.com/elemaudio/elementary). GitHub, accessed 2026-09-26.
31. Google Research. [Background Features in Google Meet, Powered by Web ML](https://research.google/blog/background-features-in-google-meet-powered-by-web-ml/). 30 Oct 2020.
32. Hancke P. [How Zoom's web client avoids using WebRTC](https://webrtchacks.com/zoom-avoids-using-webrtc/). webrtcHacks, 2018, updated 8 Sep 2019.
33. Web Audio Modules. [WAM 2.0 API](https://github.com/webaudiomodules/api). GitHub, accessed 2026-09-26.
34. Tone.js. [Context (lookAhead, latencyHint, updateInterval)](https://tonejs.github.io/docs/15.0.4/classes/Context.html). v15.0.4 docs.
35. Wilson C. [A tale of two clocks](https://web.dev/articles/audio-scheduling). web.dev, 9 Jan 2013.
36. JackTrip Labs. [JackTrip's Support for Jamulus](https://support.jacktrip.com/support-for-jamulus). Accessed 2026-09-26.
37. Wikipedia. [Jamulus](https://en.wikipedia.org/wiki/Jamulus). Accessed 2026-09-26.
38. Google AI Edge. [mediapipe-samples-web: hand-landmarker.worker.ts](https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/workers/hand-landmarker.worker.ts). GitHub, accessed 2026-09-26.
39. Gil Panal JM, Richard G, David A. [A Maximum Length Sequence-Based Method for Robust Round-Trip Latency Estimation in online Digital Audio Workstations](https://github.com/gilpanal/weblatencytest). Web Audio Conference 2025. doi:10.5281/zenodo.17642262.
