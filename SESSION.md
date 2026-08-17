# Handoff 2026-08-17 18:40 CST

## 目标

按 GitHub Issue/PR 驱动推进 Cognitive Terrain。当前实现
[Issue #22](https://github.com/cat0825/cognitive-terrain/issues/22)：可检查的地形语义与证据检查器；
采用堆叠 PR，base 为 #8 分支 `codex/exploration-feedback-loop`。

## 进度

- Issue #22 实现、验收、提交、推送与 stacked PR 均已完成：
  [PR #32](https://github.com/cat0825/cognitive-terrain/pull/32)。
- 当前分支 `codex/terrain-evidence-inspector`，实现 commit `67cc548`，基于 #31 commit `55f3ae7`。
- #30 与 #31 仍 open；无需等待远端长耗时 CI 才提交当前 stacked PR。

## 已完成

- 新增版本化 terrain evidence contract，覆盖平面位置、峰、海拔、颜色、
  overlay、板块、碰撞和 reference-relative gap 八类语义。
- 邻居证据分开显示原始 cosine、rank、model/formula、近似 UMAP 二维距离、
  taxonomy、tags 和显式 WikiLink；fallback 明示为非等价语义证据。
- 分析阶段复用 UMAP KNN 候选生成 `noteNeighborEvidence`，不新增第二次全量
  高维两两计算；布局算法版本固定为 `umap-js-2d-v1`，与 model ID 分离。
- IndexedDB 升至 v8；project bundle、materialized stores、backup/restore、
  reload 和 reanalysis 均保留邻居证据。
- 2D/3D 共用图例与 evidence contract；笔记、邻居、峰、碰撞、gap 均有选择路径，
  峰和 gap 支持键盘选择，详情切换会重置滚动位置。
- 修正 activity 只控制海拔、temperature 控制活动颜色，mastery/exploration/activity
  继续使用 taxonomy 领域颜色。
- 抽出轻量 `layout-version`，避免 schema-v3 为版本常量把 UMAP 算法库拉进持久化 chunk。

## Fresh 验证

- focused Vitest：10 files / 81 tests passed。
- `npm run typecheck`、targeted Oxlint、`npm run build`、`git diff --check` 通过。
- `npm run size:check`：主包 334.1/340 KiB，JS 2241.1/2250 KiB，CSS 40.0/40 KiB。
- focused Playwright：desktop/mobile 2/2 passed（12.7s），覆盖 legend、gap、
  note→neighbor、2D peak、2D→3D contract、键盘与横向溢出。
- focused Axe：desktop/mobile 2/2 passed（14.2s），扫描 legend、gap 与 neighbor detail；
  沿用项目现有边界，未把 `color-contrast` 计入该门禁。
- 已实际检查 `output/playwright/terrain-evidence-inspector-{desktop,mobile}.png`；
  legend、reference ocean、camera rail 与 detail panel 无重叠。

## 未完成

1. 跟踪 PR #32 的 CI / reviewer；可修复反馈继续提交到同一分支。
2. #30 与 #31 合并后，将 PR #32 retarget 到 `main`。
3. 无需等待远端长耗时 CI 才继续下一个独立 issue。

## 风险 / 红线

- 不直接推 `main`；一个实施 Issue 对应一个 feature branch 和一个 PR。
- PR #30/#31 合并后，将 #22 PR retarget 到 `main`。
- 地图位置、embedding 相似度、显式关系、taxonomy 与参考缺口继续分开；
  不从投影位置推断因果、先修顺序、权威学科或用户能力。
