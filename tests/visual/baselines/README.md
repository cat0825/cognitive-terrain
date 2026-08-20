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

## Provenance

| Date | Platform | Cases | Host | Reason |
| --- | --- | --- | --- | --- |
| 2026-08-18 | linux | `desktop-note-details`, `vault-collision-mobile` | CI (ubuntu-latest) | PR #22 terrain evidence inspector changed the note-detail and collision panels. Darwin baselines were not refreshed in the same commit (`6d932d1`), which is the drift #46 tracks. |
| 2026-08-19 | darwin | `desktop-note-details`, `vault-collision-mobile` | macOS 26.5.2, Apple M1 Pro, Playwright 1.62.1 Chromium | Closes the platform gap left by `6d932d1`. Diff ratios were 0.0145 and 0.0164 and reproduced identically across runs and on a clean `origin/main` worktree, so this is a real rendering change from PR #22, not non-determinism. |
