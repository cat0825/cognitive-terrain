# Cognitive Terrain

把本地笔记投影成一张可探索的认知地形：语义邻近决定平面位置，认知状态决定海拔，显式声明决定板块与层级。全部计算在浏览器内完成，没有业务后端，笔记不上传。

它不是"笔记数量的三维装饰"。地形是一个工作界面：你看到的每一处高低、颜色和海洋，都能点开追回原始字段、公式版本和证据 ID。

```bash
npm install && npm run dev
```

首次打开即有 1800 条确定性生成的中文演示笔记，可直接操作。

## 核心思路

三层数据被严格分开，这是整个项目的设计前提：

| 层 | 内容 | 规则 |
| --- | --- | --- |
| core | 笔记、来源、显式认知状态、taxonomy、atlas 绑定、vault 同步基线 | 唯一真相，必须持久化，不可重算 |
| derived | 月份快照、山峰、先修拓扑 | 可由 core + 显式版本元组复算并逐值校验 |
| cached | embedding 邻居证据、活动聚合 | 持久化但重建需要不落盘的输入，只随下一次分析刷新 |

派生数据带 `ProjectVersionTuple`（taxonomy 版本、atlas 版本、地形/密度/布局/邻居/先修公式版本、embedding model 与 mode）。导入项目包时强制复算，不一致就以复算结果为准并报告漂移，而不是信任外来快照。设计取舍见 [ADR-005](docs/adr/005-core-derived-split.md)。

### 视觉通道各管一件事

八个可选维度分属海拔与颜色两条通道，同一指标不允许同时编码到两者：

| 维度 | 通道 | 依据 | 公式版本 |
| --- | --- | --- | --- |
| 密度 | 海拔 | 笔记坐标与权重的 KDE 聚合 | `density-kde-v1` |
| 熟练度 | 海拔 | 显式 `mastery` × 置信度加权 | `mastery-density-v1` |
| 探索度 | 海拔 | 显式 `exploration` 意图 | `exploration-density-v1` |
| 近期活跃 | 海拔 | 打开/编辑/复习事件的指数衰减 | `activity-elevation-v1` |
| 学习进程 | 海拔 | 重放带时区的显式认知观测 | `learning-progression-v1` |
| 基础层级 | 海拔 | 显式 `prerequisites` / `buildsOn` DAG 深度 | `explicit-prerequisite-strata-v1` |
| 活动温度 | 颜色 | 活动热度，海拔保持密度 | `activity-temperature-v1` |
| 领域 | 颜色 | 声明并解析到版本化 taxonomy 的归属 | `declared-taxonomy-area-color-v1` |

每个维度都有填满的契约行：数据来源、公式版本、时间语义、版本语义、缺失值行为、可复现规则和证明它的测试。契约是代码（[`src/domain/visual-contract.ts`](src/domain/visual-contract.ts)）而不是散文，新增维度缺行会直接编译失败。准入门禁见 [ADR-006](docs/adr/006-visual-dimension-contract.md)。

### 不会做的推断

这些边界是有意的，也都有回归测试：

- 学习后海拔会变，平面坐标不变。认知状态不移动笔记。
- 缺失值保持缺失。未评估的 `mastery` 不贡献高度，不用 `0.5` 补齐，也不从活动或空间位置反推。
- 打开、编辑甚至单独的复习事件都不会提高熟练度。
- 二维 UMAP 距离不是 embedding 分数，不证明显式关系、先修顺序或因果。
- 自动聚类不能成为学科板块，模型只提供归类建议。
- 未选择参考图谱时不生成任何"你缺少某项知识"的结论；低活动不等于缺口。
- 未来时间戳（超过 5 分钟时钟偏移容差）一律不参与热度、海拔、温度与陈旧判定。

完整地形语法与不变量见 [ADR-003](docs/adr/003-terrain-semantics.md)。

## 主要能力

**探索**：3D 地形与 2D 等高线双视图，WebGL 不可用时自动降级。按月份回放知识积累，对比模式可选时间基准层回放差异。搜索、标签与领域筛选、峰值标签分级显示（移动端同屏最多 8 个）、焦点飞行、峰内路径连线。

**解释**：地形语义图例与证据检查器统一解释平面位置、山峰、海拔、颜色、叠加层、板块、碰撞与参考缺口。笔记邻居分别显示原始 embedding 分数/rank/model、近似 UMAP 距离、taxonomy、tags 与显式 WikiLink，2D/3D 共用同一契约。

**结构**：`area` / `areas` 多领域归属与 WikiLink 生成知识板块、跨域山脊和可解释碰撞带。方向只来自已解析的 source → target 链接，需至少 2 组唯一笔记关系且置信度达 60% 才显示箭头。`prerequisites` / `buildsOn` 生成基础层级；循环、自指、歧义与未解析目标不参与结构海拔，但保留诊断。

**领域维护**：版本化 taxonomy node 把稳定 ID 与显示名称分离，支持父子层级、NFKC/空白/大小写归一化别名、创建、重命名、重挂与合并预览。每次确认前创建恢复点，重命名与重挂不改变 node ID 与成员。

**参考图谱**：显式选中 active reference atlas 后才计算覆盖差距。atlas 绑定不可变 taxonomy 快照，taxonomy 变化后旧 atlas 禁用并要求用户重新绑定，不被当前层级静默改写（[ADR-004](docs/adr/004-reference-atlas-taxonomy-snapshot.md)）。

**探索工作台**：把参考缺口、陈旧复习、未解析双链、低置信度笔记和用户标记的 `gap` 目标转换为最多 8 条确定性建议，当前工作集最多 3 项。每条保留 reason code、支持项、来源回跳与生命周期历史；活动分数不会单独触发建议。

**活动历史**：打开/编辑/复习原始事件分别保留 30/180/365 天，每条笔记每类最多 500 条；180 天内按日查看，最长 730 天按周聚合。项目 `timeZone` 决定日历边界。笔记自身的 `reviewedAt` 不参与裁剪，迁移不丢最近复习时间。

**持久化**：项目自动保存到 IndexedDB（当前 schema 版本 11），覆盖、改名、删除、恢复和 vault 操作前自动创建恢复点，每个项目最多 8 份。保存状态与分析状态相互独立展示。导入/导出 `.terrain.json` 完整项目包，导出 PNG 地图与 Markdown 复盘报告。

**Obsidian 集成**：见下面的 vault 章节。

工具菜单还提供"加载今日学习"，把从 X `@MeowTsutaki1` 可见转帖整理的 6 条带来源学习笔记（2026-08-03）直接生成一张地形，也可导入 `public/imports/x-reposts-2026-08-03.json`。

## 导入格式

每条记录至少需要 `content`。字段别名：

| 标准字段 | 可识别字段 | 说明 |
| --- | --- | --- |
| `title` | `name` | 缺省时取正文前 48 个字符 |
| `content` | `body`, `text`, `description` | 必填 |
| `createdAt` | `created_at`, `date`, `time` | ISO 日期或浏览器可解析日期 |
| `tags` | - | 字符串或字符串数组 |
| `source` | `url` | 可选来源 |
| `weight` | - | 可选数字权重 |
| `id` | - | 可选稳定 ID |

支持 JSON、YAML、CSV、TSV、Markdown 和纯文本。JSON/YAML 可以是数组，也可以把数组放在 `notes`、`items`、`data`、`entries` 或 `records` 字段中。

```json
[
  {
    "title": "设计系统中的间距",
    "content": "间距应表达信息层级，而不是只用于装饰。",
    "createdAt": "2026-05-06T09:30:00+08:00",
    "tags": ["设计系统", "排版"],
    "source": "daily-notes"
  }
]
```

Markdown 一个文件对应一条笔记，支持 YAML frontmatter：

```markdown
---
title: 设计系统中的间距
createdAt: 2026-05-06
tags: [设计系统, 排版]
area: design.systems
mastery: 0.65
confidence: 0.55
exploration: 0.90
status: growing
reviewedAt: 2026-08-10
---

间距应表达信息层级，而不是只用于装饰。
```

认知字段契约：`mastery`、`confidence`、`exploration` 必须是 `0..1` 数字；`status` 仅允许 `seed | growing | stable | gap | archived`；`reviewedAt` 必须是有效日期；未声明字段保持未知。

`.terrain.json` 是应用自身的完整项目格式，包含坐标、快照、峰值与派生记录，可无损恢复已生成的地形。

### 导入边界

普通导入会先本地预检：单文件 ≤ 4 MiB、单批 ≤ 500 文件且 ≤ 32 MiB、≤ 2,000 条记录、每条正文 ≤ 64 KiB，解析并发固定 4 路。`.terrain.json` 上限 64 MiB。超限会显示实际值与允许值并停下，只有你明确选择"按上限整理"才会去重与截断。解析可取消，取消不写入部分项目。

已验证范围：1800 条演示笔记可完成完整分析与全部交互门禁；2,000 条是当前有明确资源边界的最大导入规模，不代表 10k/50k 已获得性能保证。详见 [`docs/import-budget.md`](docs/import-budget.md)。

## Obsidian vault

**增量同步**：每次重新选择同一 vault 根目录。扫描为所有 Markdown 计算 SHA-256，但只重新解析新增或变化的文件。原路径优先匹配；路径变化时只在 frontmatter `id` / `uid` 或内容 hash 唯一时保留 source/item ID。应用内与 vault 同时改同一字段时逐字段选择。移除会保留 source tombstone 并归档笔记；不完整扫描不会推断删除。

**显式写回**：只允许 `mastery`、`confidence`、`exploration`、`status`、`area/areas`、`reviewedAt` 与逐条确认的 WikiLink；标题、正文、标签和 weight 不进入写回请求。写回前显示 vault 相对路径与 exact diff，多文件需二次摘要确认。授权后及实际写入前都会重新读取原始 bytes 校验 SHA-256，任一文件被外部修改则整批 0 写入。批量写入前把全部原始 bytes 原子存入 IndexedDB recovery batch，按路径串行写入，首个失败即停止并区分成功/失败/未尝试。

已知窗口：File System Access API 没有 compare-and-swap，最终 hash 校验到 `createWritable()` 之间存在极小并发修改窗口。应用缩小并记录该窗口，无法从浏览器侧彻底消除。

## 分析流程

1. 规范化并按内容指纹稳定排序笔记。
2. 用 `Xenova/multilingual-e5-small` 生成语义向量，优先 WebGPU，不支持时用 WASM。
3. 模型下载或初始化失败时切换到明确标记的确定性本地向量，界面标注"降级"，不静默降级。
4. 固定随机种子的 UMAP 生成二维坐标（`umap-js-2d-v1`），embedding model ID 与布局版本分别保存。
5. KDE、Gaussian blur 与对数高度整形生成月份累计地形，`bandwidth` 与 `gridSize` 一并记录以便复算。
6. 检测局部峰值并用附近笔记标签命名。

分析在 Web Worker 中运行，支持取消，不阻塞界面。项目信息中可查看当前 `modelId`（`semantic` 或 `deterministic-local-fallback`）。

## 本地开发

要求 Node.js 22.12 或更高版本。

```bash
npm run dev          # 开发服务
npm run build        # 生产构建
npm run preview      # 预览构建产物
```

门禁：

```bash
npm run typecheck
npm run lint
npm test
npm run build && npm run size:check
npm run test:e2e
npm run test:visual  # 仅本地，CI 不跑，理由见台账 A5
npm run test:a11y
npm run test:perf
```

首次运行 Playwright 前执行 `npx playwright install chromium`。`npm run test:perf` 自行启动并关闭 preview 服务（OS 分配空闲端口，绑定 127.0.0.1），要复用已有服务设置 `BASE_URL`。

CI 中浏览器安装通过 `node scripts/run-with-retry.mjs` 包装：`playwright install --with-deps` 会调用 apt-get，包镜像卡住时既不输出也不退出，会占满 job 超时并表现为难以归因的取消。该脚本把"长时间无输出"也视为失败并重试，同时按 Playwright 版本缓存浏览器。

```text
src/
  domain/       数据结构、视觉契约、认知语义与派生数据
  import/       JSON/CSV/TSV/Markdown/YAML 解析与预检
  pipeline/     向量化、UMAP、地形算法与 Worker
  scene/        React Three Fiber 3D 场景
  fallback/     2D SVG 地形
  storage/      IndexedDB 项目仓库与迁移
  export/       项目包、PNG 与报告导出
  store/        Zustand 应用状态
  ui/           工具栏、筛选、时间轴与详情面板
tests/          unit、integration、e2e、a11y、visual
docs/adr/       架构决策记录
```

技术栈：React 19、TypeScript、Vite、React Three Fiber、Zustand、`@huggingface/transformers`、umap-js、idb、Vitest、Playwright、oxlint。

## 部署

线上：<https://cognitive-terrain.eriri-blog.workers.dev>

```bash
npm run deploy       # 先构建，再用 wrangler 把 dist/ 发到 Cloudflare Workers Assets
```

配置在 [`wrangler.jsonc`](wrangler.jsonc)：纯静态资产，没有 Worker 脚本与后端，所有路由回落 `index.html`。
部署需要本机已登录 `wrangler login`（或设置 `CLOUDFLARE_API_TOKEN`）。

## 隐私与限制

- 笔记与生成的项目保存在当前浏览器的 IndexedDB 中，不上传到应用服务器。
- 首次模型加载会向模型托管源请求模型文件；完全离线环境自动使用降级向量。
- 清除站点数据会同时删除项目与本地恢复点，请定期导出 `.terrain.json` 作为站点外备份。
- 目录句柄保存在独立 binding store，不进入项目导出或恢复点；不提供跨设备同步。
- PNG 导出只包含地图画布，不含周围 UI。
- 超大模型/WASM 资源会使首次加载与生产构建体积偏大。

## 已知缺口

- `npm audit --omit=dev --audit-level=high` 报告 4 个 high、0 个 critical，无可用自动修复：`@huggingface/transformers` 经 `onnxruntime-node` 引入受影响的 `adm-zip`，并引入受影响的 `sharp`。
- 演示知识点主要是确定性模板数据，不等同于有来源、可引用的知识库。
- 已支持 8 份本地恢复点与 vault-sync 内容 revision，仍缺站点外自动备份、通用编辑修订历史、回收站与跨设备同步。
- 搜索仍以字符串匹配为主；小规模编辑会触发全量 embedding/UMAP，布局稳定性与 10k/50k 规模未验证。
- a11y 门禁当前排除暗色 8px 等宽小字的 `color-contrast` 规则，不能据此宣称完整 WCAG 2.2 AA。

架构决策见 [`docs/adr/`](docs/adr/)。独立审查结论与逐条处置见 [`docs/review/findings-ledger.md`](docs/review/findings-ledger.md)，其中 `npm audit` 的 high 项有显式接受理由与复核条件。成熟产品差距见 [GAP.md](GAP.md)。

[SESSION.md](SESSION.md) 是带 commit pin 的交接快照，不是当前状态源；判断现状请直接 fresh check Git 与 GitHub。
