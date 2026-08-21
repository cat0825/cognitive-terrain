# Import budget

## Enforced limits

| Resource | Limit | Failure behaviour |
| --- | ---: | --- |
| One note file | 4 MiB | reject before `File.text()` |
| One `.terrain.json` bundle | 64 MiB | reject before JSON parse |
| Selected files | 500 | reject before parse |
| Selected bytes | 32 MiB | reject before parse |
| Records | 2,000 | show count and block analysis until user trims |
| One note body | 64 KiB | show file/row and actual vs allowed |
| Parse concurrency | 4 | bounded worker pool; each file yields to the browser |

These are product limits, not a promise that every device completes the maximum
in a fixed time. They prevent a picker mistake from allocating unbounded parsing
work or immediately starting a full embedding/UMAP pass.

## Pre-flight contract

`parseImportFiles()` completes parsing and normalization without starting the
analysis worker. It returns a report containing file/byte/record scale, duplicate
IDs, invalid timestamps, future timestamps, unresolved taxonomy labels, and rough
deterministic/semantic time estimates. Unknown taxonomy labels and future times
are warnings; resource violations and duplicate IDs block the **生成地形** action.

The UI exposes the actual and allowed values for every resource rejection. The
user may cancel parsing, or explicitly choose **按上限整理**. That action removes
duplicate-ID repeats, truncates note bodies to 64 KiB, and keeps the first 2,000
records. No partial project is committed during parsing or pre-flight.

## Cancellation budget

Cancellation is checked before every queued file and after each `File.text()`;
each completed file yields through a timer task. On a normal browser this bounds
cancel acknowledgement to the current file read plus one event-loop turn. A
browser's `File.text()` implementation remains an external operation, so the
application does not claim a hard millisecond guarantee for a single large file.

## Benchmark fixture

The acceptance fixture is the deterministic demo project: 1,800 notes, analyzed
with the existing worker and rendered through the e2e/perf gates. On the local
M1 Pro baseline recorded in [`docs/perf-budget.md`](perf-budget.md), the strict
perf gate reports about 120 FPS and a 916 KiB PNG export. The 2,000-record limit
adds a small bounded margin over that fixture; 10k/50k imports remain explicitly
unsupported and are not described as measured.

The unit suite covers rejection messages, record/body limits, duplicate IDs,
unknown taxonomy warnings, bounded concurrency, cancellation, and explicit trim
behaviour in `tests/unit/import-limits.test.ts`.
