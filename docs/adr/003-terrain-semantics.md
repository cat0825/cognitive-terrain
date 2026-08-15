# ADR-003：地形语义与认知状态契约

- 状态：Accepted
- 日期：2026-08-14
- 范围：Cognitive Terrain 2.0

## 决策

Cognitive Terrain 是本地优先的认知维护系统。地形是知识对象、关系和认知状态的工作界面，不是对笔记数量的装饰性三维展示。

## 地形语法

| 视觉对象 | 唯一含义 | 数据依据 |
| --- | --- | --- |
| 平面位置 | 稳定的知识邻域 | embedding、WikiLink、人工关系、taxonomy anchor |
| 板块 | 用户确认的学科或领域骨架 | YAML `area`、taxonomy、人工归类 |
| 海拔 | 当前 `TerrainProfile.elevation` 的空间聚合值 | 密度、熟练度、探索度、活跃度、结构桥接五选一 |
| 山脊 / 鞍部 | 跨板块桥接结构 | 双重归属熵、跨板块链接比例、betweenness |
| 温度 | 近期交互活跃度 | 本地 `InteractionEvent` 衰减积分 |
| 海洋 / 洼地 | 相对参考地图的知识缺口 | 用户选定 taxonomy、课程或目标的覆盖率 |

## 不变量

1. 学习后海拔可以变化，平面坐标不得随认知状态变化。
2. 海拔一次只表达一个指标；颜色和覆盖层不能重复编码同一个指标。
3. 自动聚类不能直接成为学科板块，模型只提供归类建议。
4. 板块碰撞是可解释的跨板块结构模式，不实现刚体物理模拟。
5. 未选择 reference atlas 时，不生成“用户缺少某项知识”的结论。
6. YAML 与用户编辑属于声明数据；事件属于本地观测；embedding、布局和地形纹理属于可重建派生数据。
7. 每个派生结果必须记录算法或公式版本；每个解释必须能回到具体对象和关系。

## 首版公式

- 熟练度海拔：`density^0.35 * confidenceWeightedMean(mastery)`。
- 桥接分数：`membershipEntropy * crossPlateLinkRatio * betweenness`。
- 缺口分数：`goalWeight * (1 - coverage) * prerequisiteImportance * evidenceConfidence`。

这些公式先作为版本化契约，不在没有评测数据时调整权重。

## Obsidian YAML 契约

```yaml
area: math.linear-algebra
mastery: 0.65
confidence: 0.55
exploration: 0.90
status: growing
reviewedAt: 2026-08-10
```

- `mastery`、`confidence`、`exploration` 必须是 `0..1` 数字。
- `status` 仅允许 `seed | growing | stable | gap | archived`。
- `reviewedAt` 必须是有效日期。
- 未声明字段保持未知，不用 `0.5` 写回原笔记。
- 首发只读导入；未来写回必须展示 diff、逐条确认并先生成恢复点。

## 迁移策略

Schema v2 先通过纯函数转换并做数量、ID、来源和关系对账，再由 IndexedDB v5 的同一 `versionchange` 事务写入多对象仓。兼容 `projects` 与恢复点继续保留，保存、改名、删除和恢复必须同时更新兼容仓与多对象仓；任何写入失败都回滚整笔事务。当前 Citation 迁移为空，Revision 只保存不含正文的迁移基线，尚不代表完整引用、版本历史或灾难恢复已经完成。
