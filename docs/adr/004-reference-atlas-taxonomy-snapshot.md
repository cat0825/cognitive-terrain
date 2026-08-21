# ADR-004：Reference atlas 固化 taxonomy 快照

- 状态：Accepted
- 日期：2026-08-21
- 范围：Reference atlas、reference gap、探索建议证据

## 背景

Reference atlas manifest 已保存 `taxonomyVersion`，但旧实现仍用当前 taxonomy
解析节点的 label、alias 和 parent。重命名、重挂或合并后，旧 atlas 的报告和证据
指纹会在没有用户操作的情况下漂移。

## 决策

采用 Option A：atlas 显式绑定时，把其节点的 `id`、`label`、`parentId` 和
`aliases` 保存为不可变 `taxonomySnapshot`。缺口层的标签解析、层级后代与笔记
覆盖匹配全部以该快照为准，不再读取当前 taxonomy 的语义字段。

已有 IndexedDB v10 atlas 不包含快照。迁移只原样保留 manifest，不根据当前节点
反推历史数据：taxonomy version 仍一致时保持兼容；版本发生变化后，缺口层禁用并
显示“需要重新绑定”。用户明确重新绑定后，才把当前 taxonomy 固化为新快照并更新
atlas version。重新绑定前会创建恢复点。

## 被拒绝方案

Option B（每次 taxonomy 变化都让所有 atlas 失效）实现更简单，但会让已经具备完整
历史语义的 atlas 无法继续复现。快照方案允许旧报告稳定存在，只把无法证明历史语义
的 legacy manifest 置为待处理状态。

## 边界

- 不猜测合并后的节点意图，不自动把旧节点改绑到新节点。
- 不从模型聚类生成权威 atlas。
- 当前 taxonomy 可以继续演化；只有用户明确 rebind 才改变 atlas 报告。
