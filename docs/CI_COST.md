# What CI would cost if this repo were private

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
  regardless of what changed. It is now **opt-in on pull requests**, and
  unconditional only where its signal is load-bearing:

  | Trigger | Runs smoke? |
  |---|---|
  | Push to `main` | **yes** — the commit that's about to deploy |
  | `workflow_dispatch` (Actions tab, or `gh workflow run smoke.yml`) | **yes** — on demand |
  | Pull request carrying the `ci-full` label, or `[ci-full]` in its title | **yes** — add the label (or edit the title) when a PR touches anything the gate can't see: `useEngine`, the audio graph, overlay rendering, the tools/settings shell, recording |
  | Ordinary pull request push, no opt-in | **no** — skipped (a grey "skipped" check, not a failure — easy to miss if you're not looking for it) |

  The condition is a plain `if:` on the `smoke` job itself (no separate job): GitHub
  Actions bills nothing for a job it skips before starting a runner, so an ordinary
  PR pays nothing extra for opting out. `labeled`/`unlabeled`/`edited` are in the PR
  trigger types so toggling the label or editing the title re-evaluates the
  condition without needing a new push.

  **Trade-off this makes on purpose:** most PRs no longer get an automatic browser
  verdict *before* merge — only `ci.yml`'s typecheck/test/build does. The browser
  smoke still runs automatically right after merge (on push to `main`), in parallel
  with `deploy.yml`; it does not block that deploy (advisory, no branch protection),
  so a regression the gate can't see could still reach production before smoke
  reports on it. Use the `ci-full` label on a PR when that risk isn't acceptable for
  the change in hand.

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
