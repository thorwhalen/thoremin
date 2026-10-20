/**
 * The research guide generator (`scripts/research_guide/`): its committed curation
 * file stays valid and public-only, and the staleness report catches what the curation
 * misses (a new doc, a changed one, one with no abstract, a moved decision). The build
 * itself needs `gh` and runs outside CI; these cover the pure parts it is made of.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGuideData, GUIDE_DATA_PATH } from '../scripts/research_guide/build';
import { aggregate, barSvg, measureSvg, parseCsv, renderChart } from '../scripts/research_guide/charts';
import { REPO_ROOT } from '../scripts/research_guide/config';
import { slugOf, timelineItems, type GuideModel } from '../scripts/research_guide/render';
import { reportLines, staleness } from '../scripts/research_guide/staleness';
import type { DiskDoc, GhData } from '../scripts/research_guide/sources';

const data = loadGuideData();

describe('guide.json (the committed curation)', () => {
  it('matches its schema', () => {
    expect(data.docs.length).toBeGreaterThan(0);
    expect(data.areas.map((a) => a.id)).toContain('timing');
  });

  it('holds public material only: no private paths, no absolute local paths', () => {
    const text = readFileSync(GUIDE_DATA_PATH, 'utf8');
    expect(text).not.toMatch(/private:/);
    expect(text).not.toMatch(/\/(root|Users|home)\//);
  });

  it('points only at docs and CSVs that exist', () => {
    const paths = [
      ...data.docs.map((d) => d.path),
      ...data.decisions.flatMap((d) => (d.path ? [d.path] : [])),
      ...data.charts.flatMap((c) => (c.csv ? [c.csv] : [])),
      ...data.docs.flatMap((d) => d.figures ?? []),
    ];
    expect(paths.filter((p) => !existsSync(join(REPO_ROOT, p)))).toEqual([]);
  });

  it('files every doc and experiment under a declared area, with unique ids', () => {
    const areas = new Set(data.areas.map((a) => a.id));
    expect([...data.docs, ...data.experiments].filter((x) => !areas.has(x.area))).toEqual([]);
    const ids = data.experiments.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const decisionIds = data.decisions.map((d) => d.id);
    expect(new Set(decisionIds).size).toBe(decisionIds.length);
  });
});

const doc = (path: string, hash = 'h1'): DiskDoc => ({ path, abs: path, title: path, hash, updated: '2026-10-20', isPrivate: false });
const gh = (over: Partial<GhData> = {}): GhData => ({ fetchedAt: '2026-10-20T00:00:00Z', issues: [], prs: [], epics: [], discussions: [], ...over });
const entry = (path: string) => ({ path, title: path, area: 'timing' as const, abstract: 'a', status: 'current' as const });

describe('staleness', () => {
  it('lists an uncurated doc as needing an abstract, even on the first build', () => {
    const { report } = staleness({ docs: {}, decisionIssues: {}, manualTasks: [] }, {
      disk: [doc('docs/research/a.md'), doc('docs/research/b.md')], entries: [entry('docs/research/a.md')],
      decisions: [], gh: gh(), ignore: [],
    });
    expect(report.uncurated.map((d) => d.path)).toEqual(['docs/research/b.md']);
    expect(report.newDocs).toEqual([]);
  });

  it('flags new and changed docs, a missing doc, a moved decision and a new manual task against the last build', () => {
    const issue = (number: number, updatedAt: string, labels: string[] = []) => ({
      number, title: `issue ${number}`, state: 'OPEN' as const, url: '', labels, createdAt: '', updatedAt,
    });
    const prev = { builtAt: '2026-10-19T00:00:00Z', docs: { 'docs/a.md': 'h1', 'docs/b.md': 'h1' }, decisionIssues: { '168': 't1' }, manualTasks: [1] };
    const { report, next } = staleness(prev, {
      disk: [doc('docs/a.md'), doc('docs/b.md', 'h2'), doc('docs/c.md'), doc('docs/skip/x.md')],
      entries: [entry('docs/a.md'), entry('docs/b.md'), entry('docs/c.md'), entry('docs/gone.md')],
      decisions: [{ id: 'issue:168:D1', title: 'd', kind: 'decision', status: 'open', decided: 'x', issue: 168 }],
      gh: gh({ issues: [issue(168, 't2'), issue(1, 't', ['manual-task']), issue(2, 't', ['manual-task'])] }),
      ignore: ['docs/skip/'],
    });
    expect(report.newDocs.map((d) => d.path)).toEqual(['docs/c.md', 'docs/skip/x.md']);
    expect(report.changedDocs.map((d) => d.path)).toEqual(['docs/b.md']);
    expect(report.uncurated).toEqual([]);
    expect(report.missing.map((e) => e.path)).toEqual(['docs/gone.md']);
    expect(report.decisionsMoved).toEqual([{ issue: 168, title: 'issue 168' }]);
    expect(report.newManualTasks.map((i) => i.number)).toEqual([2]);
    expect(next.docs['docs/b.md']).toBe('h2');
    expect(next.manualTasks).toEqual([1, 2]);
    expect(reportLines(report).join('\n')).toMatch(/CHANGED docs/);
  });
});

describe('charts and slugs', () => {
  it('aggregates a CSV per group, filtered, largest first', () => {
    const rows = parseCsv('ch,level,f\na,beat,0.2\na,beat,0.5\nb,beat,0.4\nb,bar,0.9\n');
    const bars = aggregate(rows, { groupBy: 'ch', value: 'f', agg: 'max', filter: { level: 'beat' } });
    expect(bars).toEqual([{ key: 'a', value: 0.5 }, { key: 'b', value: 0.4 }]);
    expect(barSvg(bars, { label: 'max f' })).toMatch(/^<svg[\s\S]*ch-top[\s\S]*<\/svg>$/);
  });

  it('gives private and repo docs distinct page slugs', () => {
    expect(slugOf('docs/research/a-b.md')).toBe('docs-research-a-b');
    expect(slugOf('private:notes/a.md')).toBe('p-notes-a');
  });
});

describe('v2 visuals', () => {
  it('draws an inline-data chart with its threshold line', () => {
    const svg = renderChart({ id: 'c', title: 't', caption: '', agg: 'max', unit: 'ms', data: [{ key: 'a', value: 12 }, { key: 'b', value: 4 }], threshold: { value: 10, label: 'audible' } });
    expect(svg).toMatch(/ch-ref/);
    expect(svg).toMatch(/12\.0 ms/);
  });

  it('colours a measure by whether it cleared its bar', () => {
    expect(measureSvg({ value: 8, label: 'lag', better: 'lower', threshold: { value: 10, label: 'bound' } })).toMatch(/ch-pass/);
    expect(measureSvg({ value: 0.2, label: 'F', better: 'higher', baseline: { value: 0.5, label: 'old' } })).toMatch(/ch-fail[\s\S]*ch-base/);
  });

  it('gives every curated area at least one visual (a chart or a diagram)', () => {
    const withVisual = new Set([
      ...data.charts.map((c) => c.area ?? data.docs.find((d) => d.path === c.doc)?.area),
      ...data.diagrams.map((d) => d.area),
    ]);
    const areasWithDocs = new Set(data.docs.map((d) => d.area));
    expect([...areasWithDocs].filter((a) => !withVisual.has(a))).toEqual([]);
  });

  it('puts docs, decisions, experiments and merges on one line, newest first', () => {
    const m = {
      entries: new Map([['docs/a.md', entry('docs/a.md')]]),
      disk: new Map([['docs/a.md', { ...doc('docs/a.md'), created: '2026-09-01' }]]),
      data: { ...data, decisions: [{ id: 'adr:x', title: 'x', kind: 'adr', status: 'accepted', decided: '', date: '2026-10-01' }] },
      experiments: [{ id: 'e', title: 'e', area: 'timing', verdict: 'negative', number: 'n', summary: '', date: '2026-08-01' }],
      gh: gh({ prs: [{ number: 9, title: 'p', mergedAt: '2026-10-05T00:00:00Z', url: '' }] }),
    } as unknown as GuideModel;
    expect(timelineItems(m).map((i) => `${i.date} ${i.kind}`)).toEqual(['2026-10-05 pr', '2026-10-01 decision', '2026-09-01 doc', '2026-08-01 experiment']);
  });
});
