# Visual baselines

**This is a local-only tool. CI does not run it.**

`npm run test:visual` diffs a screenshot against a stored baseline and fails
above a `0.002` changed-pixel ratio. Baselines are per-`process.platform`, and
only `*-darwin.png` exists: the `-linux.png` set was deleted in
`fix/reported-ui-regressions` along with the `visual` CI job.

## Why CI does not run this

The gate compared against a Linux baseline that no user ever sees — the app ships
to browsers via Cloudflare Workers, and the `-linux.png` files existed purely so
the `ubuntu-latest` runner had something to diff against. Font rasterisation
differs per OS, so that second baseline set could never be recorded locally; it
had to be harvested from an intentionally-failed CI run.

The cost was real and the catch rate was zero:

- Every UI bug found in this repo so far was found by a human opening the page.
  The five reported layout bugs fixed in `fix/reported-ui-regressions` all went
  undetected here — `desktop-note-details` clicks a peak label and screenshots,
  yet its pre-fix baseline shows every label intact, because the bug triggered on
  clicking a *point* and on switching visual dimension, states no case covers.
- Two self-inflicted occlusion regressions in that same branch were caught by
  screenshotting the page, not by this gate.
- Its own output was maintenance: issue [#46](https://github.com/cat0825/cognitive-terrain/issues/46)
  existed only because darwin baselines drifted, and a single intentional layout
  change reddens all six cases at once, which is indistinguishable from breakage.

**What this accepts:** a commit that silently moves the layout, in a session where
nobody opens the page, now has nothing stopping it. The compensating control is
the project rule that frontend changes are verified by opening and screenshotting
the affected pages. That rule has a better record than this gate did.

Reinstating the job means restoring it in `.github/workflows/ci.yml` and
harvesting a `-linux.png` set from a deliberately-red run's
`visual-failure-artifacts`, where `compareScreenshot` writes
`<case>-linux-current.png`. Do not record them in a
`mcr.microsoft.com/playwright` container to avoid that round trip: CI ran bare
`ubuntu-latest` with `npx playwright install-deps chromium`, and a missing host
font set alone moved the ratio to 0.0055, so a container's different CJK font set
would fail CI while claiming to be CI-accurate.

## Recording locally

`UPDATE_BASELINES=1 npm run test:visual` overwrites **every** baseline for the
current platform, including cases that were passing. Restore the untouched
files before committing so the diff only contains baselines that actually
drifted:

```bash
UPDATE_BASELINES=1 npm run test:visual
git checkout -- tests/visual/baselines/<passing-case>-darwin.png
npm run test:visual   # must be green without UPDATE_BASELINES
```

The `0.002` diff-ratio threshold in `tests/visual/stability.spec.ts` is the
regression gate. Do not raise it to absorb a diff; either stabilize the test
setup or re-record with provenance recorded below.

## Provenance

| Date | Platform | Cases | Host | Reason |
| --- | --- | --- | --- | --- |
| 2026-08-18 | linux | `desktop-note-details`, `vault-collision-mobile` | CI (ubuntu-latest) | PR #22 terrain evidence inspector changed the note-detail and collision panels. Darwin baselines were not refreshed in the same commit (`6d932d1`), which is the drift #46 tracks. **Deleted 2026-08-22** with the `visual` CI job. |
| 2026-08-19 | darwin | `desktop-note-details`, `vault-collision-mobile` | macOS 26.5.2, Apple M1 Pro, Playwright 1.62.1 Chromium | Closes the platform gap left by `6d932d1`. Diff ratios were 0.0145 and 0.0164 and reproduced identically across runs and on a clean `origin/main` worktree, so this is a real rendering change from PR #22, not non-determinism. |
| 2026-08-22 | darwin | all six: `desktop-overview`, `desktop-note-details`, `peak-labels-desktop`, `peak-labels-mobile`, `vault-collision-desktop`, `vault-collision-mobile` | macOS 26.5.2, Apple M1 Pro, Playwright 1.62.1 Chromium | Reported UI fixes: `.note-detail` became a right sidebar, `.utility-dock` moved off its percentage anchor, and the demo project now ships with its reference atlas selected so the ocean overlay is visible. Ratios were 0.0025 / 0.0261 / 0.0055 / 0.0089 / 0.0183 / 0.0350 — every case drifted, so nothing was restored. The three overview/label cases drifted from the ocean overlay alone; the note-detail and vault-collision cases from the sidebar reposition. |
| 2026-08-22 | linux | all six, **deleted** | — | The `visual` CI job was removed rather than refreshing these from CI artifacts. Rationale above. |
