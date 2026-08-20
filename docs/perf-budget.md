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
