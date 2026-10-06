// @vitest-environment jsdom
/**
 * The pattern trainer (#269) in the air drum's settings, on a fake clock and a fake
 * click player: Start schedules a count-in bar and the first pass's beats; the cursor
 * runs from the pattern's start; the hits the tap collected during the take are fitted
 * when it ends and the model saved; a take with no hits says so; Stop silences the
 * click. Plus the hit tap and the click plan on their own.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { createInMemoryProvider } from '@zodal/store';
import { PatternTrainer, takeClicks } from '@thoremin/ext-air/app/PatternTrainer';
import { clearHits, hitsSince, makeHitsTap, pushHits } from '@thoremin/ext-air/app/hitsTap';
import { loadPatternModel, usePatternModelStore, type PatternModelRecord } from '@thoremin/ext-air/app/patternModels';
import { setClickPlayer } from '@thoremin/sdk-ui/enroll/click';
import { patternById } from '@thoremin/ext-air/lib/drum_patterns';
import { useControls } from '@/app/store';
import type { Click } from '@thoremin/sdk/enroll';
import type { DrumHit } from '@thoremin/ext-air/nodes/air_drum';
import { AIR } from '../helpers/extensions';

const ROCK = patternById('rock')!;
let clock = 10_000;
const now = () => clock;
let played: Click[][] = [];
let stops = 0;

beforeEach(() => {
  clock = 10_000;
  played = [];
  stops = 0;
  clearHits();
  usePatternModelStore(createInMemoryProvider<PatternModelRecord>([], { searchFields: ['name'] }));
  setClickPlayer({ play: (c) => void played.push([...c]), stop: () => void (stops += 1) });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  setClickPlayer(null);
  usePatternModelStore(null);
});

/** Advance the fake clock and the trainer's timer together. */
function advance(ms: number) {
  const step = 40;
  for (let t = 0; t < ms; t += step) {
    clock += step;
    act(() => vi.advanceTimersByTime(step));
  }
}

const settle = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
});

/** A perfect rock-beat take from `startS` (engine seconds), `passes` times, as DrumHits. */
function perfectTake(startS: number, passes: number): DrumHit[] {
  const period = 60 / ROCK.bpm;
  const pads = { kick: 'p6', snare: 'p1', hihat: 'p2' } as const;
  const out: DrumHit[] = [];
  for (let p = 0; p < passes; p++) {
    for (const e of ROCK.events) {
      out.push({ t: startS + (p * ROCK.lengthBeats + e.beat) * period, velocity: 0.7, hand: 'right', sound: e.sound, predicted: true, lead: 0.05, pull: 0, pad: pads[e.drum as keyof typeof pads], x: 0.5, y: 0.7 });
    }
  }
  return out;
}

describe.runIf(AIR)('the click plan', () => {
  it('counts a bar in, then clicks the first pass only unless asked for all', () => {
    const one = takeClicks(ROCK, 4, 1, 1000);
    const beatMs = 60000 / ROCK.bpm;
    expect(one.clicks.filter((c) => c.kind === 'count')).toHaveLength(4);
    expect(one.clicks.filter((c) => c.kind === 'beat')).toHaveLength(4);
    expect(one.patternStartMs).toBeCloseTo(1000 + 4 * beatMs, 6);
    expect(one.endMs).toBeCloseTo(one.patternStartMs + 16 * beatMs, 6);
    expect(one.clicks[0]).toMatchObject({ t: 1000, kind: 'count', accent: true });
    expect(one.clicks[4]).toMatchObject({ t: one.patternStartMs, kind: 'beat', accent: true });
    const all = takeClicks(ROCK, 4, 4, 1000);
    expect(all.clicks.filter((c) => c.kind === 'beat')).toHaveLength(16);
  });
});

describe.runIf(AIR)('the hit tap', () => {
  it('appends each new hit list once and answers since a time, in order', () => {
    let out: DrumHit[] = [];
    const tap = makeHitsTap({ getOutput: () => out }, 'airDrum');
    tap();
    const a = perfectTake(1, 1).slice(0, 3); // kick@0, hihat@0, hihat@0.5
    out = [a[2], a[0], a[1]];
    tap();
    tap(); // the same list again: not new hits
    out = [];
    tap();
    expect(hitsSince(0).map((h) => h.t)).toEqual([a[0].t, a[1].t, a[2].t]);
    expect(hitsSince(a[2].t)).toHaveLength(1);
    clearHits();
    expect(hitsSince(0)).toHaveLength(0);
  });
});

describe.runIf(AIR)('the pattern trainer', () => {
  it('runs a take: count-in, cursor from the pattern start, then fits the hits and saves the model', async () => {
    render(<PatternTrainer enabled now={now} />);
    await settle();
    expect(screen.getByLabelText('Pattern')).toBeTruthy();
    // A pattern in play is switched off for the take: the take must be the strokes.
    useControls.getState().setTransient('airDrumPattern', { pattern: ROCK, model: { v: 1, patternId: 'rock', bpm: 96, statedBpm: 96, passes: 1, feel: {}, positions: {}, recall: 1, precision: 1, takenAt: 0 } });
    fireEvent.click(screen.getByText('Start'));
    expect(useControls.getState().airDrumPattern).toBeNull();
    expect(played).toHaveLength(1);
    const plan = takeClicks(ROCK, 4, 1, clock + 200);
    expect(played[0].map((c) => c.t)).toEqual(plan.clicks.map((c) => c.t));
    expect(screen.getByTestId('pattern-trainer').getAttribute('data-phase')).toBe('count-in');
    expect(screen.queryByTestId('pattern-cursor')).toBeNull();
    // Through the count-in: the cursor appears at the pattern's start.
    advance(plan.patternStartMs - clock + 80);
    expect(screen.getByTestId('pattern-trainer').getAttribute('data-phase')).toBe('playing');
    expect(screen.getByTestId('pattern-cursor')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/pass 1 of 4/);
    // The player plays a perfect take on the engine clock (seconds), the tap sees it.
    pushHits(perfectTake(plan.patternStartMs / 1000, 4));
    advance(plan.endMs - clock + 600);
    await settle();
    await settle();
    expect(screen.getByTestId('pattern-trainer').getAttribute('data-phase')).toBe('done');
    expect(screen.getByTestId('pattern-model').textContent).toMatch(/Your tempo 96 bpm/);
    expect(screen.getByTestId('pattern-model').textContent).toMatch(/100% of the hits found/);
    expect(screen.getByTestId('pattern-model').textContent).toMatch(/kick: p6/);
    const saved = await loadPatternModel('rock');
    expect(saved?.bpm).toBeCloseTo(96, 0);
    expect(saved?.positions.snare.pad).toBe('p1');
  });

  it('says so when nothing matched, and Stop silences the click', async () => {
    render(<PatternTrainer enabled now={now} />);
    await settle();
    fireEvent.click(screen.getByText('Start'));
    const plan = takeClicks(ROCK, 4, 1, clock + 200);
    advance(plan.endMs - clock + 600);
    await settle();
    expect(screen.getByRole('status').textContent).toMatch(/Not enough hits/);
    expect(await loadPatternModel('rock')).toBeNull();
    fireEvent.click(screen.getByText('Start'));
    fireEvent.click(screen.getByText('Stop'));
    expect(stops).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('pattern-trainer').getAttribute('data-phase')).toBe('idle');
  });

  it('is blocked while the instrument is off', async () => {
    render(<PatternTrainer enabled={false} now={now} />);
    await settle();
    expect((screen.getByText('Start') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Turn the air drum on/)).toBeTruthy();
  });
});
