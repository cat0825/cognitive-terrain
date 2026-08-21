# ADR-006：视觉维度契约与语义准入门禁

- 状态：Accepted
- 日期：2026-08-21
- 范围：`VisualDimension` 全部通道、地形语义图例、证据检查器、新视觉通道的准入流程
- 关联：Issue #50，milestone `v1.3 - Reliability and Reproducibility`；上游约束见 ADR-003、ADR-004、ADR-005

## 背景

已上线八个可选视觉维度：density、mastery、exploration、activity、progression、
structure、temperature、area。每个维度的数据来源、公式版本、时间语义与缺失值行为
散落在 README、ADR-003 与证据检查器的字符串里。三个具体后果：

1. 没有清单，无法回答“哪个维度还没写清楚”。下一个维度可以在旧维度仍欠定义时加进来。
2. 颜色通道的四个公式版本（temperature、density shading、area color、overlay none）
   是 `terrain-evidence.ts` 里的裸字面量，改动不会触发任何版本约束。
3. 独立审查建议的准入门禁只以散文存在，没有任何执行点。

## 决策

### 契约表落在代码里

契约表是 [`src/domain/visual-contract.ts`](../../src/domain/visual-contract.ts) 的
`VISUAL_DIMENSION_CONTRACT`，类型为 `Record<VisualDimension, VisualContractRow>`。
选 `Record` 而不是数组：新增一个 `VisualDimension` 却不写契约行时是类型错误，不是
静默缺口。每行必须填满 source fields、formula version、time semantics、version
semantics、missing-value 行为、可复现规则和证明测试。

公式版本一律从拥有它的模块导入，不在契约里重述字面量。为此把四个裸字面量提为常量：
`ACTIVITY_TEMPERATURE_FORMULA_VERSION`、`AREA_COLOR_FORMULA_VERSION`、
`DENSITY_SHADING_FORMULA_VERSION`、`OVERLAY_NONE_FORMULA_VERSION`。

### 八个维度的契约

| 维度 | 通道 | 数据来源 | 公式版本 | 时间语义 | 缺失值 | 可复现证明 |
| --- | --- | --- | --- | --- | --- | --- |
| density | 海拔 | `notes[].x/y/weight/createdAt` | `density-kde-v1` | declared | 用归一化 weight；不读 mastery/activity/exploration | `tests/unit/terrain.test.ts`、`tests/unit/derived-data.test.ts` |
| mastery | 海拔 | `notes[].mastery`、`confidence`、provenance | `mastery-density-v1` | declared | 未评估不贡献分子；缺 confidence 用 0.5 | `tests/unit/terrain.test.ts`、`tests/unit/cognitive-state.test.ts` |
| exploration | 海拔 | `notes[].exploration` | `exploration-density-v1` | declared | 未标注意图不贡献分子 | `tests/unit/terrain.test.ts`、`tests/unit/exploration-loop.test.ts` |
| activity | 海拔 | `interactionEvents[]`、`activityHistory.aggregates[]`、`timeZone` | `activity-elevation-v1` | evaluation-time | 无有效历史不贡献高度，不回退 mastery；未来时间戳忽略 | `tests/unit/activity-elevation.test.ts`、`tests/unit/future-activity.test.ts`、`tests/unit/activity-history.test.ts` |
| progression | 海拔 | `cognitiveObservations[]`、profile version、`timeZone` | `learning-progression-v1` | evaluation-time | 无观测用中性海拔并标高不确定性；不补造历史 | `tests/unit/learning-progression.test.ts`、`tests/unit/terrain.test.ts` |
| structure | 海拔 | `notes[].prerequisites`、`buildsOn`、`prerequisiteTopology` | `explicit-prerequisite-strata-v1` | structural | 无可解析关系结构输入 0；循环、自指、歧义排除 | `tests/unit/prerequisite-topology.test.ts`、`tests/unit/derived-data.test.ts` |
| temperature | 颜色 | `interactionEvents[]`、`activityHistory.aggregates[]` | `activity-temperature-v1` | evaluation-time | 无活动为冷色 score 0，不等于缺口 | `tests/unit/cognitive-state.test.ts`、`tests/unit/future-activity.test.ts` |
| area | 颜色 | `notes[].area/areas`、`taxonomyNodes[]`、`taxonomyVersion` | `declared-taxonomy-area-color-v1` | declared | 未声明用中性灰，不由聚类推断 | `tests/unit/knowledge-plates.test.ts`、`tests/unit/taxonomy.test.ts` |

共享通道（不可单独选择，但同样受契约约束）：平面位置 `embedding-umap-v1`、山峰
`peak-local-maximum-v1`、板块 `declared-taxonomy-plate-v1`、碰撞
`wikilink-collision-v1`、海洋/缺口 `reference-gap-v1`。完整字段见
`SHARED_CHANNEL_CONTRACT`。

所有八行当前都是完整的：`evaluateVisualContract()` 返回空数组，
`tests/unit/visual-contract.test.ts` 对此断言。没有标记为 gap 的行。

### 通道分离约束

`CHANNEL_SEPARATION_RULES` 把 Issue #28 的通道边界写成可断言的条目：

- 颜色只承载 taxonomy 归属或来源类型，不承载认知状态强弱。
- 渐变只承载显式声明的层级，不承载推断出的重要性。
- 海洋只承载相对显式 atlas 的参考缺口，不承载低活动或低熟练度。
- 活动信号只叠加，不改写基础语义：不得覆盖 mastery、exploration 或结构层级。
- embedding 位置只表示布局邻近，永不表示能力、掌握度或先修顺序。
- 同一指标不得同时编码到海拔与颜色。

门禁测试对最后一条做机械检查：海拔行与颜色行的公式版本集合不允许相交。

### 准入门禁

新增视觉通道必须同时满足：

1. `evaluateVisualContract()` 为空，即所有既有行仍然完整。
2. 新通道在 `VISUAL_DIMENSION_CONTRACT` 有填满的行，公式版本来自拥有它的模块常量。
3. 新行链接的测试文件存在，并且真的证明可复现与缺失值行为。
4. 契约声明的公式版本与 `buildTerrainSemanticsLegend` 实际渲染的版本一致。
5. 不违反上面六条通道分离约束。
6. 证据检查器能把该通道追回原始字段与版本。

前五条由 `tests/unit/visual-contract.test.ts` 强制。第六条需要人工确认，写在
[`.github/pull_request_template.md`](../../.github/pull_request_template.md) 的
「视觉维度准入」清单里。

## 被拒绝方案

- **只写 Markdown 表**：审查已经指出问题不是缺文档而是缺执行点。纯散文表不会在
  维度漂移时失败。
- **让契约表成为渲染层的唯一配置源**：渲染需要颜色、几何和着色细节，把它们塞进
  契约会让契约随 UI 抖动，反而失去版本意义。契约只约束语义，不接管渲染。
- **taxonomy 或公式变化即作废全部维度**：与 ADR-004、ADR-005 的快照与 rebuild
  策略冲突，会让可复现的历史报告一起失效。

## 边界

- 不移除既有维度，不阻塞现有通道的 bug 修复与可访问性工作。
- 不引入新维度：#28 的候选仍在 icebox，必须先过本门禁。
- 契约不校验颜色对比度与图形美观，那属于 a11y 与视觉门禁。
