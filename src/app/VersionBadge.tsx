/**
 * VersionBadge — a tiny, unobtrusive footer badge showing what's actually
 * deployed: the thoremin commit (short SHA) + deploy date, linking to the
 * GitHub commit. It reads the platform's per-app deploy manifest at
 * `${BASE_URL}_meta` (served by enlace from the manifest deploy.py writes), so
 * it reflects the *live deploy*, not the build. In dev (or any host without a
 * manifest) the fetch fails and the badge silently renders nothing.
 */
import { useEffect, useState } from 'react';

const REPO_COMMIT_URL = 'https://github.com/thorwhalen/thoremin/commit/';

interface DeployMeta {
  deployed_at?: string | null;
  app_source?: { sha?: string | null; ref?: string | null } | null;
}

/** Format an ISO timestamp as YYYY-MM-DD, or null if unparseable. */
function toDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

export default function VersionBadge() {
  const [meta, setMeta] = useState<DeployMeta | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${import.meta.env.BASE_URL}_meta`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((m: DeployMeta | null) => {
        if (alive) setMeta(m);
      })
      .catch(() => {
        /* dev / no manifest — leave the badge hidden */
      });
    return () => {
      alive = false;
    };
  }, []);

  const sha = meta?.app_source?.sha;
  if (!sha) return null;
  const short = sha.slice(0, 7);
  const date = toDate(meta?.deployed_at);

  return (
    <a
      href={`${REPO_COMMIT_URL}${sha}`}
      target="_blank"
      rel="noreferrer"
      title={`Deployed ${sha}${meta?.deployed_at ? ` at ${meta.deployed_at}` : ''}`}
      className="pointer-events-auto pl-1 font-mono text-[9px] uppercase tracking-widest text-white/30 transition hover:text-white/70"
    >
      {short}
      {date ? ` · ${date}` : ''}
    </a>
  );
}
