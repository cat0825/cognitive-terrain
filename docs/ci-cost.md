# CI cost and shape

## Why this document exists

The project burned roughly 480 minutes of Actions time across 20 runs (~28 min
each) and hit the account spending limit, which stopped every job in 3-4 seconds
with a billing error. That looked like six broken pull requests. It was not: the
pipeline was healthy, and PR #54 had passed all six jobs shortly before.

The repository is now public, so Actions minutes are free and unmetered. Cost is
no longer the binding constraint — wall-clock feedback time is. The changes below
were kept because they shorten the critical path, not merely the bill.

## Measured baseline

From run 32129790429 on `main`, per step:

| Job | Total | npm ci | browser install | test run |
| --- | --- | --- | --- | --- |
| quality | 1m51s | 18s | — | 51s (unit) + 14s build |
| visual | 3m34s | 31s | 60s | 109s |
| a11y | 5m21s | 24s | 55s | 223s |
| e2e desktop 1/2 | 5m27s | 8s | 33s | ~290s |
| e2e desktop 2/2 | 7m18s | 23s | 33s | 359s |
| e2e mobile | 6m17s | 16s | 58s | 291s |

This contradicted the obvious assumption. Setup is cheap: `npm ci` is 8-31s and
the browser install 33-60s. **The test run dominates**, at 109-359s. Optimising
installs would have saved almost nothing.

## Changes and their reasoning

**Shard e2e more widely (desktop 2 -> 4, mobile 1 -> 2).** The critical path was
a single 359s shard. Splitting the work shortens it; a locally verified 4-way
desktop shard runs in 46s.

**Worker count deliberately unchanged.** CI still runs `workers: 1`. Commit
`cab8cba test: stabilize browser checks across CI` reduced CI from `workers: 2`
because parallel WebGL runs were unstable. Raising it again would trade a known
flake for speed, which is the wrong direction for a project whose audit called
out untrustworthy gates. Sharding adds parallelism *between* processes while
leaving in-process behaviour identical.

**Cancel superseded PR runs.** There was no `concurrency` block, so pushing a
fixup left the previous run to finish its whole matrix for a result nobody would
read. Pushes to `main` are excluded, so the default branch keeps a complete
history of verified commits.

**Skip browser gates on docs-only changes.** Implemented as a `changes` job whose
output the browser jobs check, *not* as a workflow-level `paths-ignore`. Filtering
the workflow leaves required checks pending forever on a docs-only PR, blocking
the merge instead of speeding it up.

The filter treats anything outside `docs/`, `*.md`, and issue templates as
app-affecting. It errs toward running the gates, so a pattern nobody anticipated
cannot silently skip coverage. Verified against `src/`, `tests/`, `scripts/`,
`package.json`, `playwright.config.ts`, visual baselines, and the workflow file
itself — all correctly classified as app-affecting, including a mixed docs+code
change.

**Run perf only on `main`.** It is the slowest gate and the most sensitive to
runner noise. A PR touching rendering can still run `npm run test:perf` locally,
which is now self-contained (see `docs/perf-budget.md`).

## What was explicitly not done

- Sharing one build across browser jobs. Each Playwright config builds via its
  own `webServer`, and build is only 14s. Coupling the jobs to a shared artifact
  would add failure modes to save seconds.
- Reducing retries. `retries: 1` on CI absorbs genuine runner flakiness; removing
  it would produce red runs that say nothing about the code.

## Browser install: what the first public-repo run taught us

The retry wrapper worked as designed on its first real outing — it detected a
192-second silent stall and aborted instead of consuming the job timeout. But the
two remaining attempts then failed in 2 seconds each:

```
E: Could not get lock /var/lib/apt/lists/lock. It is held by process 2308 (apt-get)
Error: Installation process exited with code: 100
```

That was a genuine bug in the wrapper. `playwright install --with-deps` runs
apt-get as a *grandchild*, and killing only the direct child left apt alive
holding the package lock, poisoning every retry. Fixed by spawning with
`detached: true` and signalling the whole process group. A regression test spawns
a silent parent with a surviving grandchild and asserts the grandchild does not
outlive the abort; it fails with `detached` removed, which is how the fix was
confirmed rather than assumed.

The install step was also split, so a stalled mirror cannot block the browser
download itself:

- `install-deps` runs on its own, unconditionally, and must succeed.
- Browsers download with plain `playwright install` — no `--with-deps`, so no apt
  and no lock to wedge.

### A wrong turn worth recording

The first attempt skipped `install-deps` on a browser-cache hit and marked it
`continue-on-error`, reasoning that the runner image already ships Chromium's
dependencies. The visual gate went red:

```
Expected: < 0.002
Received:   0.005551215277777778
```

Two mistakes in one change. The browser cache holds *binaries*, not the host's
font and rendering libraries, so a cache hit says nothing about whether those are
present — the condition was checking an unrelated fact. And `continue-on-error`
on a step that affects rendering output converts a hard failure into a silent
change in test results, which is exactly the kind of untrustworthy gate this
milestone exists to remove.

The diff was small (0.0055 versus the 0.0145 of the genuine drift in #46), which
is what identified it as a rasterisation difference rather than a product change.
`install-deps` now always runs and must succeed.
