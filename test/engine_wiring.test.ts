/**
 * Structural guard on the React↔DAG bridge's wiring (`src/app/useEngine.ts`).
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
const useEngine = read('src/app/useEngine.ts');
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
    // nothing fails — the face readout, the MIDI status, or (worst) the gesture
    // dispatcher, which would stop dispatching commands entirely — or (#188) the
    // generative readout, which would show "off" while a paid stream plays.
    expect(code(useEngine)).toMatch(/sinks:\s*\[[^\]]*reportFace[^\]]*reportMidi[^\]]*reportGesture[^\]]*reportGenerative[^\]]*\]/);
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
    expect(c).toMatch(/sinks:\s*\[\s*toMs\(reportFace\),\s*toMs\(reportMidi\),\s*toMs\(reportGesture\),\s*toMs\(reportGenerative\)\s*\]/);
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
  });

  it('useEngine builds the graph WITH the selection and the registry', () => {
    const c = code(useEngine);
    // `defaultGraph()` with no arguments is the bug this guards: it silently
    // ignores every selection and validates nothing.
    expect(c).not.toMatch(/defaultGraph\(\s*\)/);
    expect(c).toMatch(/new Engine\(\s*defaultGraph\(slotsRef\.current,\s*registry\)/);
  });

  it('re-wires the LIVE engine on a selection change instead of rebuilding it', () => {
    // Rebuilding would re-acquire the camera and reload both MediaPipe models to
    // change one node; applyGraph keeps every unchanged node (#51).
    const c = code(useEngine);
    expect(c).toMatch(/\.applyGraph\(defaultGraph\(slotsRef\.current,\s*registry\)/);
    // ...and it is actually TRIGGERED by a selection change. An applyGraph call
    // sitting in an effect that never re-runs is the #137 shape exactly: present,
    // correct, and never reached.
    expect(c).toMatch(/\}, \[\s*slotsKey\s*\]\)/);
    // The selection must NOT be a dependency of the build effect, or a swap would
    // tear the camera down and reload both models.
    expect(c).not.toMatch(/\[source\.kind[^\]]*slotsKey/);
  });
});
