/**
 * The `air-guitar` node (#249) on synthetic performances: the chord hand's shape is
 * classified against the enrolled vocabulary, each strum of the other hand sounds that
 * chord's guitar voicing (most predicted ahead of the strum), a chord change is followed,
 * and nothing sounds with the dial off, with nothing enrolled, or for a name that is not
 * a chord. The live `shape` output is what enrolment captures.
 */
import { describe, it, expect } from 'vitest';
import { airGuitarNode, type AirGuitarStatus } from '@/nodes/music/air_guitar';
import type { NoteEvent } from '@/nodes/music/note_events';
import type { HandsFrame } from '@/nodes/domain';
import type { TrainedModel } from '@/enroll';
import { emptyVocabulary, trainVocabulary, withEntry } from '@/air/vocabulary';
import { chordShapeFeatureIds } from '@/features/hand_shape';
import { guitarVoicing, parseChordName } from '@/music/guitar';
import { enrolSamples, guitarTake } from './synthetic_guitar';

function modelOf(names: Record<string, string>): TrainedModel {
  let v = emptyVocabulary(chordShapeFeatureIds());
  Object.entries(names).forEach(([shape, label], i) => (v = withEntry(v, label, enrolSamples(shape, 40, 50 + i))));
  return trainVocabulary(v)!;
}

function play(frames: HandsFrame[], config: Record<string, unknown>, model: TrainedModel | null) {
  const h = airGuitarNode.make(airGuitarNode.params.parse({}));
  const notes: NoteEvent[] = [];
  let status: AirGuitarStatus | undefined;
  let shape: unknown;
  for (const f of frames) {
    const out = h.process({ hands: f, config, model, octaveShift: 0 }, { time: f.t!, dt: 1 / 30, tick: 0, resources: {} } as never) as {
      notes: NoteEvent[];
      status: AirGuitarStatus;
      shape: unknown;
    };
    notes.push(...out.notes);
    status = out.status;
    shape = out.shape;
  }
  return { notes, status: status!, shape };
}

const ON = { enabled: true, mirrorHandedness: false };
const voiced = (name: string) => guitarVoicing(parseChordName(name)!).filter((n): n is number => n !== null);
/** Group notes into strums by their voice-0-or-first-string restart. */
function strums(notes: NoteEvent[]): NoteEvent[][] {
  const out: NoteEvent[][] = [];
  for (const n of notes) {
    const cur = out[out.length - 1];
    if (!cur || n.t - cur[cur.length - 1].t > 0.05) out.push([n]);
    else cur.push(n);
  }
  return out;
}

describe('the air-guitar node', () => {
  const model = modelOf({ G: 'G', C: 'C', D: 'D' });

  it('strums the held chord, then follows a chord change', () => {
    const frames = guitarTake({ duration: 4, chordAt: (t) => (t < 2 ? 'G' : 'C') });
    const { notes, status } = play(frames, ON, model);
    const s = strums(notes);
    expect(s.length).toBeGreaterThanOrEqual(6);
    const first = s.filter((x) => x[0].t < 1.9);
    const second = s.filter((x) => x[0].t > 2.3);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    for (const x of first) expect(x.map((n) => n.midi)).toEqual(voiced('G'));
    for (const x of second) expect(x.map((n) => n.midi)).toEqual(voiced('C'));
    // Low string first, spread in time, each on its string's voice.
    const g = first[0];
    for (let i = 1; i < g.length; i++) expect(g[i].t).toBeGreaterThan(g[i - 1].t);
    expect(g.map((n) => n.voice)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(status.strums).toBe(s.length);
    expect(status.predicted / status.strums).toBeGreaterThanOrEqual(0.5);
    expect(status.chord).toBe('C');
    expect(status.known).toBe(3);
  });

  it('emits the chord hand\'s live shape for enrolment', () => {
    const { shape } = play(guitarTake({ duration: 0.2, chordAt: () => 'G' }), ON, null);
    expect(Object.keys(shape as object).sort()).toEqual([...chordShapeFeatureIds()].sort());
  });

  it('plays nothing with nothing enrolled, and says so', () => {
    const { notes, status } = play(guitarTake({ duration: 3, chordAt: () => 'G' }), ON, null);
    expect(notes).toEqual([]);
    expect(status.known).toBe(0);
    expect(status.chord).toBeNull();
  });

  it('plays nothing for an enrolled name that is not a chord, and says so', () => {
    const odd = modelOf({ G: 'my shape' });
    const { notes, status } = play(guitarTake({ duration: 3, chordAt: () => 'G' }), ON, odd);
    expect(notes).toEqual([]);
    expect(status.chord).toBe('my shape');
    expect(status.playable).toBe(false);
  });

  it('sounds nothing with the dial off', () => {
    const { notes, status } = play(guitarTake({ duration: 3, chordAt: () => 'G' }), { enabled: false }, model);
    expect(notes).toEqual([]);
    expect(status.enabled).toBe(false);
  });
});
