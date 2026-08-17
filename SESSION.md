# Handoff 2026-08-17 16:25 CST

## 目标

按 GitHub Issue/PR 驱动推进 Cognitive Terrain。当前只执行
[Issue #6](https://github.com/cat0825/cognitive-terrain/issues/6)：activity elevation 与
reference-atlas gap/ocean；完成并合并后进入
[Issue #8](https://github.com/cat0825/cognitive-terrain/issues/8)。

## 进度

- v1.1 实施项 9/11 完成；剩余 #6、#8，路线图为
  [Issue #9](https://github.com/cat0825/cognitive-terrain/issues/9)。
- 当前分支 `codex/activity-elevation-gaps`，HEAD `bcc2e87`，相对
  `origin/main@cdb28d2` ahead 1 / behind 0。
- #6 实现与本地验收已完成，综合约 98%；仅剩提交、推送与创建 PR。
- GitHub 共 9 个 PR，全部 merged；最新 main CI run `31981024691` 全绿。

## 已完成

- #1、#2、#3、#4、#5、#7、#10、#11、#14 均已通过独立 PR 合并。
- #6 已完成 versioned activity elevation、raw/aggregate evidence、2D/3D profile、
  reference-atlas gap/ocean、选择持久化、地图/PNG 非空间摘要及详情证据 UI。
- demo reference atlas 只包含 7 个预期节点，项目 taxonomy 另保留 `Agent 系统`，
  避免把既有领域声明变成未解析标签；默认仍不选 atlas。
- atlas 选择使用乐观 UI，并以轻量 `projects` / `workspaces` 更新替代重写 1800 条
  materialization；demo 的纯视图偏好同步保存在 localStorage。
- 用户最初的 12 组产品设想已完成 GitHub 归档：
  - #6：温度、海拔、山脉/海洋边界与 atlas-relative gap。
  - #8：从静态展示转为“人脑缓存”维护与探索闭环。
  - #22：位置、峰、海拔、颜色、碰撞、gap 的指标解释器。
  - #23 / #24：Obsidian 增量同步与 opt-in diff-first 写回。
  - #25：显式 prerequisite topology、基础地层与分支渐变。
  - #26：纵向学习曲线与 learning-progression elevation。
  - #27：只使用公开/授权材料的数学双链工作流研究。
  - #28：模糊度、类别渐变、地质/生态/外太空视觉实验，置于 icebox。
  - #29：v1.2 Knowledge Workbench 依赖路线图。
- 2026-08-17 fresh audit 已将原始设想覆盖矩阵写入 #29，并在 #28 明确补入
  “YAML exploration 与 confidence/uncertainty 分开比较视觉通道，不得冒充 mastery”。

## Fresh 验证

- `npm run test:unit`：20 files / 119 tests passed；后续边界修复的 focused unit
  继续通过（activity/terrain 15 tests、demo/reference 5 tests）。
- 全量 E2E：29 passed / 1 skipped，2 个 taxonomy fixture 失败；修复 fixture 后仅重跑
  对应 desktop/mobile，2/2 passed。activity evidence targeted desktop 1/1 passed；atlas
  持久化 desktop/mobile 2/2 passed。
- `npm run test:visual`：4/4 tests、6/6 darwin baselines；`npm run test:a11y`：8/8。
- `npm run build`、`npm run typecheck`、`npm run lint`、`git diff --check` 通过。
- `npm run size:check`：主包 337.1 / 340 KiB，JS 2181.3 / 2190 KiB，CSS
  36.3 / 40 KiB。相对 `origin/main` 总 JS 的实测功能增量为 26.5 KiB，主包仍保持原硬上限。
- 实际检查 `output/playwright/reference-gap-{desktop,mobile}.png`：atlas 海洋层、非空间
  说明、missing/sparse 列表和移动端详情均可见。
- GitHub fresh check：Issue #6 open；open PR 为 0。

## 未完成

1. Review 最终 diff，提交 feature branch 并推送。
2. 创建英文 `Closes #6` PR，附本地测试、size 与截图证据。
3. 跟踪 CI / bot / reviewer；#6 合并后才进入 #8。

## 风险 / 红线

- 不直接推 `main`；一个实施 Issue 对应一个 feature branch 和一个 PR。
- Activity、mastery、confidence、exploration 与 learning progression 必须分开。
- Ocean/gap 只能相对用户明确选择的 reference atlas，不能从低活跃度推断无知。
- UMAP 接近、taxonomy 父子关系和 WikiLink 都不能自动冒充 prerequisite/因果关系。
- #27 不复制、抓取或绕过付费/私有 Obsidian 笔记。
- 用户已有 #6 工作区改动不得回滚或清理。
