/**
 * Training routes (#263, #269): a spec's declared route wins when known; else the air
 * branch it composes picks the trainer in its own section; else the Trainer tool. A
 * section route opens the collapsed sections above the trainer and scrolls to it; a
 * tool route opens the tool; a route whose trainer is not on the page says so.
 */
import { describe, expect, it, vi } from 'vitest';
import { TRAINING_ROUTES, goToTraining, routeById, trainingRouteFor } from '@/app/training/routes';
import { TRAINING_ANCHORS } from '@/extensions/air/training';
import { AIR } from './helpers/extensions';

describe('trainingRouteFor', () => {
  it('falls back to the Trainer tool for an instrument no extension trains (core alone too)', () => {
    expect(trainingRouteFor({ branches: ['face-chord'], features: ['face-chord'] }).id).toBe('trainer');
    expect(trainingRouteFor(undefined).id).toBe('trainer');
    expect(TRAINING_ROUTES.at(-1)?.id).toBe('trainer');
  });

  it.runIf(AIR)('derives the route from the composed branches, the flute, guitar and drum before the Trainer', () => {
    expect(trainingRouteFor({ branches: ['air-flute'], features: [] }).id).toBe('sequence:flute');
    expect(trainingRouteFor({ branches: undefined, features: ['air-guitar', 'hands'] }).id).toBe('sequence:guitar');
    expect(trainingRouteFor({ branches: ['air-drum', 'conductor'], features: [] }).id).toBe('patterns:drum');
    expect(trainingRouteFor({ branches: ['face-chord'], features: ['face-chord'] }).id).toBe('trainer');
    expect(trainingRouteFor(undefined).id).toBe('trainer');
    // A flute that also has a drum trains the flute first: the lead instrument.
    expect(trainingRouteFor({ branches: ['air-drum', 'air-flute'], features: [] }).id).toBe('sequence:flute');
  });

  it.runIf(AIR)('honours a declared route it knows, and ignores one it does not', () => {
    expect(trainingRouteFor({ training: { route: 'patterns:drum' }, branches: ['air-flute'], features: [] }).id).toBe('patterns:drum');
    expect(trainingRouteFor({ training: { route: 'no-such' }, branches: ['air-flute'], features: [] }).id).toBe('sequence:flute');
  });

  it('every route has a label, a hint and exactly one destination; every anchor has a route', () => {
    for (const r of TRAINING_ROUTES) {
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.hint.length).toBeGreaterThan(0);
      expect(Boolean(r.section) !== Boolean(r.tool)).toBe(true);
    }
    if (AIR) for (const anchor of Object.values(TRAINING_ANCHORS)) expect(TRAINING_ROUTES.some((r) => r.section?.anchor === anchor)).toBe(true);
    expect(routeById('trainer')?.tool).toBe('trainer');
  });
});

describe('goToTraining', () => {
  it('opens a tool route through the tools store', () => {
    const openTool = vi.fn();
    expect(goToTraining(routeById('trainer')!, { openTool })).toBe(true);
    expect(openTool).toHaveBeenCalledWith('trainer');
  });

  it.runIf(AIR)('opens the sections above a trainer and scrolls to it, or reports it absent', () => {
    const scrolled: unknown[] = [];
    const details = { tagName: 'DETAILS', open: false, parentElement: null as unknown };
    const wrapper = { tagName: 'DIV', parentElement: details };
    const el = { tagName: 'DIV', parentElement: wrapper, scrollIntoView: (o: unknown) => scrolled.push(o) };
    const doc = { getElementById: (id: string) => (id === TRAINING_ANCHORS.fluteSequence ? el : null) } as unknown as Pick<Document, 'getElementById'>;
    const openTool = vi.fn();
    expect(goToTraining(routeById('sequence:flute')!, { openTool, doc })).toBe(true);
    expect(details.open).toBe(true);
    expect(scrolled).toHaveLength(1);
    expect(openTool).not.toHaveBeenCalled();
    expect(goToTraining(routeById('patterns:drum')!, { openTool, doc })).toBe(false);
  });
});
