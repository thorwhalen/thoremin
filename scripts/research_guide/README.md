# The research guide (private)

`npm run research-guide -- --publish` rebuilds the owner's private guide to thoremin's research, experiments, ADRs and horizon, prints what changed since the last build, and republishes it to annals (in place, under one stable link, once annals supports `--replace`).

The site is built OUTSIDE the repo (default `~/.local/share/thoremin/research-guide/site`, or `THOREMIN_GUIDE_HOME`) because it renders private working notes too. Never commit its output.

## What it reads

- `docs/**/*.md`, with their git dates and content hashes.
- `guide.json` (this folder, committed): the curation of public material. Areas, one entry per doc (abstract, status, key numbers, issues, PRs), experiments with their verdicts, decisions (design docs and the choices on decision issues), the themes open issues are grouped by, the epics and discussions to read, charts over `docs/research/data/*.csv`, and the Mermaid diagrams. Its contract is `schema.ts`; `test/research_guide.test.ts` keeps it valid and free of private paths.
- The private overlay `private.json` in the guide's home: the same shapes for private working docs (`private:<root>/<path>`), ledger-only measurements, ideas and annals links. The private roots come from `THOREMIN_GUIDE_PRIVATE_ROOTS` (`name=dir:name=dir`), defaulting to this project's working-notes folders.
- GitHub through `gh`: every issue, merged PRs, the epics' sub-issue progress, the discussions. Cached, so `--offline` rebuilds without the network.

## Keeping it current

Each build prints a staleness report: NEW and CHANGED docs, UNCURATED docs (on disk with no entry: they appear in the guide as "new, needs an abstract"), MISSING docs, decision issues updated since the last build, and new `manual-task` issues. When a research doc, ADR or decision lands, add or update its entry in `guide.json` (or `private.json` for a private doc) and rebuild. The `thoremin-dev-guide` skill has the routine.
