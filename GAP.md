# Cognitive Terrain 成熟产品差距

评估日期：2026-08-14。对标基线为 Obsidian 的 Graph / Search / Properties 与 InfraNodus 的网络分析、聚类、中心性和结构缺口洞察。参考：[Obsidian Graph](https://obsidian.md/help/plugins/graph)、[Obsidian Search](https://obsidian.md/help/plugins/search)、[Obsidian Properties](https://obsidian.md/help/properties)、[InfraNodus Network Analysis](https://infranodus.com/docs/network-analysis)。等级仅表示当前仓库相对成熟产品的工程差距：`无`、`有差距`、`差距大`。

| 维度 | 等级 | 当前证据 | 成熟基线 / 关键缺口 |
| --- | --- | --- | --- |
| 功能完整性 | 差距大 | 3D/2D 地形、时间轴、导入导出、WikiLink 关系和 Schema v3 多对象仓已成立 | Source 仍来自笔记元数据；缺真实 Citation、完整 Revision、TaxonomyNode、回收站、结构化搜索、内容缺口工作流和带证据问答 |
| 错误处理与容错 | 有差距 | WebGL/embedding 有 fallback，Worker 可取消；项目操作与 v4→v5 迁移均有事务回滚测试 | 缺坏库恢复 UI、站点外自动备份、跨标签旧版本升级提示、离线/模型下载状态机和跨版本灾难演练 |
| 可观测性 / 遥测 | 差距大 | 有本地分析 toast、perf/size/Playwright 门禁 | 无稳定错误码、运行指标历史、诊断导出、可选隐私遥测、真实用户性能与崩溃统计 |
| 安全性 | 有差距 | 本地优先、无业务后端、fresh 机密扫描无命中 | 依赖仍有 4 high；缺导入内容安全边界、CSP/部署基线、备份加密、同步权限和安全审计 |
| 性能 | 有差距 | 1800 点本机 Chrome headless 门禁约 120 FPS，size budget 通过 | 全量 UMAP/近邻路径不适合直接扩到 10k/50k；缺低端设备、Safari、内存和稳定布局基准 |
| 文档与上手成本 | 有差距 | README、SESSION、路线图、迁移与发布计划齐备 | 文档较多且历史口径曾过期；缺样例数据契约、故障手册、架构 ADR 和版本化迁移指南 |
| 生产可用度 | 差距大 | 可作为本地 Demo / release candidate | 数据可信度、恢复能力、跨浏览器、依赖风险、真实规模、同步与运维都未达到生产知识库要求 |

## 距离可落地 / 可发布还差什么

- **可发布 Demo**：确认远端 CI，审阅两张视觉基线和公开仓库内容，明确 4 个 high 依赖风险与 a11y 排除项；随后可打候选版本。
- **个人日常可落地**：补真实来源/引用、修订与回收站、站点外自动备份、结构化与混合搜索、稳定增量布局，并完成 10k 数据门禁。
- **成熟产品**：再补跨设备同步与冲突处理、权限/加密、可选遥测、浏览器矩阵、灾难恢复演练，以及 InfraNodus 级的中心性/聚类/结构缺口分析。
