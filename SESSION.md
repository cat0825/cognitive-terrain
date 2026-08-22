# Handoff 2026-08-22 17:55 +08:00

> **这是快照，不是状态源。** 本文件对应远端 `origin/main` commit `c946d79f0d6f1e5dc45aa7d607f2f6f7e2842c0a`。
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
| 审查台账与依赖决策 | #48 | PR #68 `c946d79` |
| 用户实测的五个界面问题 | — | 本次工作，分支 `fix/reported-ui-regressions` |

## 门禁

本地在 `fix/reported-ui-regressions` 实测：typecheck、lint、`npm test` 47 files / 348 tests、build、
`size:check` 主包 352.7 KiB / JS 总量 2375.0 KiB / CSS 49.0 KiB、`test:e2e` 48 passed / 4 skipped、
`test:a11y` 16 passed、`test:visual` 4 passed（darwin 基线已重录）、`test:perf` ok。

**CI 的 visual job 已移除**，改为纯本地工具。它按平台存基线，CI 跑 `ubuntu-latest`，
需要一套没有真实用户会看到的 Linux 基线；而它对用户报的 5 个布局问题全绿放过，
维护成本却真实存在。完整理由、残余风险与复核条件见台账 A5，恢复方式见
[`tests/visual/baselines/README.md`](tests/visual/baselines/README.md)。
CI 现在跑 5 个 job：quality、e2e desktop、e2e mobile、a11y、perf。

CI 最后一次全绿是 PR #67。本分支尚未推送，CI 未跑过。

## 已知边界

- `npm audit --omit=dev` 4 个 high（`adm-zip`、`sharp`，经 `@huggingface/transformers` 传入）
  已 accepted，理由与复核条件见台账 A2；核对过它们不进 `dist/`。
- 导入上限 2,000 条；10k/50k 规模未验证，见台账 A4。
- a11y 本地并行满跑偶发单用例 flake，单独重跑与 CI 均通过，见台账 A3。
- `output/` 与 `*.tmp.mjs` 已全部 ignore，决策见台账"`output/` 目录决策"。
- demo 数据里 `interactionEvents` 为空、`cognitiveObservations` 只覆盖前 2 条笔记，
  所以「温度」和「学习进程」两个维度在 demo 里偏平。这是 fixture 数据空缺，不是维度实现缺陷：
  8 个维度都已验证留在 3D 画布且标签不塌陷（`tests/e2e/reported-ui-regressions.spec.ts`）。
  「学习进程」现在带覆盖度图例（`2 条有显式观测 · 1798 条回落中性海拔`），把"平"说成数据事实而不是留给用户猜。
  补 demo 事件解决不了「温度」：fixture 时间戳钉在 `2025-12-31`，隔 235 天后 `opened` 热度衰减到
  `0.5^33.6 ≈ 7e-11`，照样是平的；要让它有起伏就得用 `Date.now()` 相对时间，
  那会破坏 `src/domain/activity-elevation.ts:17` 要求的确定性和视觉基线，因此没做。
- `size:check` 目前**三项都顶在预算线上**（JS 2375.0/2375、CSS 49.0/49）。下一个改动只要增体积就会红；
  届时请在 `scripts/size-budget.mjs` 里连同"是什么吃掉的"一起抬，不要静默放宽。

## 风险/红线

- 不删除、回滚或覆盖不属于当前任务的未提交改动。
- 不直接推 `main`，只走 feature branch + PR。
- 不要因 `git worktree list` 或 `git branch --no-merged` 里有旧分支就判断 PR 未完成；
  以 GitHub 开放 PR 列表为准。历史 worktree 与遗留本地分支均未清理，内容已由对应 PR 合并。
