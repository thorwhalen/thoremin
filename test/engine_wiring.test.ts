/**
 * Structural guard on the React↔DAG bridge's wiring (`src/app/engine/useEngine.ts`).
 *
 * This is the #137 lesson applied to the engine host: MIDI out shipped with a
 * dial, a node and no edge — every unit test passed and the feature did nothing,
 * because the thing that was broken was a *connection*, not a computation. Two
 * connections here are exactly that shape, and neither has a behavioural test
 * that could catch them coming undone:
 *
 *  1. **The Clock reaches the live loop.** If `useEngine` goes back to calling
 *     `requestAnimationFrame` itself, `RealtimeClock` silently becomes dead code
 *     again while every clock test stays green.
 *  2. **The slot selection reaches the graph.** `?slot.<name>=…` → `main.tsx` →
 *     `App` → `useThoreminEngine` → `defaultGraph(selection, registry)`. Any one
 *     of those links dropping leaves a seam that parses, validates, is unit
 *     tested — and is never consulted.
 *
 * It reads source rather than rendering because mounting the hook boots the
 * webcam and the ML models, which no unit test should do (same rationale as
 * `app_shell.test.ts`). The loop's actual behaviour is covered headlessly in
 * `applier.test.ts`, and the re-wire mechanism in `engine_lifecycle.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const useEngine = read('src/app/engine/useEngine.ts');
// The live graph and its re-wire moved out of the hook (#392): `useEngine` binds it to its refs.
const liveApply = read('src/app/engine/liveApply.ts');
const app = read('src/app/App.tsx');
const main = read('src/main.tsx');

/** Strip block and line comments, so a mention in prose never satisfies a check. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('useEngine drives the live loop from the Clock seam', () => {
  it('does not hand-roll a requestAnimationFrame loop', () => {
    expect(code(useEngine)).not.toMatch(/requestAnimationFrame|cancelAnimationFrame/);
  });

  it('drives the engine through an Applier on a RealtimeClock', () => {
    // #101 M-D: the live half. `runEngineLoop` was the intermediate step and is gone —
    // if this reverts to a bespoke loop, the Applier's guards (the per-sink catch, the
    // tap release on dispose) silently stop applying to the code players actually run.
    const c = code(useEngine);
    expect(c).toMatch(/new Applier\(/);
    expect(c).toMatch(/clock:\s*new RealtimeClock\(/);
  });

  it('feeds the Applier the four per-frame bridges as sinks', () => {
    // A bridge dropped from this list stops updating its panel at frame rate while
    // nothing fails — the face readout, or (worst) the gesture dispatcher, which would
    // stop dispatching commands entirely — or (#188) the generative readout, which would
    // show "off" while a paid stream plays. (The MIDI and generative statuses are their slices'
    // status hooks since #600 S13 / S14, so they ride `extensionSinks`.)
    expect(code(useEngine)).toMatch(/sinks:\s*\[[^\]]*reportFace[^\]]*reportGesture[^\]]*extensionSinks[^\]]*\]/);
  });

  it('converts the clock time to MILLISECONDS for every bridge', () => {
    // A `Clock` reports SECONDS; the bridges take milliseconds — `reportGesture` feeds
    // `gestureDispatcher.tick`, whose dwell/hold/cooldown are in ms. Passing seconds
    // through turns a 400 ms hold into 400 s and the dispatcher silently stops firing,
    // with every unit test still green. This is the same 1000x slip #164 fixed for the
    // trainer's sampler, and the reason it is guarded structurally is that the hook
    // cannot be mounted headlessly to observe it.
    const c = code(useEngine);
    expect(c).toMatch(/\* 1000/);
    // Each bridge goes through the converter rather than being passed raw.
    // (`...latencySinks` is the #227 probe's tick-end stamp: empty unless ?probe=latency.)
    // (`reportTiming` is the timing resource's readout for the camera status line, step 0 of the timing plan.)
    // (`reportCategory` feeds the #160 category dispatcher, whose hold is in ms like the gestures'.)
    // (The song's reporter left with its slice, #600 S15: it is one of the extension status hooks.)
    expect(c).toMatch(/sinks:\s*\[\s*(?:\.\.\.latencySinks,\s*)?toMs\(reportFace\),\s*toMs\(reportGesture\),\s*toMs\(reportCategory\),\s*toMs\(reportTiming\),\s*toMs\(extensionSinks\)\s*\]/);
    // The extensions' sinks (the air instruments' readouts and shape taps, PR 5a) are built
    // from the manifests and converted the same way, in one place: one sink over every status
    // hook in hand, so a lazy extension that loads mid-session gets its readout.
    expect(c).toMatch(/const extensionSinks = makeExtensionSinks\(engine, \(\) => resources\)/);
  });

  it('publishes the read-only debug handle when the engine is ready, and removes it on teardown (#209)', () => {
    // The browser smoke harness observes the live loop through `window.thoremin`.
    // If this call is dropped the harness goes red for a reason nobody can see in
    // the app; if the uninstall is dropped a torn-down engine stays reachable.
    const c = code(useEngine);
    expect(c).toMatch(/uninstallDebug = installDebugHandle\(engine, resources\)/);
    expect(c).toMatch(/uninstallDebug\(\)/);
  });

  it('loads the latency probe only under ?probe=latency, closes ticks in the first sink, and uninstalls it (#227)', () => {
    // The probe is an engine tap plus a window handle and a DOM panel; a dropped
    // uninstall would leave a tap on a torn-down engine and a stale panel on screen.
    const c = code(useEngine);
    expect(c).toMatch(/if \(latencyProbeRequested\(\)\) \{\s*const \{ installLatencyProbe \} = await import\('\.\/latencyProbe'\)/);
    expect(c).toMatch(/uninstallLatency = probe\.uninstall/);
    expect(c).toMatch(/uninstallLatency\(\)/);
    // The tick-end stamp must be the FIRST sink, or it would time the bridges too.
    expect(c).toMatch(/const latencySinks = latencyTickEnd \? \[latencyTickEnd\] : \[\]/);
    expect(c).toMatch(/sinks: \[\.\.\.latencySinks, toMs\(reportFace\)/);
  });

  it('installs the timing resource and its tap on EVERY run, and disposes it (step 0 of the timing plan)', () => {
    // The resource is what makes `outputStage` a measured number instead of the flagged
    // prior: drop the install and every instrument silently reads the prior while the
    // whole suite stays green (the replays pass their own); drop the tap and the
    // reading never sees a frame. Neither is behind a flag, unlike the probe.
    const c = code(useEngine);
    expect(c).toMatch(/resources\[TIMING_RESOURCE_KEY\] = \(\) => timing!\.reading\(\)/);
    expect(c).toMatch(/engine\.addTap\(timing\.tap\)/);
    expect(c).toMatch(/timing\?\.dispose\(\)/);
  });

  it('releases the Applier on unmount, so its taps do not outlive the run', () => {
    // The engine is caller-owned and survives StrictMode remounts; a tap the Applier
    // attached and never detached would keep receiving values from every later run.
    expect(code(useEngine)).toMatch(/applierRef\.current\?\.dispose\(\)/);
  });
});

describe('the slot selection reaches the graph', () => {
  it('main.tsx parses it from the URL and passes it to the app', () => {
    const m = code(main);
    expect(m).toMatch(/parseSlotSelection\(window\.location\.search\)/);
    expect(m).toMatch(/<DagApp[^>]*\bslots=\{slots\}/);
  });

  it('App forwards it to the engine hook', () => {
    expect(code(app)).toMatch(/useThoreminEngine\(\s*source,\s*slots\s*\)/);
    // ...the URL's selection, with the source slot taken by a loaded replay (the Replay tool).
    expect(code(app)).toMatch(/slots: urlSlots/);
    expect(code(app)).toMatch(/replaying \? \{ \.\.\.urlSlots, source: 'replay-hands' \} : urlSlots/);
  });

  it('useEngine builds the graph WITH the selection and the registry', () => {
    const c = code(useEngine);
    // `defaultGraph()` with no arguments is the bug this guards: it silently
    // ignores every selection and validates nothing.
    expect(c).not.toMatch(/defaultGraph\(\s*\)/);
    expect(c).not.toMatch(/liveGraph\(\s*\)/);
    // (Composed through the lazy-extension loader: a restored instrument's lazy nodes load first.)
    expect(c).toMatch(/const live = await composeLoaded\(lazyDeps\(\(\) => slotsRef\.current,\s*registry,\s*\(\) => !disposed\)\)/);
    expect(code(liveApply)).toMatch(/compose: \(without\) => liveGraph\(selection\(\),\s*registry,\s*without\)/);
    expect(c).toMatch(/new Engine\(\s*live\.spec,\s*registry/);
  });

  it('re-wires the LIVE engine on a selection change instead of rebuilding it', () => {
    // Rebuilding would re-acquire the camera and reload both MediaPipe models to
    // change one node; applyGraph keeps every unchanged node (#51).
    const c = code(useEngine);
    // One helper does the re-wire: it composes the live graph for the CURRENT slots and
    // applies it; both effects call it, and so does the post-init reconcile.
    // (Through one lazy applier per engine, `src/app/engine/lazyApply.ts`: what the graph names but
    // is not loaded yet loads first, and only the latest request commits.)
    // (`src/app/engine/liveApply.ts` since #392; the hook's `rewire` binds it to the hook's refs.)
    expect(code(liveApply)).toMatch(/function applyLive\([^)]*\)[^{]*\{[^]*?makeLazyApplier<Composed>\(\{\s*\.\.\.lazyDeps\(selection,\s*registry,\s*\(\) => live\(\) === engine\),\s*\.\.\.\(compose \? \{ compose \} : \{\}\),\s*commit: \(next\) => \{\s*void engine\s*\.applyGraph\(next\.spec,\s*registry\)/);
    expect(c).toMatch(/const rewire = \(engine: Engine, registry: NodeRegistry\) =>\s*applyLive\(engine, \{ selection: \(\) => slotsRef\.current, registry, live: \(\) => engineRef\.current/);
    expect(c).toMatch(/rewire\(engine, registry\);\s*\}, \[\s*slotsKey\s*\]\)/);
    // ...and on a change of the branch SET (an instrument switch, a dial that adds a
    // capability, a tool's feature demand): the instruments-as-graphs ADR, PR 3.
    expect(c).toMatch(/rewire\(engine, registry\);\s*\}, \[\s*branchKey\s*\]\)/);
    // A change during the model load (no engine yet) is reconciled once after init, for
    // the branch set as for the slots.
    expect(c).toMatch(/currentBranchKey\(\) !== builtBranchKey/);
    // The element set is written when the apply COMMITS, never at plan time.
    expect(code(liveApply)).toMatch(/\.then\(\(change\) => \{[^}]*setGraphElements\(next\.elements\)/);
    // ...and it is actually TRIGGERED by a selection change. An applyGraph call
    // sitting in an effect that never re-runs is the #137 shape exactly: present,
    // correct, and never reached.
    expect(c).toMatch(/\}, \[\s*slotsKey\s*\]\)/);
    // The selection must NOT be a dependency of the build effect, or a swap would
    // tear the camera down and reload both models.
    expect(c).not.toMatch(/\[source\.kind[^\]]*slotsKey/);
  });
});
