# Handoff 2026-08-18

## 当前目标

按依赖顺序整合已 review 的地形工作栈：活动海拔与 reference-atlas ocean/gap、探索反馈、证据检查器、learning progression；同时保持 Obsidian 增量同步、diff-first 写回、数学工作流和 prerequisite strata 契约。

## 已落地主线能力

- Obsidian vault 首次导入、增量同步、稳定 identity、三方字段合并、恢复点和逐文件 diff-first 写回。
- 显式 `prerequisites` / `buildsOn` 拓扑、基础层级地形和不可参与派生的诊断证据。
- 数学双链 fixture 与初次导入/确定性 no-op 回归；增量第二快照由 Issue #36 跟踪。
- activity history retention、`activity-elevation-v1`、temperature、reference-atlas-relative ocean/gap。
- 探索工作台从 reference gap、陈旧复习、未解析 WikiLink、未评估/低 confidence 和显式 `gap` 目标生成确定性建议；活动分数不会单独触发建议。
- 探索生命周期支持接受、进行、完成、稍后、忽略和拒绝；持久化 reason code、支持项、来源回跳、下一步动作、evidence fingerprint 与历史。
- Issue #22 的证据检查器覆盖平面位置、峰、海拔、颜色、overlay、板块、碰撞和 reference-relative gap；原始 embedding、近似 UMAP 距离、taxonomy、tags 与 WikiLink 分开呈现。
- CI 对 `npm ci` 瞬时网络失败做有限重试；Playwright desktop/mobile 与 desktop shard 隔离软件 WebGL 负载。

## 集成不变量

- 语义平面坐标保持稳定；activity、mastery、confidence、exploration、structure、temperature 与 learning progression 不得互相冒充。
- Ocean/gap 只能相对用户明确选择的 reference atlas；低活动不能推断为知识缺口。
- Prerequisite 只接受显式关系；UMAP 接近、taxonomy 父子关系和 WikiLink 都不能自动冒充前置或因果关系。
- 2D/3D 共用 evidence contract；activity 只控制海拔，temperature 控制活动颜色，其余维度使用 taxonomy 领域颜色。
- 分析阶段复用 UMAP KNN 候选生成 `noteNeighborEvidence`，不新增第二次全量高维两两计算。
- IndexedDB v10 必须兼容缺 neighbor、exploration 或 vault recovery store 的历史分支数据库，并重建所需 materialization。
- Vault 文件写回必须显式授权、先展示 exact diff、逐文件记录结果；目录句柄不得进入项目包或恢复点。
- 不直接推 `main`；所有整合通过 feature branch、PR 和 CI。

## 验证基线

- Node.js 22.12+。
- 提交前运行 `npm run typecheck`、`npm run lint`、`npm test`、`npm run build`、`npm run size:check`。
- 关键用户流程运行 desktop/mobile E2E；Linux CI 使用拆分后的 shard，避免把软件 WebGL 资源饥饿误判成业务回归。

## 后续

1. 完成 PR #31、#32、#37 的依赖栈整合和逐层验证。
2. 实现 Issue #36 的数学 Vault 第二快照增量同步回归。
3. Fresh-check `main` CI、开放 PR/Issue 与仓库工作区，更新本文件中的状态证据。
