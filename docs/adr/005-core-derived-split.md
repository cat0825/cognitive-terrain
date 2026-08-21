# ADR-005：core / derived 数据拆分与显式版本元组

- 状态：Accepted
- 日期：2026-08-21
- 范围：`TerrainProject` 数据模型、IndexedDB 持久化、项目包导入导出、store 提交状态
- 关联：Issue #49，milestone `v1.3 - Reliability and Reproducibility`

## 背景

`TerrainProject` 同时承载稳定输入（笔记、来源、关系、用户显式状态、taxonomy、
atlas 绑定）和可重算派生结果（布局、密度快照、峰、海拔剖面、缺口报告、建议）。
两类数据同生命周期、同一次写入，带来三个具体问题：

1. 无法判断某个持久化的派生值是不是当前公式产出。`bandwidth` 计算后即丢弃，快照
   因此不可复算。
2. 分析成功与保存成功共用 `isAnalyzing` 一个状态，H2 审查结论已经暴露过这个坑。
3. `analyzeNotes` 先在默认时区分桶地形，再覆盖 `timeZone` 字段，项目声明的时区
   与快照实际使用的时区可以不一致。

## 决策

### 字段分类

| 类别 | 字段 | 持久化 |
| --- | --- | --- |
| core | `id`、`name`、`createdAt`、`updatedAt`、`timeZone`、`sourceDigest`、`notes`（含 `x`/`y` 锚点与显式认知字段）、`cognitiveStates`、`cognitiveObservations`、`interactionEvents`、`taxonomyNodes`、`taxonomyVersion`、`referenceAtlases`、`activeReferenceAtlasId`、`explorationItems`、`vaultSync`、`terrainProfiles`、`activeTerrainProfileId` | 必须持久化，不可重算 |
| derived（可重算） | `snapshots`、`peaks`、`prerequisiteTopology`、`gridSize` | 持久化为缓存，可由 core + 版本元组重建 |
| cached（不可重算） | `noteNeighbors`、`noteNeighborEvidence`、`activityHistory.aggregates` | 持久化，重建需要不落盘的输入 |

`noteNeighborEvidence` 依赖 embedding 向量，向量刻意不落盘（体积与隐私）。用坐标
反推近邻会把布局距离伪装成语义证据，因此归入 cached 而不是 derived：它只能随下一
次分析刷新，不参与 rebuild 等价校验。`activityHistory.aggregates` 同理，压缩会
按保留策略丢弃原始事件。

### 显式版本元组

新增 `ProjectDerivedRecord`（`src/domain/derived-data.ts`），随项目持久化：

- `versionTuple`：`taxonomyVersion`、绑定 atlas 的 `referenceAtlasVersion`、活动
  profile 的 `terrainFormulaVersion`、`densityFormulaVersion`、
  `layoutFormulaVersion`、`neighborFormulaVersion`、
  `prerequisiteFormulaVersion`、`embeddingModelId`、`embeddingMode`。
- `terrain`：复算快照所需的 `gridSize`、`bandwidth`、`timeZone`、`formulaVersion`
  与 `peaks: 'derived' | 'authored'`。

`versionTuple` 在每次 `migrateProject` 时按当前 core 数据重算，taxonomy 升版或
atlas 重绑立刻反映。`terrain` 原样保留，不为历史项目凭空补参数。

`peaks: 'authored'` 用于 demo 地形：它的峰按主题手工放置，密度复算不得替换。

### rebuild 等价校验

`rebuildProjectDerivedData` 用 core 数据 + `terrain` 参数复算 `snapshots`、
`peaks`、`prerequisiteTopology`，逐值比较后返回 `mismatches`。项目包导入是唯一
派生数据来自外部的入口，因此在那里强制复算：不一致时以复算结果为准并向用户报告，
而不是信任外来快照。没有 `terrain` 记录的旧包保持 `status: 'cached'`，原样导入。

### 分析状态与保存状态分离

store 新增 `persistence: { status: 'idle' | 'saving' | 'saved' | 'failed', scope }`，
覆盖 project、vault-sync、vault-writeback、taxonomy、review、exploration 六条提交
路径，与 `isAnalyzing` 完全独立。UI 以 `[data-save-status]` 独立展示：成功 4 秒后
自动收起，失败保留到下一次提交，`saving` 不可被确认掉。

### 时区一致性

`createProjectFromNotes` 接受 `timeZone` 并用它分桶地形，`analyzeNotes` 不再事后
覆盖字段。否则项目声明 `UTC` 而快照按 `Asia/Shanghai` 分月，rebuild 必然给出不同
的 bucket。

## 被拒绝方案

- **拆成两个 IndexedDB store / 两个对象**：迁移面和事务边界都要重做，H2/H3 刚刚
  收敛的原子性会被重新打开。当前决策保留单一 `projects` 记录，用显式分类和可验证
  的 rebuild 达到同样的可复现目标。
- **丢弃持久化的派生值，每次启动重算**：1800 条笔记的密度地形冷启动代价明显，且
  cached 类字段本来就重算不出来。
- **按 taxonomy 变化直接作废全部派生数据**：与 ADR-004 的快照策略冲突，会让能够
  复现的历史报告一起失效。

## 边界

- 不改渲染层，不引入后端。
- 不因为 `mismatches` 非空就拒绝导入：单个陈旧快照不该让用户丢掉整个项目。
- 派生数据的重建不产生新语义维度；新维度仍受 #50 的准入门槛约束。
