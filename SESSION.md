# Handoff 2026-08-15 16:51 CST

## 目标

把用户反馈里的“学科交叉”和“温度”落到可维护的数据与地图交互上。本检查点完成 Obsidian 多学科归属、WikiLink 碰撞带，以及基于打开/编辑/复习事件的活动温度层。

## 进度

- Issue 驱动进度：v1.1 路线图见 [#9](https://github.com/cat0825/cognitive-terrain/issues/9)；release-hardening 已通过 [PR #12](https://github.com/cat0825/cognitive-terrain/pull/12) 合入 `main`，当前执行语义地形地基 [#2](https://github.com/cat0825/cognitive-terrain/issues/2)。
- 检查点：分支 `codex/semantic-terrain-foundation`，基于 `main@fa4af1d`；Schema v3 / IndexedDB v5、稳定知识板块、多学科归属、WikiLink 碰撞带与活动温度层已贯通，等待本分支 PR。
- 发布判断：仍是本地优先 Demo；板块只来自用户 YAML / 人工分类，不能称为权威 taxonomy 或自动学科判定。

## 当前状态（fresh check）

| 范围 | 已实现 | 验证 | 仍缺 |
| --- | --- | --- | --- |
| 多学科归属 | 兼容 `area: 数学`、`area: [数学, 物理]`、`areas: [数学, 物理]`；NFKC/空白/大小写归一化去重；保留 `area` 主领域兼容字段 | unit 覆盖标量、数组、非法类型、structured record、去重与主领域 | TaxonomyNode store、人工 taxonomy 编辑、真实匿名 vault fixture |
| Schema v3 membership | 每个领域生成一条 `PlateMembershipV3`，同一 item 等权且权重和为 1；YAML 来源保留 `yaml` provenance | unit 覆盖 membership ID、数量、0.5/0.5 权重、项目 bundle 恢复 | taxonomy 版本、层级与别名 |
| 图例与筛选 | 多个板块按钮可同时 `aria-pressed=true`；按任一归属 OR 筛选；切项目清空；详情显示多色领域归属并支持逗号分隔编辑 | E2E 桌面/移动覆盖双选、清除与详情双归属 | 只看未分类、板块搜索/折叠 |
| 跨板块碰撞带 | 只统计可解析 WikiLink；按稳定无向板块对聚合；少于 3 条保留关系线，3 条起生成带；共享任一 membership 不计为跨域 | unit 覆盖聚合与共享领域口径；E2E 桌面/移动覆盖键盘详情；实测 7 个板块、30 条关系、6 个碰撞带 | 方向性、真实匿名 vault fixture、超密集关系的进一步降噪 |
| 活动温度 | `opened` / `edited` / `reviewed` 分别按 1 / 3 / 2.5 权重和 7 / 30 / 14 天半衰期衰减；一分钟内重复打开去重；手动“标记已复习”更新认知状态 | unit 覆盖评分、衰减、去重与轻量持久化；E2E 桌面/移动覆盖计数和坐标不漂移 | 事件保留期限、历史趋势、批量复习工作流 |
| 2D/3D 编码 | 多归属笔记继续以主领域取稳定颜色，不改变平面坐标；详情展示全部归属 | 2D/3D E2E、visual 2/2、1440×960 与 390×844 目检 | 多色边界/混合材质，当前刻意不做 |

## 已完成（含证据）

- `src/domain/types.ts`、`src/domain/knowledge-plates.ts`：新增 `areas`、统一 `areasForNote()` / `primaryAreaForNote()`，修正板块汇总、bridge 与相似原因语义。
- `src/import/obsidian-frontmatter.ts`、`src/import/parse.ts`、`src/pipeline/run-pipeline.ts`：多种 YAML/structured 输入进入规范化后的 `TerrainNote.areas`。
- `src/domain/schema-v3.ts`、`src/export/project-files.ts`、`src/storage/db.ts`：导出、恢复、迁移与多对象仓保留多归属；membership 等权。
- `src/store/app-store.ts`、`src/domain/project-view.ts`、`src/App.tsx`：多板块状态、OR 筛选、merge/update 保真与项目切换复位。
- `src/ui/FilterPanel.tsx`、`src/ui/NoteDetail.tsx`、`src/App.css`：复用现有图例与状态区，实现多选、双领域色块和领域编辑。
- `src/fallback/Terrain2D.tsx`、`src/scene/TerrainScene.tsx`：2D/3D 主领域配色兼容；`src/domain/demo.ts` 增加可见交叉归属，仅用于演示。
- `src/domain/knowledge-plates.ts`：新增稳定无向板块对聚合，稀疏关系保留细线，达到 3 条生成碰撞带，强度采用关系数对数归一化。
- `src/fallback/Terrain2D.tsx`、`src/scene/TerrainScene.tsx`、`src/ui/NoteDetail.tsx`：2D/3D 碰撞带、hover tooltip、键盘/点击详情、统计口径与最多 6 条代表关系均已接通。
- `src/domain/activity-temperature.ts`：统一活动温度模型、时间衰减、打开去重与冷/温/热色阶；忽略与活动无关的分类/链接事件。
- `src/store/app-store.ts`、`src/storage/project-repository.ts`：选中笔记记录 `opened`，轻量追加到兼容项目与事件对象仓，不重建布局、不创建恢复点；手动复习持久化 `reviewedAt` 与 `reviewed` 事件。
- `src/ui/FilterPanel.tsx`、`src/ui/NoteDetail.tsx`、`src/fallback/Terrain2D.tsx`、`src/scene/TerrainScene.tsx`：新增温度按钮、图例、活动摘要、复习动作与 2D/3D 冷暖编码；密度海拔和平面坐标保持不变。
- `src/ui/TopBar.tsx`：恢复大项目时确认后立即关闭菜单；E2E 等待口径按实测 7.6 秒调整为 15 秒。
- `npm run test:unit`：13 files / 62 tests passed；`npm run test:e2e`：桌面/移动 16/16；`npm run test:a11y`：6/6；`npm run test:visual`：2/2。
- `npm run typecheck`、`npm run lint`、`npm run build`、`git diff --check` 全通过。
- `npm run size:check`：主包 310.0 KiB、JS 2114.6 KiB、CSS 27.5 KiB；总 JS 上限按本次能力增量从 2112 调至 2120 KiB，主包 320 KiB 上限不变；原配置备份在 `/tmp/cognitive-terrain-size-budget.mjs.20260815-0212.bak`。
- 实际浏览器 `http://127.0.0.1:4174/`：桌面 1280×720 与移动 390×844 的碰撞详情横向溢出均为 0、console error 0；说明完整显示“共享任一领域时不计为跨域，完全不相交时按双方主领域计入一次”。
- 碰撞带截图：`output/playwright/collision-3d-desktop.png`、`collision-3d-mobile.png`、`collision-detail-desktop.png`、`collision-detail-mobile.png`；WebGL 非暗像素占比 33.2% / 26.7%。
- 实际浏览器 `http://127.0.0.1:4177/`：领域/碰撞带与温度层均正常渲染；桌面 1280×720 与移动 390×844 横向溢出均为 0、console error 0。截图在 `output/playwright/issue-2-*.png`（忽略目录，不入库）。

## 未完成 / 阻塞

1. 学习曲线海拔、海洋缺口和探索反馈闭环仍未实现；温度目前是当前衰减值，没有历史趋势或按时间窗口回放。
2. 碰撞带目前按无向板块对统计，尚未表达关系方向；也没有真实匿名 vault 的密集关系回归数据。
3. 多学科目前是扁平标签；尚无层级 taxonomy、别名、版本和批量维护界面。
4. 尚未用真实匿名 Obsidian fixture 验证大量多学科 YAML 与解析/未解析 WikiLink。
5. 当前实现由 GitHub Issue #2 跟踪；合并前必须通过 feature branch PR 与 fresh CI，禁止直接推 `main`。
6. Citation 仍为空、Revision 仍是 hash 基线、恢复点仍不是站点外灾难备份；10k/跨浏览器/真机门禁仍缺。

## 下一步（可直接执行）

1. 增加真实匿名 fixture，覆盖多学科 YAML、重复/非法领域、解析/未解析 WikiLink、事件持久化、存储恢复和移动端回归。
2. 为温度事件定义保留期限、裁剪与历史趋势聚合，避免长期使用后 `interactionEvents` 无界增长。
3. 为碰撞带补方向性方案；只有数据源存在可解释方向时才编码箭头或流向。

## 风险 / 红线

- 板块只来自用户 `area` / `areas` 或后续人工 taxonomy；不把自动聚类冒充学科分类。
- 山脊只来自可解析 WikiLink；共享任一领域即不算跨板块，布局接近不能伪装成明确关系。
- Demo 的 1800 点、交叉归属和 30 条示例关系都不是已核验资料。
- 不自动读取或改写真实 Obsidian/Tolaria vault；不把同一 IndexedDB 内恢复点称为外部备份。
