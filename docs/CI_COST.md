# What CI costs now that this repo is private

**Reading of 2026-10-30 (supersedes the numbers below, which are from 2026-09-27).** Since then `ci.yml` grew to three jobs and `smoke.yml` to three shards plus a result job. Measured on the 12 latest successful runs of each, billed minutes rounded up per job, with the run counts of the last 30 days:

| Workflow | Runs in 30 days | Billed min/run | Min/month |
|---|---:|---:|---:|
| `ci.yml` | 431 | 13.4 | 5,780 |
| `smoke.yml` | 398 | 20.6 | 8,190 |
| `deploy.yml` | 170 | 1 | 170 |
| `coverage.yml` | about 4 | 14 | 56 |
| thoremin-asl and thoremin-ar CI | 25 | about 12 | 300 |
| **Total** | | | **about 14,500 (at most: cancelled runs bill less)** |

That is about **$87/month** at $0.006/minute before any included allowance, and it would use a 3,000-minute allowance in about 6 days. The minutes are shared across the account, so running out would also refuse tw_platform's deploy workflow and every other private repository. A docs-only path filter would save almost nothing: 2 of the last 170 merges touched only docs. After the flip, `priv ci-blocked --repo thorwhalen/<repo>` is the check for a refused run; when blocked, land through `wads ci-local`.

## Private repositories: how CI reads the plugins

`package.json` pins `@thoremin/ext-asl` and `@thoremin/ext-draw` as git dependencies and the lockfile resolves them to `git+ssh://`. npm tries a public tarball first and clones over ssh after a 404, so a private dependency needs an ssh key on the machine that installs. `GITHUB_TOKEN` reaches only its own repository.

Every job that runs `npm ci` loads read-only deploy keys through `webfactory/ssh-agent` (pinned by commit), which maps each key to its repository by the key's comment (`git@github.com:thorwhalen/<repo>.git`). Secrets, one key per repository: `THOREMIN_ASL_DEPLOY_KEY` and `THOREMIN_AR_DEPLOY_KEY` here; those two plus `THOREMIN_DEPLOY_KEY` on the two plugin repositories, whose CI runs inside a thoremin checkout. To rotate one: `ssh-keygen` with that comment, `gh repo deploy-key add` (no write access), `gh secret set` on each repository that uses it, delete the key file. Jobs without secrets (a fork, Dependabot) cannot install.

---

The rest is the first reconstruction, from when the repo was public.

thoremin is public, so every workflow run in `.github/workflows/` is free — GitHub
does not meter Actions minutes on public repos at all. That means the Actions API's
own billing field (`billable.*.total_ms`) reports `0` for every run here; it is not a
number this document can read off, it has to be reconstructed. This is that
reconstruction: real wall-clock time from real runs, multiplied by what GitHub
actually charges a private repo for the same runner.

Read this before flipping visibility (issue #262, tag `not-for-agents`): the number
below is what CI would cost *by itself*, on GitHub's baseline per-minute rate. It
does not account for the account's actual current plan/quota or any Actions-minutes
already used elsewhere — check that separately before changing visibility.

## Method

1. `gh api repos/thorwhalen/thoremin/actions/runs/<id>/jobs` for the 20 most recent
   completed runs of each workflow (`ci.yml`, `smoke.yml`, `deploy.yml`), pulled
   2026-09-27. Each job and step carries `started_at`/`completed_at`; wall-clock
   duration is `completed_at - started_at`, summed per job.
2. Runner rate: **$0.006 / minute** for a Linux 2-core (x64) GitHub-hosted runner —
   the current published baseline rate for private repos
   ([docs.github.com/en/billing/concepts/product-billing/github-actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).
   All three workflows here run only on `ubuntu-latest`, so no other OS rate
   applies. **GitHub bills each job rounded up to the next whole minute** — the
   per-run costs below apply that rounding (e.g. a 5 s job still bills 1 minute),
   so they are not simple `seconds × rate` figures.
3. Monthly extrapolation: rather than each workflow's full lifetime average — which
   would understate recent pace, since `ci.yml` (added 2026-08-17) and `deploy.yml`
   (added 2026-07-08) predate `smoke.yml` (added 2026-09-09) — all three are counted
   over the same shared window, 2026-09-09 to 2026-09-27 (18 days), and scaled to a
   30-day month. This window has an unusually concentrated burst of agent-driven PRs,
   so treat the monthly figure as "recent pace," not a long-run average.
4. Public-repo runners may not be spec-identical to the private-repo runners this
   estimate bills against; if so, these wall-clock numbers under- or over-state the
   private equivalent by whatever that spec difference is. Not verified either way
   here — a caveat, not a correction.

## What a run costs today

| Workflow | Job | Runs sampled | Avg wall time | Billed minutes (rounded up) | Cost/run (private) |
|---|---|---:|---:|---:|---:|
| `ci.yml` | typecheck / test / build | 20 | 89.1 s | 2 | $0.012 |
| `smoke.yml` | built bundle, headless Chromium | 20 | 84.5 s (median 67.5 s; one outlier at 364 s — a cold Playwright/Chromium cache) | 2 (6 for the outlier) | $0.012 (typ.) |
| `deploy.yml` | trigger-deploy | 20 | 4.7 s | 1 | $0.006 |

Per-run cost is about the same order of magnitude for `ci.yml` and `smoke.yml` — the
difference that matters is **frequency**, not per-run price:

| Workflow | Runs, 2026-09-09→09-27 (18 days) | Runs/day | Extrapolated $/month (private, at $0.012 or $0.006/run) |
|---|---:|---:|---:|
| `ci.yml` | 150 | 8.3 | ≈ $3.00 |
| `smoke.yml` | 87 | 4.8 | ≈ $1.74 |
| `deploy.yml` | 41 | 2.3 | ≈ $0.41 |
| **Total** | | | **≈ $5.15/month** |

`coverage.yml` (#772) is not in these tables: it is scheduled weekly (and on demand), never per PR.
A full instrumented run took about 13 minutes on a shared server (#772), so roughly 14 billed
minutes per run, about 4 runs a month, about $0.34/month private-equivalent at $0.006/minute
(at most $0.24 per run under its 40-minute timeout).

That's pocket change against any paid plan's included Actions-minutes allowance —
*if* the allowance is actually available (see the caveat in "Method," above).

## Where the time actually goes (the "dominant parts")

`ci.yml`, by step (avg seconds):

| Step | Avg |
|---|---:|
| Test (vitest) | 53.2 s |
| Build (vite) | 12.6 s |
| Typecheck (strict DAG) | 8.8 s |
| Install (`npm ci`) | 7.3 s |
| setup-node / checkout | ~3.6 s |

`smoke.yml`, by step (avg seconds):

| Step | Avg |
|---|---:|
| Build, serve and smoke the bundle | 30.8 s |
| Install the harness + Chromium | 22.5 s (occasionally much higher on a cold Playwright cache — the 364 s outlier) |
| Install the app (`npm ci`) | 7.7 s |
| setup-node / checkout | ~3.8 s |

So: `ci.yml`'s cost is dominated by the vitest run itself (the suite is genuinely
being exercised, not overhead); `smoke.yml`'s cost is dominated by standing up a
disposable Chromium, which is pure fixed overhead paid on every run regardless of
what the test asserts.

## Gating: cheap by default, expensive opt-in

Given the numbers above, the two workflows don't need the same trigger policy:

- **`ci.yml`** (typecheck/test/build) is the cheap, fast, always-useful signal —
  ~$0.012/run, ~90 s. It stays on every `pull_request` and every `push` to `main`,
  unchanged.
- **`smoke.yml`** (browser smoke) pays a fixed Chromium-install tax on every run
  regardless of what changed. Since #476 it runs where its signal is load-bearing
  and on the PRs that can change it:

  | Trigger | Runs smoke? |
  |---|---|
  | Push to `main` | **yes** — the commit that's about to deploy |
  | `workflow_dispatch` (Actions tab, or `gh workflow run smoke.yml`) | **yes** — on demand |
  | Pull request touching `src/`, `packages/`, `smoke/`, `public/`, `package.json`, `package-lock.json`, `extensions*.json`, `vite*.ts` or the workflow itself | **yes** — on open, push and reopen |
  | Any other pull request (docs, scripts, other workflows) | **no** — the workflow never starts (a `paths` filter: no runner, no bill, and no check reported) |

  Why: with smoke main-only, two regressions sat red on `main` across six merges
  because every worker gated on a PR whose checks were all green. The cost is one
  smoke run (about 85 s, 2 billed minutes, about $0.012 on a private repo) per push to a
  code-touching PR, roughly doubling smoke's share of the monthly bill (still pocket
  change, see above). The `ci-full` label and `[ci-full]` title opt-in are gone: a
  path-filtered workflow cannot be forced on a docs-only PR, and every code PR now runs it.

  **Caveat:** a skipped path-filtered workflow reports no check. If the smoke check
  is ever made *required* (branch protection, #388), a docs-only PR would wait
  forever for it; that needs a no-op twin job or a different gate then.

- **`deploy.yml`** already only runs on push to `main` with `paths-ignore` for
  docs/config-only changes, and its own job (`trigger-deploy`, a `gh workflow run`
  dispatch) costs ~$0.006/run. No change needed; it was never the expensive part.

## Re-running this measurement

```bash
gh api repos/thorwhalen/thoremin/actions/workflows --jq '.workflows[] | {id,name,path}'
gh run list --workflow=ci.yml --limit 20 --json databaseId -q '.[].databaseId'
gh api repos/thorwhalen/thoremin/actions/runs/<id>/jobs --jq '.jobs[] | {name, started_at, completed_at, steps}'
```

Sum `completed_at - started_at` per job across a sample, round each job's total up to
the next whole minute, multiply by the current per-minute rate at
[docs.github.com/en/billing/concepts/product-billing/github-actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
Re-run this whenever the workflows change materially, or before any future
visibility decision.
