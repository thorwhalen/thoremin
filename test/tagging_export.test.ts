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
  isRenderableFormat,
  renderTake,
  resolveTake,
  summarizeTake,
  takeDuration,
} from '@/app/tagging/export';
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
    // The labels are snapshotted at endTake, so editing the set later can't rewrite history.
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
    expect(filename).toBe('2026-07-11T09-30-00-000.annotations.txt');
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
    expect(filename).toBe('2026-07-11T09-30-00-000.annotations.jsonl');
  });

  it('throws on an unknown format rather than silently downloading an empty file', () => {
    expect(() => renderTake(recordTake(), 'nope')).toThrow(/Unknown annotation export format/);
  });
});

describe('the format picker and the adapter registry cannot drift', () => {
  it('every format offered in the UI is actually renderable', () => {
    // Adding a format to the picker without an adapter would otherwise fail at the
    // user's click, having already told them the export exists.
    for (const f of EXPORT_FORMATS) {
      expect(isRenderableFormat(f.id), `${f.id} has no adapter`).toBe(true);
      expect(() => renderTake(recordTake(), f.id)).not.toThrow();
    }
  });
});
