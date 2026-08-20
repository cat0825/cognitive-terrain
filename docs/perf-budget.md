# Performance budget

The perf gate (`npm run test:perf`) measures six interaction scenarios and fails
when any of them falls outside the budget in `scripts/perf-budget.mjs`.

## Why the gate asserts at all

It previously printed timings and asserted only on canvas pixels, export size,
and console errors. No frame-rate regression could fail it, so it was a report
rather than a gate. It also required an operator to start `npm run preview` in
another terminal, which the audit recorded as a perf "failure" that was only a
forgotten server.

The gate now starts and stops its own preview server, on an OS-assigned free port
bound to `127.0.0.1`. The old hardcoded `4174` collided with long-lived local dev
servers, and `vite preview` binds localhost/IPv6 by default, so a script
targeting `127.0.0.1` got `ECONNREFUSED` even with a server running.

Set `BASE_URL` to point the gate at an already-running server; it then leaves
server lifecycle alone.

## Measured baseline

macOS 26.5.2, Apple M1 Pro, Chrome headless, 1440x960 at DPR 1.5, demo project
(1800 notes):

| Scenario | fps | p95 (ms) | frames > 33.3ms |
| --- | --- | --- | --- |
| idle | 120 | 9.2 | 0 |
| playback | 120 | 9.2 | 0 |
| orbit | 120 | 9.3 | 0 |
| syntheticScrub | 120 | 9.2 | 0 |
| directStoreScrub | 120 | 9.1 | 0 |
| pointerScrub | 120 | 9.3 | 0 |

Export size at this baseline is ~916 KB, well above the 10 KB floor that
distinguishes a real export from a blank one.

## Why the thresholds are loose

The budget sits far below the local baseline on purpose. CI runners are shared,
virtualised, and software-rendered, so absolute frame times vary much more than
they do on a developer machine. A budget tuned to the local numbers would fail
on runner noise, and a gate that cries wolf gets ignored — which is how the
project arrived at an unreproducible perf step in the first place.

Two independent limits are used per scenario:

- `minFps` guards sustained throughput.
- `maxOver33Ms` guards visible stutter. A frame over 33.3ms is a dropped frame at
  30fps, and a burst of those hurts perceived smoothness more than a slightly
  lower average, so a good average cannot mask it.

Scrub scenarios get more slack because they intentionally drive the timeline as
fast as the browser accepts, making them the heaviest paths by design.

### Hosted CI without a GPU

The `perf` job runs Chrome on a hosted Linux runner without a hardware GPU. It
sets `PERF_SOFTWARE_RENDERING=1`, which selects a separate budget and a bounded
software-rendering profile: 960x640 at DPR 1, low rendering quality, 30 orbit
steps, 40 pointer-scrub steps, a three-minute timeout per scenario, and a
60-second PNG-download timeout. The previous GPU-sized profile took 1,071
seconds before reaching export because hundreds of pointer events each forced a
CPU-rasterised frame. This is an environment declaration, not a developer
override: local runs keep the 1440x960 DPR 1.5 strict profile unless that
variable is explicitly set.

| Scenario | minimum FPS | maximum frames over 33.3ms |
| --- | ---: | ---: |
| idle | 2 | 2,000 |
| playback / orbit | 1 | 3,000 |
| scrub scenarios | 1 | 4,000 |

These values are intentionally low because SwiftShader can take two orders of
magnitude longer than the local GPU-backed baseline. They still fail a stalled
scene (`0.1 FPS` or `99,999` long frames), missing measurements, non-finite FPS,
canvas pixel checks, console errors, and an undersized PNG. The CI job also has a
15-minute hard timeout so a renderer regression cannot occupy a runner forever.

## Changing a threshold

1. Establish the new baseline on an unloaded machine and record host, GPU, and
   browser version.
2. Confirm the change is a real product change, not noise: repeat the run and
   check the variance is small relative to the shift.
3. Update `scripts/perf-budget.mjs` and the baseline table above in the same
   commit, and state in the commit message why the previous threshold no longer
   describes intended behaviour.

Loosening a threshold to make a red gate green, without explaining the underlying
change, defeats the gate.

## The gate builds if it has to

`vite preview` serves whatever is in `dist/`, and it starts happily with nothing
there: it binds the port and answers 404. The first CI run of this gate failed
with `Preview server did not become ready within 120000ms (HTTP 404)`, which
pointed at the server when the real cause was a missing build.

The other browser gates never hit this because their Playwright `webServer`
command is `npm run build && npm run preview`. This gate owns its own server, so
it now owns the build too: `startPreviewServer` runs `npm run build` when
`dist/index.html` is absent, and reuses an existing build otherwise so a local run
straight after a build does not pay twice.

A persistent 404 during the readiness probe is also reported as an empty-`dist/`
problem immediately, rather than being retried for the full two minutes and then
blamed on startup.
