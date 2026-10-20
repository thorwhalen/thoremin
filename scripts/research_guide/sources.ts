/**
 * What the guide is built from, read fresh on every build: the docs on disk (repo and
 * private), their git dates and content hashes, and GitHub (issues, merged PRs, epics'
 * progress, discussions) through the `gh` CLI.
 *
 * GitHub answers are cached in the guide's home so `--offline` can rebuild the site
 * (to fix a typo in an abstract, say) without a network round trip.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { PRIVATE_SKIP, REPO_ROOT, REPO_SLUG } from './config';

export interface DiskDoc {
  /** The key curation uses: repo-relative, or `private:<root>/<rel>`. */
  path: string;
  abs: string;
  title: string;
  hash: string;
  /** First and last commit dates (repo docs), or the file's mtime (private docs). */
  created?: string;
  updated: string;
  isPrivate: boolean;
}

function walk(dir: string, keep: (rel: string) => boolean, root = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const abs = join(dir, name);
    const rel = relative(root, abs);
    if (!keep(rel)) continue;
    if (statSync(abs).isDirectory()) out.push(...walk(abs, keep, root));
    else if (name.endsWith('.md')) out.push(abs);
  }
  return out.sort();
}

function titleOf(text: string, fallback: string): string {
  const h = text.match(/^#\s+(.+)$/m);
  return (h ? h[1] : fallback).replace(/[*_`]/g, '').trim();
}

const hashOf = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 12);

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

/** Every Markdown file under `docs/`, with its git dates. */
export function repoDocs(): DiskDoc[] {
  return walk(join(REPO_ROOT, 'docs'), () => true).map((abs) => {
    const path = relative(REPO_ROOT, abs);
    const text = readFileSync(abs, 'utf8');
    const dates = git(['log', '--follow', '--format=%cs', '--', path]).split('\n').filter(Boolean);
    return {
      path, abs, title: titleOf(text, path), hash: hashOf(text),
      created: dates.at(-1), updated: dates[0] ?? new Date().toISOString().slice(0, 10), isPrivate: false,
    };
  });
}

/** Every Markdown file under the private roots, minus agent briefs. */
export function privateDocs(roots: Record<string, string>): DiskDoc[] {
  return Object.entries(roots).flatMap(([name, dir]) =>
    walk(dir, (rel) => !PRIVATE_SKIP.some((re) => re.test(rel))).map((abs) => {
      const text = readFileSync(abs, 'utf8');
      return {
        path: `private:${name}/${relative(dir, abs)}`, abs, title: titleOf(text, relative(dir, abs)),
        hash: hashOf(text), updated: statSync(abs).mtime.toISOString().slice(0, 10), isPrivate: true,
      };
    }),
  );
}

/** Resolve a `private:<root>/<rel>` path (or a repo-relative one) to a file on disk. */
export function resolveDocPath(path: string, roots: Record<string, string>): string | undefined {
  if (!path.startsWith('private:')) return join(REPO_ROOT, path);
  const rest = path.slice('private:'.length);
  const slash = rest.indexOf('/');
  const root = roots[rest.slice(0, slash)];
  return root ? join(root, rest.slice(slash + 1)) : undefined;
}

export interface GhIssue {
  number: number; title: string; state: 'OPEN' | 'CLOSED'; url: string;
  labels: string[]; createdAt: string; updatedAt: string; closedAt?: string | null;
}
export interface GhPr { number: number; title: string; mergedAt: string; url: string }
export interface GhEpic {
  number: number; title: string; state: string; url: string; updatedAt: string;
  subTotal: number; subDone: number; boxTotal: number; boxDone: number;
}
export interface GhDiscussion { number: number; title: string; url: string; updatedAt: string; comments: number; excerpt: string }
export interface GhData { fetchedAt: string; issues: GhIssue[]; prs: GhPr[]; epics: GhEpic[]; discussions: GhDiscussion[] }

function gh(args: string[]): string {
  return execFileSync('gh', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function graphql<T>(query: string): T {
  return JSON.parse(gh(['api', 'graphql', '-f', `query=${query}`])).data as T;
}

const [OWNER, NAME] = REPO_SLUG.split('/');

function fetchEpics(numbers: number[]): GhEpic[] {
  return numbers.map((n) => {
    const { repository } = graphql<{ repository: { issue: {
      number: number; title: string; state: string; url: string; updatedAt: string; body: string;
      subIssuesSummary: { total: number; completed: number };
    } } }>(`{repository(owner:"${OWNER}",name:"${NAME}"){issue(number:${n}){number title state url updatedAt body subIssuesSummary{total completed}}}}`);
    const i = repository.issue;
    return {
      number: i.number, title: i.title, state: i.state, url: i.url, updatedAt: i.updatedAt,
      subTotal: i.subIssuesSummary.total, subDone: i.subIssuesSummary.completed,
      boxTotal: (i.body.match(/^\s*[-*] \[[ xX]\]/gm) ?? []).length,
      boxDone: (i.body.match(/^\s*[-*] \[[xX]\]/gm) ?? []).length,
    };
  });
}

function fetchDiscussions(numbers: number[]): GhDiscussion[] {
  return numbers.map((n) => {
    const { repository } = graphql<{ repository: { discussion: {
      number: number; title: string; url: string; updatedAt: string; body: string; comments: { totalCount: number };
    } } }>(`{repository(owner:"${OWNER}",name:"${NAME}"){discussion(number:${n}){number title url updatedAt body comments{totalCount}}}}`);
    const d = repository.discussion;
    const excerpt = d.body.replace(/[#>*`_]/g, '').split(/\n\s*\n/).map((p) => p.trim()).find((p) => p.length > 60) ?? '';
    return { number: d.number, title: d.title, url: d.url, updatedAt: d.updatedAt, comments: d.comments.totalCount, excerpt: excerpt.slice(0, 400) };
  });
}

export function fetchGitHub({ epics, discussions }: { epics: number[]; discussions: number[] }): GhData {
  const issues = (JSON.parse(gh(['issue', 'list', '--repo', REPO_SLUG, '--state', 'all', '--limit', '3000',
    '--json', 'number,title,state,url,labels,createdAt,updatedAt,closedAt'])) as Array<Omit<GhIssue, 'labels'> & { labels: Array<{ name: string }> }>)
    .map((i) => ({ ...i, labels: i.labels.map((l) => l.name) }));
  const prs = JSON.parse(gh(['pr', 'list', '--repo', REPO_SLUG, '--state', 'merged', '--limit', '3000',
    '--json', 'number,title,mergedAt,url'])) as GhPr[];
  return { fetchedAt: new Date().toISOString(), issues, prs, epics: fetchEpics(epics), discussions: fetchDiscussions(discussions) };
}

/** Fetch from GitHub and refresh the cache, or (offline) read the cache. */
export function loadGitHub(cachePath: string, opts: { offline: boolean; epics: number[]; discussions: number[] }): GhData {
  if (opts.offline) {
    if (!existsSync(cachePath)) throw new Error(`--offline needs a cache from an earlier online build; none at ${cachePath}`);
    return JSON.parse(readFileSync(cachePath, 'utf8')) as GhData;
  }
  const data = fetchGitHub(opts);
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(data));
  return data;
}
