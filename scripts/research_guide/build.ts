/**
 * Build (and optionally publish) the private research guide: thoremin's research,
 * experiments, ADRs and horizon as a small static site.
 *
 *   npm run research-guide                 # build into the guide's home, print the staleness report
 *   npm run research-guide -- --publish    # build, then publish to annals (in place once annals has --replace)
 *   npm run research-guide -- --offline    # rebuild from the cached GitHub data
 *   npm run research-guide -- --out DIR    # build somewhere else (a test, a preview)
 *
 * Inputs: the repo's docs, `guide.json` beside this script (the public curation), the
 * private overlay and private roots named by `config.ts`, and `gh`. Output: a folder
 * OUTSIDE the repo, because it carries private material; it is never committed.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type GuideConfig } from './config';
import { renderChart } from './charts';
import { GuideDataSchema, PrivateDataSchema, type DocEntry, type GuideData, type PrivateData } from './schema';
import { docPage, renderDecisions, renderDoc, renderExperiments, renderHorizon, renderIndex, renderResearch, slugOf, type GuideModel } from './render';
import { loadGitHub, privateDocs, repoDocs, resolveDocPath } from './sources';
import { readState, reportLines, staleness, writeState, type GuideState } from './staleness';

const HERE = dirname(fileURLToPath(import.meta.url));
export const GUIDE_DATA_PATH = join(HERE, 'guide.json');

function parseJson<T>(path: string, schema: { safeParse(x: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } } }): T {
  const parsed = schema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    const where = parsed.error.issues.slice(0, 8).map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`${path} does not match its schema (scripts/research_guide/schema.ts):\n${where}`);
  }
  return parsed.data;
}

export function loadGuideData(path = GUIDE_DATA_PATH): GuideData {
  return parseJson(path, GuideDataSchema);
}

function loadPrivate(cfg: GuideConfig): PrivateData {
  return existsSync(cfg.privateDataPath) ? parseJson(cfg.privateDataPath, PrivateDataSchema) : PrivateDataSchema.parse({});
}

/** Copy each doc's figures into the site (`fig/<doc slug>/<name>`) and return their site paths. */
function copyFigures(entries: DocEntry[], cfg: GuideConfig, out: string): Map<string, string[]> {
  const figures = new Map<string, string[]>();
  for (const e of entries) {
    const files = (e.figures ?? []).flatMap((f) => {
      const src = resolveDocPath(f, cfg.privateRoots);
      if (!src || !existsSync(src) || !/\.(png|jpe?g|webp|gif|svg)$/i.test(src)) return [];
      const rel = `fig/${slugOf(e.path)}/${basename(src)}`;
      mkdirSync(dirname(join(out, rel)), { recursive: true });
      copyFileSync(src, join(out, rel));
      return [rel];
    });
    if (files.length) figures.set(e.path, files);
  }
  return figures;
}

export interface BuildResult { out: string; lines: string[]; state: GuideState; cfg: GuideConfig }

export function build({ offline = false, out }: { offline?: boolean; out?: string } = {}): BuildResult {
  const cfg = loadConfig(process.env, { out });
  const data = loadGuideData();
  const priv = loadPrivate(cfg);
  const disk = [...repoDocs(), ...privateDocs(cfg.privateRoots)];
  const gh = loadGitHub(cfg.ghCachePath, { offline, epics: data.epics, discussions: data.discussions });
  const entries = [...data.docs, ...priv.docs];
  const prev = readState(cfg.statePath);
  const { report, next } = staleness(prev, {
    disk, entries, decisions: data.decisions, gh, ignore: [...data.ignoreDocs, ...priv.ignoreDocs],
  });

  rmSync(cfg.out, { recursive: true, force: true });
  mkdirSync(join(cfg.out, 'doc'), { recursive: true });
  const model: GuideModel = {
    data, gh, report,
    entries: new Map(entries.map((e) => [e.path, e])),
    experiments: [...data.experiments, ...priv.experiments],
    ideas: [...data.ideas, ...priv.ideas],
    disk: new Map(disk.map((d) => [d.path, d])),
    charts: new Map(data.charts.map((c) => [c.id, `<figure>${renderChart(c)}<figcaption class="meta">${c.caption}</figcaption></figure>`])),
    annals: priv.annals,
    figures: copyFigures(entries, cfg, cfg.out),
    builtAt: next.builtAt!,
  };
  const pages: Record<string, string> = {
    'index.html': renderIndex(model),
    'research.html': renderResearch(model),
    'experiments.html': renderExperiments(model),
    'decisions.html': renderDecisions(model),
    'horizon.html': renderHorizon(model),
  };
  for (const d of disk) pages[docPage(d.path)] = renderDoc(model, d, readFileSync(d.abs, 'utf8'));
  for (const [rel, html] of Object.entries(pages)) writeFileSync(join(cfg.out, rel), html);
  writeState(cfg.statePath, next);
  return { out: cfg.out, lines: reportLines(report), state: next, cfg };
}

/** Publish the built site to annals: in place (`--replace`) when annals supports it and the guide was published before. */
export function publish({ out, state, cfg }: BuildResult): { url: string; id?: string } {
  const help = execFileSync('annals', ['publish', '--help'], { encoding: 'utf8' });
  const replace = state.annalsId && help.includes('--replace') ? ['--replace', state.annalsId] : [];
  const args = ['publish', out, '--session', cfg.session, '--title', 'thoremin research guide', '--tags', 'thoremin,research-guide', ...replace];
  const printed = execFileSync('annals', args, { encoding: 'utf8' });
  const url = printed.match(/https?:\/\/\S+/)?.[0] ?? printed.trim();
  const id = url.split('/').filter(Boolean).pop();
  writeState(cfg.statePath, { ...state, annalsId: id, annalsUrl: url });
  return { url, id };
}
