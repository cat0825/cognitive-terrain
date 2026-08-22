# Visual baselines

Each case stores one baseline per `process.platform`: `<name>-darwin.png` and
`<name>-linux.png`. CI only runs Linux, so a Linux-only refresh leaves the
darwin baselines stale and the local `npm run test:visual` red while CI stays
green. Refresh both platforms, or record the platform gap here.

## Recording

`UPDATE_BASELINES=1 npm run test:visual` overwrites **every** baseline for the
current platform, including cases that were passing. Restore the untouched
files before committing so the diff only contains baselines that actually
drifted:

```bash
UPDATE_BASELINES=1 npm run test:visual
git checkout -- tests/visual/baselines/<passing-case>-<platform>.png
npm run test:visual   # must be green without UPDATE_BASELINES
```

The `0.002` diff-ratio threshold in `tests/visual/stability.spec.ts` is the
regression gate. Do not raise it to absorb a diff; either stabilize the test
setup or re-record with provenance recorded below.

## Refreshing the platform you are not on

Do not record Linux baselines in a `mcr.microsoft.com/playwright` container to
avoid a push. The visual job runs on bare `ubuntu-latest` with
`npx playwright install-deps chromium`, and the workflow comment above that step
records that a missing host font set alone moved the ratio to 0.0055 — a
different Ubuntu image has a different CJK font set, so container-recorded
baselines would still fail CI while claiming to be CI-accurate.

Take them from CI instead. The visual job uploads `tests/visual/diffs/` as
`visual-failure-artifacts` on failure, and `compareScreenshot` writes
`<case>-<platform>-current.png` there, so one intentionally-red run produces the
Linux renders:

1. Push the branch with only the local platform's baselines refreshed.
2. Download `visual-failure-artifacts` from the failed `visual` job.
3. Copy each `tests/visual/diffs/<case>-linux-current.png` over
   `tests/visual/baselines/<case>-linux.png`, drop the `-current` suffix, and
   commit. Only copy cases the job actually reported.
4. Re-run the job; it must be green with no `UPDATE_BASELINES`.

## Provenance

| Date | Platform | Cases | Host | Reason |
| --- | --- | --- | --- | --- |
| 2026-08-18 | linux | `desktop-note-details`, `vault-collision-mobile` | CI (ubuntu-latest) | PR #22 terrain evidence inspector changed the note-detail and collision panels. Darwin baselines were not refreshed in the same commit (`6d932d1`), which is the drift #46 tracks. |
| 2026-08-19 | darwin | `desktop-note-details`, `vault-collision-mobile` | macOS 26.5.2, Apple M1 Pro, Playwright 1.62.1 Chromium | Closes the platform gap left by `6d932d1`. Diff ratios were 0.0145 and 0.0164 and reproduced identically across runs and on a clean `origin/main` worktree, so this is a real rendering change from PR #22, not non-determinism. |
| 2026-08-22 | darwin | all six: `desktop-overview`, `desktop-note-details`, `peak-labels-desktop`, `peak-labels-mobile`, `vault-collision-desktop`, `vault-collision-mobile` | macOS 26.5.2, Apple M1 Pro, Playwright 1.62.1 Chromium | Reported UI fixes: `.note-detail` became a right sidebar, `.utility-dock` moved off its percentage anchor, and the demo project now ships with its reference atlas selected so the ocean overlay is visible. Ratios were 0.0025 / 0.0261 / 0.0055 / 0.0089 / 0.0183 / 0.0350 — every case drifted, so nothing was restored. The three overview/label cases drifted from the ocean overlay alone; the note-detail and vault-collision cases from the sidebar reposition. **Linux is stale on this commit and the visual job will fail** — refresh it from that run's `visual-failure-artifacts` per "Refreshing the platform you are not on" above. Recorded here rather than left implicit because this is the mirror image of the `6d932d1` gap. |
