# Handoff 2026-08-21 18:05 +08:00

> **这是快照，不是状态源。** 本文件对应远端 `origin/main` commit `dc0ecd1eccdd59e66cfe1ed4b72c56856466620c`。
> 任何"当前状态"判断都必须重新执行 `git fetch --prune origin`、`git status`、`gh pr list`、`gh issue list`；
> 与现场冲突时以现场为准。禁止在 PR、Issue 或 review 中把本文件当作现状依据。
> 约定来源见 [`docs/review/findings-ledger.md`](docs/review/findings-ledger.md) 的"交接文档约定"。

## 目标

Cognitive Terrain 的续跑检查点：milestone `v1.3 - Reliability and Reproducibility` 的收尾状态。

## 进度

v1.3 的审查整改已全部落地。审查（[`docs/review/2026-08-18-independent-audit.md`](docs/review/2026-08-18-independent-audit.md)）提出的
H1-H3、M1-M4、L1-L2 逐条状态见 [`docs/review/findings-ledger.md`](docs/review/findings-ledger.md)。

| 阶段 | Issue | 状态 |
| --- | --- | --- |
| H1-H3 可靠性修复 | — | PR #52 `9e073ee` |
| 视觉基线漂移 | #46 | PR #53 `acb08ad` |
| 未来事件 | #41 | PR #54 `f3f677e` |
| gap 评估时间 | #42 | PR #56 `b8d11af` |
| atlas taxonomy 快照 | #43 | PR #65 `bb6d315`（ADR-004） |
| vault-sync 事务边界 | #47 | PR #59 `9377382` |
| 导入上限与预检 | #44 | PR #64 `6873f95` |
| perf 门禁自启动并进 CI | #45 | PR #61/#62/#63 |
| core/derived 拆分与版本元组 | #49 | PR #66 `fa0e60c`（ADR-005） |
| 视觉维度契约与准入门禁 | #50 | PR #67 `dc0ecd1`（ADR-006） |
| 审查台账与依赖决策 | #48 | 本次工作 |

## 门禁

本地在 `dc0ecd1` 实测：typecheck、lint、`npm test` 45 files / 336 tests、build、
`size:check` 主包 352.0 KiB、`test:e2e --project=desktop` 21 passed / 1 skipped、
`test:a11y` 16 passed、`test:visual` 4 passed、`test:perf` ok。

CI 在 PR #67 上 changes / quality / e2e desktop 1-4 / e2e mobile 1-2 / a11y / visual 全绿，
perf 因纯语义层改动被 skip。

## 已知边界

- `npm audit --omit=dev` 4 个 high（`adm-zip`、`sharp`，经 `@huggingface/transformers` 传入）
  已 accepted，理由与复核条件见台账 A2；核对过它们不进 `dist/`。
- 导入上限 2,000 条；10k/50k 规模未验证，见台账 A4。
- a11y 本地并行满跑偶发单用例 flake，单独重跑与 CI 均通过，见台账 A3。
- `output/` 与 `*.tmp.mjs` 已全部 ignore，决策见台账"`output/` 目录决策"。

## 风险/红线

- 不删除、回滚或覆盖不属于当前任务的未提交改动。
- 不直接推 `main`，只走 feature branch + PR。
- 不要因 `git worktree list` 或 `git branch --no-merged` 里有旧分支就判断 PR 未完成；
  以 GitHub 开放 PR 列表为准。历史 worktree 与遗留本地分支均未清理，内容已由对应 PR 合并。
