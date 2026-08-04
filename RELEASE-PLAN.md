# Cognitive Terrain — 发布与改善计划（终版）

- 项目：`cognitive-terrain`（`/Users/qianyuhe/Documents/GitHub/cognitive-terrain`）
- 基线日期：2026-08-04（fresh 校验：typecheck ✓ lint ✓ test 10/10 ✓ build ✓，wasm 23MB 待优化）
- 产品形态：本地优先、无后端的"认知地形"知识地图
- 发布形态：公开 Demo（Cloudflare Pages）+ 开源仓库（GitHub）
- LICENSE：AGPL-3.0（严格 copyleft，网络服务亦须开源）
- Schema：TerrainProject v1 → v2（含 IndexedDB 迁移）
- 发布文档：HTML + Markdown 双份

## 已决策项

| 维度 | 决策 |
| --- | --- |
| 仓库 | 独立 git 仓库，GitHub `cat0825/cognitive-terrain` |
| LICENSE | AGPL-3.0 |
| 部署 | Cloudflare Pages，本地 wrangler CLI（已认证） |
| Schema | v2（embeddingMode / noteNeighbors）+ 迁移 |
| 发布文档 | HTML 可视化报告 + MD 可执行版 |
| 范围 | 阶段 0–9 全部 |

---

## 阶段 0：基线校验与收尾

- fresh 校验已跑通（见上）；npm audit 4 high（transformers Node 侧 adm-zip/sharp，发布前复核）
- 修 README 失真："8 条" → 6 条；补"模型模式"说明
- 标注坏 npm scripts（e2e/visual/a11y 指向不存在配置，阶段 6 修复）

## 阶段 1：拆仓 + 工程外壳
- `git init` 独立仓库；首次提交排除 `dist/ node_modules/ output/playwright/`
- LICENSE(AGPL-3.0) + README 重构（截图/架构/运行/已知限制/部署）
- Cloudflare Pages 部署（wrangler）；vite `base: '/'`
- CI：GitHub Actions（typecheck/lint/test/build + e2e）

## 阶段 2：语义可信度 + Schema v2（地基，先行）
- `types.ts`：schemaVersion 2 + `embeddingMode: 'semantic'|'fallback'|'demo'` + `noteNeighbors?: string[][]`
- `db.ts`：IndexedDB v1→v2 迁移，旧项目补默认值 + fake-indexeddb 迁移单测
- `run-pipeline.ts`：降级分支写 embeddingMode；worker 内算 top-k 近邻
- `app-store.ts:134`：loadStudyPack 解锁真 embedding
- UI：模式徽章（语义✓/降级⚠/demo）+ NoteDetail 近邻区块 + 分析 toast（模型/设备/耗时/降级）

## 阶段 3：项目库 UI
- 补 renameProject；store 加 list/open/delete/rename
- TopBar 菜单 → 项目列表 + 重命名/删除/导出；备份提醒

## 阶段 4：分享卡片
- `export/share-card.ts`：地形+标题+时间范围+顶峰+计数 16:9 合成图；接线 exportTerrainPng
- 首启引导"导入我的笔记"优先

## 阶段 5：体积与首屏
- transformers 动态 import（23MB wasm 按需加载）
- manualChunks 分桶；模型下载进度 UI + 离线降级按钮

## 阶段 6：测试与质量门
- playwright.config.ts + e2e/visual/a11y（pixelmatch + axe，依赖已装）
- perf 脚本绑定 scripts/perf-check.mjs；unit 补强
- 已知限制：暗色 UI 8px mono 小字 color-contrast 未达标（设计语言系统性问题），a11y 规则排除该项，发布前酌情复核

## 阶段 7：交互纵深 ✅ 已交付
- 峰到路径 / 焦点模式 / 对比模式 / 小数据状态 / 移动端 / 首启 tour
- 焦点飞行：0.85s 三次缓动用内 lerp 相机与 controls.target；峰标签点击高亮 + 金色连线（DynamicDrawUsage）
- 对比基准层：选中快照后显示新增/消失笔记计数（delta strip），应用与场景联动
- 小数据提示（≤5 条）+ 首启引导（已有 first-run banner 沿用）
- 移动端：first-run banner / small-data hint / compare-strip 适配 700px 断点

## 阶段 8：增量与工作流闭环 ✅ 完成
- `mergeNotes`：新笔记与已有项目按稳定 ID 合并，复用项目 embedding 模式重跑分析
- `updateNote`：标题/正文/标签编辑后重跑，保留 ID 与领域坐标
- 复盘报告：`downloadProjectReport` 导出 Markdown（峰值 → 覆盖笔记 → 清单）
- perf 门槛：`npm run size:check`（主包 320KiB / JS 总量 2100KiB / CSS 40KiB）挂入 CI quality job
- 新增 report.test.ts（2 例），单元测试共 16

## 阶段 9：发布 runbook ✅ 完成
- 版本号 0.1.0 → 1.0.0
- README 补齐阶段 7/8 功能清单；npm audit 复核（仍为 4 high 无 fix，见「依赖审计」）
- 本文件即发布文档（+RELEASE-PLAN.html）；部署见下

---

## 里程碑
- **A（~1 周）**：阶段 0–5 → 可发布 v1
- **B（+1 周）**：阶段 6–7 → 质量门 + 交互纵深
- **C（+1 周）**：阶段 8–9 → 工作流闭环 + 正式发布