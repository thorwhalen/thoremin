/**
 * The drum-out and pluck-out nodes take a whole tick's batch of events (#391 item 4):
 * one malformed event, such as a non-finite optional field, must not silence the rest of
 * its tick. Each node parses every event on its own, skips and counts a bad one, and
 * logs only the first (#393 item 8; `@thoremin/ext-air/lib/event_batch`). The
 * well-formed batches are checked too, so a fix that skips per event is held to playing
 * every good one exactly once.
 */
import { describe, expect, it } from 'vitest';
import { drumOutNode, type DrumSink } from '@thoremin/ext-air/nodes/drum_out';
import type { DrumHit } from '@thoremin/ext-air/nodes/air_drum';
import { pluckOutNode } from '@thoremin/ext-air/nodes/pluck_out';
import type { NoteEvent } from '@thoremin/ext-air/nodes/air_bass';
import { createEventBatchParser } from '@thoremin/ext-air/lib/event_batch';
import { DrumHitSchema } from '@thoremin/ext-air/nodes/air_drum';
import { knownOutputStage } from '../helpers/timing';

const ac = { currentTime: 10, state: 'running' } as unknown as AudioContext;

const hit = (t: number, over: Partial<DrumHit> = {}): DrumHit => ({ t, impactT: t, velocity: 0.7, hand: 'right', sound: 'kick', predicted: true, onTime: 'yes', lead: 0.05, lateBy: 0, pull: 0, ...over });
const note = (t: number, midi: number, over: Partial<NoteEvent> = {}): NoteEvent => ({ t, midi, velocity: 0.8, predicted: true, lead: 0.05, ...over });

function drumHarness(log: (m: string) => void = () => {}) {
  const played: string[] = [];
  const sink: DrumSink = { play: (sound) => void played.push(sound), close: () => {} };
  const h = drumOutNode.make({});
  const tick = (hits: unknown[]) =>
    h.process({ hits }, { tick: 1, time: 100, dt: 1 / 60, log, resources: { audioContext: ac, masterGain: {}, createDrumSink: () => sink, timeScale: 1, ...knownOutputStage(0.03) } });
  return { played, tick };
}

function pluckHarness() {
  const played: number[] = [];
  const h = pluckOutNode.make(pluckOutNode.params.parse({}));
  const tick = (notes: unknown[]) =>
    h.process({ notes }, {
      log: () => {},
      tick: 1,
      time: 100,
      dt: 1 / 30,
      resources: { audioContext: ac, masterGain: {}, createPluckSink: () => ({ play: (midi: number) => void played.push(midi), close: () => {} }), timeScale: 1, ...knownOutputStage(0.03) },
    } as never);
  return { played, tick };
}

describe('drum-out: a batch of hits', () => {
  it('plays every well-formed hit once', () => {
    const { played, tick } = drumHarness();
    tick([hit(100.01), hit(100.02, { sound: 'snare', x: 0.4, y: 0.5, strength: 0.9, radial: 0.2 }), hit(100.03, { sound: 'hihat' })]);
    expect(played).toEqual(['kick', 'snare', 'hihat']);
  });

  const bad: [string, Partial<DrumHit>][] = [
    ['x = NaN', { x: Number.NaN }],
    ['y = Infinity', { y: Number.POSITIVE_INFINITY }],
    ['strength = NaN', { strength: Number.NaN }],
    ['radial = -Infinity', { radial: Number.NEGATIVE_INFINITY }],
  ];
  for (const [label, over] of bad) {
    it(`one hit with ${label} still lets the others sound (#393 item 8)`, () => {
      const { played, tick } = drumHarness();
      tick([hit(100.01), hit(100.02, { sound: 'snare', ...over }), hit(100.03, { sound: 'hihat' })]);
      expect(played).toEqual(['kick', 'hihat']);
    });
  }
});

describe('pluck-out: a batch of notes', () => {
  it('plays every well-formed note once', () => {
    const { played, tick } = pluckHarness();
    tick([note(100.01, 40), note(100.02, 43, { voice: 1 }), note(100.03, 47)]);
    expect(played).toEqual([40, 43, 47]);
  });

  const bad: [string, Partial<NoteEvent>][] = [
    ['lead = NaN', { lead: Number.NaN }],
    ['velocity = Infinity', { velocity: Number.POSITIVE_INFINITY }],
    ['t = NaN', { t: Number.NaN }],
  ];
  for (const [label, over] of bad) {
    it(`one note with ${label} still lets the others sound (#393 item 8)`, () => {
      const { played, tick } = pluckHarness();
      tick([note(100.01, 40), note(100.02, 43, over), note(100.03, 47)]);
      expect(played).toEqual([40, 47]);
    });
  }
});

describe('the per-event batch parser', () => {
  it('keeps the good events in order, counts every bad one, and logs only the first', () => {
    const lines: string[] = [];
    const parser = createEventBatchParser(DrumHitSchema, 'drum-out');
    const good = parser.parse([hit(1), hit(2, { x: Number.NaN }), hit(3, { sound: 'snare' })], (m) => void lines.push(m));
    expect(good.map((h) => h.t)).toEqual([1, 3]);
    parser.parse([{ t: 'soon' }, hit(4, { strength: Number.NaN })], (m) => void lines.push(m));
    expect(parser.skipped()).toBe(3);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[drum-out\] skipped a malformed event \(x: /);
  });

  it('drum-out logs a run of malformed hits once, through the context log', () => {
    const lines: string[] = [];
    const { played, tick } = drumHarness((m) => void lines.push(m));
    tick([hit(100.01, { x: Number.NaN })]);
    tick([hit(100.02, { y: Number.NaN }), hit(100.03)]);
    expect(played).toEqual(['kick']);
    expect(lines).toHaveLength(1);
  });
});
