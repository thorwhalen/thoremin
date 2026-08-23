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
 * `engine_loop.test.ts`, and the re-wire mechanism in `engine_lifecycle.test.ts`.
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

  it('drives the engine through runEngineLoop', () => {
    expect(code(useEngine)).toMatch(/runEngineLoop\(/);
  });

  it('feeds the loop the three per-frame reporters', () => {
    // A reporter dropped from this list stops updating its panel at frame rate
    // while nothing fails — the face readout, the MIDI status, or (worst) the
    // gesture dispatcher, which would stop dispatching commands entirely.
    expect(code(useEngine)).toMatch(/runEngineLoop\(\s*engine,\s*\[reportFace,\s*reportMidi,\s*reportGesture\]/);
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
