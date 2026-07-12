/**
 * Annotation export (#92) — the egress path that makes live annotating useful: a
 * finished take must come back out as a file a real tool can open.
 *
 * The load-bearing detail here is the CLOCK. Edge events are stamped on the absolute
 * engine clock, and every export wants take-relative seconds (0 = first frame of the
 * recording). So these tests deliberately use a NON-ZERO `t0` — a zero t0 would let a
 * missing `- t0` subtraction pass silently, which is exactly the bug worth catching.
 */
// localStorage shim for the node test env (persistence is best-effort/debounced).
if (typeof (globalThis as { localStorage?: unknown }).localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

import { describe, it, expect, beforeEach } from 'vitest';
import { useTagging, type LastTake } from '@/app/tagging/store';
import {
  EXPORT_FORMATS,
  RAW_FORMAT,
  renderTake,
  resolveTake,
  summarizeTake,
  takeDuration,
} from '@/app/tagging/export';
import { ADAPTERS, getAdapter } from '@/taglog/adapters';
import { emptyTagState, DEFAULT_TAGGING_CONFIG, TagDefSchema } from '@/taglog/affordances';

const A = TagDefSchema.parse({ id: 'a', label: 'Verse', kind: 'interval' });
const P = TagDefSchema.parse({ id: 'p', label: 'Hit', kind: 'point' });

/** A deliberately non-round origin: the app has been up ~1000s before Record is hit. */
const T0 = 1000;

let now = 0;
const setNow = (sec: number) => void (now = sec);

beforeEach(() => {
  now = 0;
  useTagging.setState({
    mode: false,
    defs: [],
    config: DEFAULT_TAGGING_CONFIG,
    state: emptyTagState(),
    take: null,
    lastTake: null,
    countdown: null,
    pulse: 0,
    clock: () => now,
  });
});

/** Record a take: A spans [t0+1, t0+3], a point fires at t0+4, A reopens and is still
 *  open when the take stops at t0+6 (so it must be auto-closed at the end). */
function recordTake(): LastTake {
  const st = useTagging.getState();
  st.setDefs([A, P]);
  st.beginTake({ t0: T0, startedAt: '2026-07-11T09:30:00.000Z', session: 'sess_x' });
  setNow(T0 + 1);
  st.toggle('a', 'click');
  setNow(T0 + 3);
  st.toggle('a', 'click'); // close A -> interval [1, 3] take-relative
  setNow(T0 + 4);
  st.toggle('p', 'key'); // point @ 4
  setNow(T0 + 5);
  st.toggle('a', 'click'); // reopen A, never closed by hand
  useTagging.getState().endTake(T0 + 6); // auto-closes A at 6
  const last = useTagging.getState().lastTake;
  expect(last).not.toBeNull();
  return last!;
}

describe('endTake retains the take', () => {
  it('keeps the finished take so it can still be exported (it used to be discarded)', () => {
    const last = recordTake();
    expect(last.session).toBe('sess_x');
    expect(last.t0).toBe(T0);
    expect(last.endT).toBe(T0 + 6);
    expect(last.defs.map((d) => d.label)).toEqual(['Verse', 'Hit']);
    expect(last.jsonl).toContain('"anchor":true');
  });

  it('starting a new take does not clobber the previous one until that take ends', () => {
    recordTake();
    const st = useTagging.getState();
    st.beginTake({ t0: T0 + 100, startedAt: '2026-07-11T09:40:00.000Z', session: 'sess_y' });
    expect(useTagging.getState().lastTake!.session).toBe('sess_x'); // still the old one
    useTagging.getState().endTake(T0 + 101);
    expect(useTagging.getState().lastTake!.session).toBe('sess_y');
  });
});

describe('the take snapshots the annotation set it STARTED with', () => {
  it('a mid-take rename does not rewrite the labels the take was recorded with', () => {
    const st = useTagging.getState();
    st.setDefs([A, P]);
    st.beginTake({ t0: T0, startedAt: 'x', session: 'sess_x' });
    setNow(T0 + 1);
    useTagging.getState().toggle('a', 'click');
    setNow(T0 + 3);
    useTagging.getState().toggle('a', 'click');
    // The sheet stays openable mid-take: rename "Verse" -> "Chorus" while recording.
    useTagging.getState().updateTag('a', { label: 'Chorus' });
    useTagging.getState().endTake(T0 + 6);

    const last = useTagging.getState().lastTake!;
    expect(last.defs.find((d) => d.id === 'a')!.label).toBe('Verse'); // what was recorded
    expect(useTagging.getState().defs.find((d) => d.id === 'a')!.label).toBe('Chorus'); // live set moved on
    expect(renderTake(last, 'audacity').body).toContain('Verse');
  });

  it('an annotation deleted mid-take still gets its open interval closed at the end', () => {
    const st = useTagging.getState();
    st.setDefs([A, P]);
    st.beginTake({ t0: T0, startedAt: 'x', session: 'sess_x' });
    setNow(T0 + 1);
    useTagging.getState().toggle('a', 'click'); // A open…
    useTagging.getState().removeTag('a'); // …and its definition is deleted from the live set
    useTagging.getState().endTake(T0 + 6);

    const last = useTagging.getState().lastTake!;
    // Closing against the LIVE defs would have dropped this interval on the floor.
    expect(resolveTake(last)).toMatchObject([{ tag: 'a', start: 1, end: 6, kind: 'interval' }]);
  });
});

describe('an abandoned take does not clobber the last exportable one', () => {
  it('keeps take A when take B is torn down without capturing anything', () => {
    recordTake(); // take A: clean stop, exportable
    const st = useTagging.getState();
    st.beginTake({ t0: T0 + 100, startedAt: 'x', session: 'sess_b' });
    // No annotations tapped; the recorder is disposed (source switch / unmount).
    useTagging.getState().endTake(T0 + 101, { abandoned: true });

    // Take B wrote no media files and captured nothing — take A must still be there.
    expect(useTagging.getState().lastTake!.session).toBe('sess_x');
    expect(useTagging.getState().take).toBeNull(); // …but the runtime is no longer "recording"
  });

  it('still publishes an abandoned take that DID capture annotations (that is user data)', () => {
    recordTake();
    const st = useTagging.getState();
    st.beginTake({ t0: T0 + 100, startedAt: 'x', session: 'sess_b' });
    setNow(T0 + 101);
    useTagging.getState().toggle('a', 'click');
    useTagging.getState().endTake(T0 + 102, { abandoned: true });

    expect(useTagging.getState().lastTake!.session).toBe('sess_b');
  });
});

describe('resolveTake — times are take-relative, not absolute', () => {
  it('shifts every edge by t0 so the first frame of the recording is 0', () => {
    const resolved = resolveTake(recordTake());
    const byTag = (tag: string) => resolved.filter((iv) => iv.tag === tag);

    // Had we forgotten `- t0`, these would be 1001 / 1003 rather than 1 / 3.
    expect(byTag('a')[0]).toMatchObject({ start: 1, end: 3, kind: 'interval' });
    expect(byTag('p')[0]).toMatchObject({ start: 4, end: 4, kind: 'point' });
  });

  it('closes a still-open annotation at the end of the take, not at its own start', () => {
    const resolved = resolveTake(recordTake());
    const held = resolved.filter((iv) => iv.tag === 'a')[1];
    // Held from 5 until Stop at 6 — the gesture plainly means "to the end".
    expect(held).toMatchObject({ start: 5, end: 6 });
  });

  it('reports the take duration on the take clock', () => {
    expect(takeDuration(recordTake())).toBe(6);
  });
});

describe('summarizeTake', () => {
  it('counts intervals and points separately', () => {
    expect(summarizeTake(recordTake())).toEqual({ intervals: 2, points: 1, seconds: 6 });
  });
});

describe('renderTake', () => {
  it('renders Audacity labels with take-relative times and the human label', () => {
    const { body, filename } = renderTake(recordTake(), 'audacity');
    const rows = body.trim().split('\n').map((l) => l.split('\t'));
    expect(rows[0]).toEqual(['1.000000', '3.000000', 'Verse']);
    // A point is a zero-width label (start == end), which is how Audacity marks an instant.
    expect(rows.find((r) => r[2] === 'Hit')).toEqual(['4.000000', '4.000000', 'Hit']);
    expect(filename).toBe('sess_x.annotations.txt');
  });

  it('renders CSV with a header and one row per annotation', () => {
    const { body, mime } = renderTake(recordTake(), 'csv');
    expect(mime).toBe('text/csv');
    expect(body.trim().split('\n')).toHaveLength(4); // header + 2 intervals + 1 point
  });

  it('hands back the archival JSONL verbatim for the raw format', () => {
    const take = recordTake();
    const { body, filename } = renderTake(take, RAW_FORMAT);
    expect(body).toBe(take.jsonl); // byte-identical to the file in the take folder
    expect(filename).toBe('sess_x.annotations.jsonl');
  });

  it('names the file after the take, so a download can be matched to its recording', () => {
    // `session` IS the take's folder + file stem (the recorder's sanitized stem). If the
    // user NAMED the take there is no timestamp in it at all, so anything derived from
    // the clock would share nothing with the folder the recording landed in.
    const st = useTagging.getState();
    st.setDefs([A]);
    st.beginTake({ t0: T0, startedAt: '2026-07-11T09:30:00.000Z', session: 'bridge-take-3' });
    setNow(T0 + 1);
    useTagging.getState().toggle('a', 'click');
    useTagging.getState().endTake(T0 + 2);
    const take = useTagging.getState().lastTake!;
    expect(renderTake(take, 'csv').filename).toBe('bridge-take-3.annotations.csv');
    expect(renderTake(take, RAW_FORMAT).filename).toBe('bridge-take-3.annotations.jsonl');
  });

  it('throws on an unknown format rather than silently downloading an empty file', () => {
    expect(() => renderTake(recordTake(), 'nope')).toThrow(/Unknown annotation export format/);
  });

  it('throws on an inherited Object key rather than dying inside the adapter', () => {
    // `'toString' in ADAPTERS` is TRUE via the prototype chain: a bare `in`/index lookup
    // would hand back Object.prototype.toString (truthy, so the guard passes) and then
    // blow up on `adapter.render is not a function`.
    expect(getAdapter('toString')).toBeUndefined();
    expect(() => renderTake(recordTake(), 'toString')).toThrow(/Unknown annotation export format/);
  });
});

describe('lead-in correction is chosen, never silently applied', () => {
  /** A tag with a 2s lead-in: opened at 0.5s, closed at 5.0s (take-relative). */
  function leadInTake(): LastTake {
    const st = useTagging.getState();
    st.setDefs([TagDefSchema.parse({ id: 'a', label: 'Verse', kind: 'interval', leadIn: 2 })]);
    st.beginTake({ t0: T0, startedAt: 'x', session: 'sess_l' });
    setNow(T0 + 0.5);
    useTagging.getState().toggle('a', 'click');
    setNow(T0 + 5);
    useTagging.getState().toggle('a', 'click');
    useTagging.getState().endTake(T0 + 6);
    return useTagging.getState().lastTake!;
  }

  it('defaults to the corrected times (open +leadIn, close -leadIn)', () => {
    const rows = renderTake(leadInTake(), 'audacity').body.trim().split('\t');
    expect([rows[0], rows[1]]).toEqual(['2.500000', '3.000000']);
  });

  it('exports the raw tap instants when asked — the times the user actually produced', () => {
    const rows = renderTake(leadInTake(), 'audacity', 'raw').body.trim().split('\t');
    expect([rows[0], rows[1]]).toEqual(['0.500000', '5.000000']);
  });
});

describe('the format picker is derived from the adapter registry', () => {
  it('offers every shipped adapter plus the raw log — and nothing that cannot render', () => {
    // The picker is BUILT from ADAPTERS, so drift is impossible by construction; this
    // pins the derivation (and that every offered id actually renders).
    expect(EXPORT_FORMATS.map((f) => f.id)).toEqual([...Object.keys(ADAPTERS), RAW_FORMAT]);
    for (const f of EXPORT_FORMATS) {
      expect(() => renderTake(recordTake(), f.id), `${f.id} does not render`).not.toThrow();
      expect(f.label, `${f.id} has no label`).toBeTruthy();
      expect(f.note, `${f.id} has no note`).toBeTruthy();
    }
  });
});
