/**
 * Tagging runtime store (#92) — the thoremin glue over the pure `taglog` core.
 * Drives the take lifecycle with an injected clock (deterministic media times) and
 * asserts the emitted `annotations.jsonl`, exclusivity, the overlay snapshot, and that
 * rehearsal toggles (no take) are NOT logged.
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
import { useTagging, renumber, defaultTagSet } from '@/app/tagging/store';
import { emptyTagState, DEFAULT_TAGGING_CONFIG, TagDefSchema } from '@/taglog/affordances';

const A = TagDefSchema.parse({ id: 'a', label: 'A', kind: 'interval', group: 'g' });
const B = TagDefSchema.parse({ id: 'b', label: 'B', kind: 'interval', group: 'g' });
const P = TagDefSchema.parse({ id: 'p', label: 'P', kind: 'point' });

let now = 0;
function setNow(sec: number) {
  now = sec;
}

beforeEach(() => {
  useTagging.setState({
    mode: false,
    defs: [],
    config: DEFAULT_TAGGING_CONFIG,
    state: emptyTagState(),
    take: null,
    countdown: null,
    pulse: 0,
    clock: () => now,
  });
});

describe('renumber', () => {
  it('assigns 1..9 by order, null past the ninth, and sets order', () => {
    const many = renumber(Array.from({ length: 11 }, (_, i) => TagDefSchema.parse({ id: `t${i}`, label: `${i}` })));
    expect(many[0].number).toBe(1);
    expect(many[8].number).toBe(9);
    expect(many[9].number).toBeNull();
    expect(many[10].order).toBe(10);
  });
});

describe('take lifecycle → annotations.jsonl', () => {
  it('logs absolute engine-clock events with an origin anchor, closing still-open at endTake', () => {
    const st = useTagging.getState();
    st.setDefs([A, B, P]);
    st.setConfig({ exclusivity: 'single' });
    // t0 = 0 here so the clock() values ARE the take offsets (keeps the assertions
    // readable); in production t0 is the page-load->record gap and the offset is t - t0.
    st.beginTake({ t0: 0, startedAt: '2026-07-10T00:00:00.000Z', session: 'sess_1' });

    setNow(1);
    st.toggle('a', 'click');
    setNow(3);
    st.toggle('b', 'key'); // exclusivity: auto-closes A, opens B
    setNow(4);
    st.toggle('p', 'key'); // a point
    const jsonl = useTagging.getState().endTake(6); // closes B at t=6

    const lines = jsonl.trim().split('\n').map((l) => JSON.parse(l));
    // The anchor's `t` is the origin (== t0), matching the manifest t0.
    expect(lines[0]).toMatchObject({ anchor: true, t: 0, session: 'sess_1', schema: 'thoremin.annotations/1', recStartPerf: 0 });
    const events = lines.slice(1);
    // open A @1, auto-close A @3, open B @3, point p @4, close B @6 (all absolute engine time)
    expect(events.map((e) => [e.tag, e.status, e.t])).toEqual([
      ['a', 'open', 1],
      ['a', 'close', 3],
      ['b', 'open', 3],
      ['p', 'point', 4],
      ['b', 'close', 6],
    ]);
    expect(events.find((e) => e.tag === 'a' && e.status === 'close').src).toBe('auto');
    expect(useTagging.getState().take).toBeNull();
  });

  it('stamps t on the ABSOLUTE clock (offset t - t0), matching features.jsonl', () => {
    const st = useTagging.getState();
    st.setDefs([A]);
    st.beginTake({ t0: 180, startedAt: 'x', session: 's' }); // record 180s after page load
    setNow(182); // engine clock now 182 -> take offset 2s
    st.toggle('a', 'key');
    const jsonl = useTagging.getState().endTake(185);
    const events = jsonl.trim().split('\n').slice(1).map((l) => JSON.parse(l));
    // Absolute t (182), NOT the relative 2 — so a consumer doing (t - manifest.t0)
    // recovers the correct 2s offset instead of double-subtracting to -178.
    expect(events[0]).toMatchObject({ tag: 'a', status: 'open', t: 182 });
  });

  it('does not log toggles while not recording (rehearsal), but still tracks open state', () => {
    const st = useTagging.getState();
    st.setDefs([A, B]);
    setNow(5);
    st.toggle('a', 'key');
    expect(useTagging.getState().isOpen('a')).toBe(true); // live UI reflects it
    // Nothing was logged: a subsequent take starts with a clean, empty log.
    st.beginTake({ t0: 0, startedAt: 'x', session: 's' });
    expect(useTagging.getState().isOpen('a')).toBe(false); // fresh slate per take
    expect(useTagging.getState().endTake(1).trim().split('\n')).toHaveLength(1); // anchor only
  });
});

describe('overlay snapshot', () => {
  it('is null unless recording, then lists open tags with labels/colors', () => {
    const st = useTagging.getState();
    st.setDefs([A]);
    expect(useTagging.getState().overlaySnapshot()).toBeNull();
    st.beginTake({ t0: 50, startedAt: 'x', session: 's' });
    setNow(52);
    st.toggle('a', 'key');
    const snap = useTagging.getState().overlaySnapshot()!;
    expect(snap.t0).toBe(50);
    expect(snap.open).toEqual([{ tag: 'a', label: 'A', color: A.color }]);
  });
});

describe('keyboard-facing actions', () => {
  it('toggleByNumber maps the digit to the positional tag; closeAllTags clears', () => {
    const st = useTagging.getState();
    st.setDefs([A, B]); // A→1, B→2
    st.beginTake({ t0: 0, startedAt: 'x', session: 's' });
    setNow(1);
    st.toggleByNumber(1, 'key');
    st.toggleByNumber(2, 'key');
    expect(Object.keys(useTagging.getState().state.open).sort()).toEqual(['a', 'b']);
    setNow(2);
    st.closeAllTags('key');
    expect(Object.keys(useTagging.getState().state.open)).toHaveLength(0);
  });
});

describe('active() gate', () => {
  it('is false without tags or when mode is off', () => {
    const st = useTagging.getState();
    expect(useTagging.getState().active()).toBe(false);
    st.setDefs([A]);
    useTagging.setState({ mode: true });
    expect(useTagging.getState().active()).toBe(true);
    useTagging.setState({ mode: false });
    expect(useTagging.getState().active()).toBe(false);
  });
});

describe('defaultTagSet', () => {
  it('is a small, numbered, usable starter set', () => {
    const set = defaultTagSet();
    expect(set.length).toBeGreaterThanOrEqual(2);
    expect(set[0].number).toBe(1);
  });
});
