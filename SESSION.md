# Handoff 2026-08-17 07:40 CST

## 目标

按 GitHub Issue/PR 驱动推进 Cognitive Terrain。当前执行 Issue #7：版本化 taxonomy hierarchy、aliases 与 maintenance tools。

## 进度

- Issue #5 已由 [PR #20](https://github.com/cat0825/cognitive-terrain/pull/20) 合并。
- Issue #7 实现已完成，分支 `codex/taxonomy-hierarchy`，等待提交 PR 与 GitHub CI。
- 路线图：[Issue #9](https://github.com/cat0825/cognitive-terrain/issues/9)。

## 已完成

- `TaxonomyNode`：稳定 ID、父节点、aliases、描述、状态、节点版本和 workspace 边界。
- 别名解析：NFKC、连续空白、大小写确定性归一化；导入同时保留 `declaredAreas` 和 resolved node membership。
- 维护纯函数：create/rename/reparent/merge、受影响 item 预览、cycle/cross-workspace 拒绝；合并时子节点重挂且不能合入自身后代。
- IndexedDB v6：新增 `taxonomyNodes` 与 `referenceAtlases` stores，v5 原子回填；项目包、备份恢复和多对象仓保留层级、aliases、membership 与版本。
- Reference atlas manifest 显式绑定 taxonomy version 和 node IDs，不内置或自动声明权威 taxonomy。
- UI：地图筛选内按需加载领域维护；提供未分类/未解析队列、创建、重命名、重挂、合并预览和自动恢复点。
- README 已补 taxonomy 规则、原始标签 provenance 与 IndexedDB v6 说明。

## 验证

- `npm run test:unit`：17 files / 95 tests passed。
- `npm run typecheck`、`npm run lint`、`npm run build`、`git diff --check` 通过。
- `npm run size:check`：主包 336.6 KiB、JS 2154.6 KiB、CSS 33.4 KiB；维护 UI 独立 chunk gzip 2.98 KiB。预算备份：`/tmp/cognitive-terrain-size-budget.mjs.20260817-0728.bak`。
- Focused E2E：desktop/mobile 2/2；重命名预览影响 60 条，node ID 保持 `plate-6ad5051c`，恢复点 1 个。
- 浏览器实测：桌面/移动 body、panel 横向溢出均为 0，console error 0。
- 截图：`output/playwright/issue-7-taxonomy-rename-desktop.png`、`output/playwright/issue-7-taxonomy-mobile.png`（忽略目录，不入库）。

## 未完成

1. 创建 PR、等待 GitHub quality/E2E/visual/a11y CI，通过后合并并关闭 Issue #7。
2. Issue #6：activity elevation 与 reference-atlas gap/ocean 语义。
3. Issue #8：exploration feedback loop。

## 风险 / 红线

- Taxonomy 只来自用户标签与人工维护，不把模型聚类冒充权威分类。
- 同一 IndexedDB 内恢复点不是站点外灾难备份。
- 不直接推 `main`；一个 Issue 对应一个 feature branch 和一个 PR。
