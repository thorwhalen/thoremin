/**
 * The staleness report: what changed since the last build, and what the curation file
 * does not cover yet. Printed by every build and shown on the guide's overview, so a
 * new research doc or a moved decision is visible the day it lands instead of being
 * missed until someone notices.
 *
 * State is the previous build's snapshot (doc hashes, decision issues' update times,
 * the manual-task set), kept in the guide's home, never in the repo.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DiskDoc, GhData } from './sources';
import type { Decision, DocEntry } from './schema';

export interface GuideState {
  builtAt?: string;
  docs: Record<string, string>;
  decisionIssues: Record<string, string>;
  manualTasks: number[];
  /** The annals document this guide is published as (for `--replace`). */
  annalsId?: string;
  annalsUrl?: string;
}

export interface StaleReport {
  since?: string;
  newDocs: DiskDoc[];
  changedDocs: DiskDoc[];
  uncurated: DiskDoc[];
  missing: DocEntry[];
  decisionsMoved: Array<{ issue: number; title: string }>;
  newManualTasks: Array<{ number: number; title: string }>;
}

export function readState(path: string): GuideState {
  if (!existsSync(path)) return { docs: {}, decisionIssues: {}, manualTasks: [] };
  return { docs: {}, decisionIssues: {}, manualTasks: [], ...JSON.parse(readFileSync(path, 'utf8')) };
}

export function writeState(path: string, state: GuideState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

export function staleness(
  prev: GuideState,
  { disk, entries, decisions, gh, ignore }: {
    disk: DiskDoc[]; entries: DocEntry[]; decisions: Decision[]; gh: GhData; ignore: string[];
  },
): { report: StaleReport; next: GuideState } {
  const curated = new Set([...entries.map((e) => e.path), ...decisions.flatMap((d) => (d.path ? [d.path] : []))]);
  const onDisk = new Set(disk.map((d) => d.path));
  const firstBuild = !prev.builtAt;
  const issueBy = new Map(gh.issues.map((i) => [i.number, i]));
  const decisionIssues = [...new Set(decisions.flatMap((d) => (d.issue ? [d.issue] : [])))];
  const manual = gh.issues.filter((i) => i.state === 'OPEN' && i.labels.includes('manual-task'));

  const report: StaleReport = {
    since: prev.builtAt,
    newDocs: firstBuild ? [] : disk.filter((d) => !(d.path in prev.docs)),
    changedDocs: disk.filter((d) => d.path in prev.docs && prev.docs[d.path] !== d.hash),
    uncurated: disk.filter((d) => !curated.has(d.path) && !ignore.some((p) => d.path.startsWith(p))),
    missing: entries.filter((e) => !onDisk.has(e.path)),
    decisionsMoved: firstBuild ? [] : decisionIssues.flatMap((n) => {
      const i = issueBy.get(n);
      return i && prev.decisionIssues[n] && prev.decisionIssues[n] !== i.updatedAt ? [{ issue: n, title: i.title }] : [];
    }),
    newManualTasks: firstBuild ? [] : manual.filter((i) => !prev.manualTasks.includes(i.number)).map(({ number, title }) => ({ number, title })),
  };
  const next: GuideState = {
    ...prev,
    builtAt: new Date().toISOString(),
    docs: Object.fromEntries(disk.map((d) => [d.path, d.hash])),
    decisionIssues: Object.fromEntries(decisionIssues.flatMap((n) => {
      const i = issueBy.get(n);
      return i ? [[String(n), i.updatedAt]] : [];
    })),
    manualTasks: manual.map((i) => i.number),
  };
  return { report, next };
}

/** The report as terminal lines (the build prints them). */
export function reportLines(r: StaleReport): string[] {
  const lines: string[] = [`Staleness report (since ${r.since ?? 'the first build'}):`];
  const section = (title: string, items: string[]) => {
    if (items.length) lines.push(`  ${title} (${items.length}):`, ...items.map((s) => `    - ${s}`));
  };
  section('NEW docs', r.newDocs.map((d) => d.path));
  section('CHANGED docs (re-check the abstract)', r.changedDocs.map((d) => d.path));
  section('UNCURATED docs (add an entry to guide.json, or private.json for a private doc)', r.uncurated.map((d) => `${d.path}  "${d.title}"`));
  section('MISSING docs (an entry whose file is gone)', r.missing.map((e) => e.path));
  section('DECISION issues updated (re-check the status)', r.decisionsMoved.map((d) => `#${d.issue} ${d.title}`));
  section('NEW manual-task issues', r.newManualTasks.map((i) => `#${i.number} ${i.title}`));
  if (lines.length === 1) lines.push('  nothing new; the curation covers every doc.');
  return lines;
}
