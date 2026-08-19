# Cognitive Terrain

把笔记按语义关系投影为可探索的认知地形。应用在浏览器中完成导入、向量化、二维布局、密度地形生成和本地保存，不需要业务后端。

## 功能

- 3D 地形与 2D 等高线双视图，WebGL 不可用时自动降级。
- 按月份回放知识积累过程，时间快照为累计数据。
- 搜索、标签筛选、峰值标签与笔记详情联动。
- 八种可视化口径：密度、熟练度、探索度、近期活跃海拔、学习进程、基础层级、活动温度和领域。近期活跃海拔（`activity-elevation-v1`）只映射带衰减的活动事件；学习进程（`learning-progression-v1`）只重放带时区的显式认知观测；基础层级只来自显式 prerequisite DAG；温度只把活动热度编码为颜色并保持知识密度海拔。它们都不改变稳定语义平面坐标，也不能互相替代。
- 熟练度来自显式 `mastery` 认知状态；学习进度保留自评、YAML 导入、复习结果和迁移来源。打开、编辑乃至单独的复习活动事件都不会提高熟练度。无历史时保留当前快照值但使用中性学习进程海拔并标记高不确定性；旧项目不补造历史。默认 profile 不衰减，只有显式选择版本化衰减 profile 才会随时间改变海拔。
- Obsidian `area` / `areas` 多领域归属与 WikiLink 关系可生成知识板块、跨域山脊和可解释碰撞带。方向只来自已解析的 source → target WikiLink；至少 2 组唯一笔记关系且正反向计数置信度达到 60% 才显示箭头，低样本或混合方向保持无向。
- Obsidian `prerequisites` / `buildsOn` 显式前置关系可生成基础层级地形：基础笔记位于低层，后代随 DAG 深度升高；关系 ID、声明来源、跨领域多父节点和诊断均保留，循环、自指、歧义与未解析目标不会参与结构海拔。
- 领域维护使用版本化 taxonomy node：稳定 ID 与显示名称分离，支持父子层级、Unicode/空白/大小写归一化别名、创建、重命名、重挂和合并预览；每次确认前创建恢复点。导入时同时保留原始声明标签与解析后的 node ID，未分类和未解析标签进入维护队列。
- 焦点模式：选中笔记后一键飞行到该笔记；点击峰标签高亮该峰并绘制峰内笔记的路径连线。
- 地形语义图例与证据检查器统一解释平面位置、山峰、海拔、颜色、叠加层、板块、碰撞和参考缺口。笔记邻居分别显示原始 embedding 分数/rank/model、近似 UMAP 二维距离、taxonomy、tags 和显式 WikiLink；峰、碰撞与缺口可追溯公式版本、来源和证据 ID，2D/3D 共用同一契约。
- 峰值标签按视口、缩放、重要性和碰撞占位确定显示层级；移动端同屏最多 8 个，选中标签始终优先。
- 对比模式：选中时间基准层，直接回放比较新增/消失笔记差异。
- 编辑模式：直接修改标题、正文和标签，重新分析后保留稳定的笔记 ID。
- 导入 JSON、CSV、TSV、Markdown、纯文本和 YAML。
- Obsidian vault 支持本地增量同步：重新选择同一目录后预览新增、修改、重命名、移除和字段冲突；确认前创建恢复点，未变化文件不会重新解析。写回认知字段或逐条接受的 WikiLink 时会单独请求目录读写权限并展示 exact diff，不上传文件或静默修改 Markdown。
- 导入/导出 `.terrain.json` 完整项目包，导出当前地图为 PNG，导出 Markdown 复盘报告。
- 项目自动保存到 IndexedDB，支持增量合并新笔记；覆盖、改名、删除和恢复前会自动创建本地恢复点，每个项目最多保留 8 份。
- IndexedDB v10 同时保存 workspace、item、source、relation、认知状态、taxonomy node、reference-atlas manifest、探索生命周期、前置关系拓扑、布局、原始 embedding 邻居证据、revision 与 vault writeback recovery；不同项目通过复合键隔离。目录句柄保存在独立 binding store，不进入项目导出或恢复点。reference atlas 必须显式绑定 taxonomy version，不会把模型聚类自动声明为权威学科。
- 海洋/知识缺口（`reference-gap-v1`）只表示当前项目相对显式选中的 active reference atlas 的 taxonomy 覆盖差距。未选择有效 atlas 时该计算为 disabled，不输出用户知识或技能缺口声明；低活动不等于缺口。
- 探索工作台把所选参考缺口、陈旧复习、未解析双链、未评估/低置信度笔记和用户明确标记的 `gap` 目标转换为最多 8 条确定性建议；当前工作集最多 3 项。每条建议保留 reason code、支持项、参考边界、来源回跳、下一步动作与本地生命周期历史，活动分数不会单独触发建议。
- 活动历史按 retention policy v1 有界保存：打开/编辑/复习原始事件分别保留 30/180/365 天，每条笔记每类最多 500 条；180 天内可按日查看，最长 730 天按周聚合。项目 `timeZone` 决定日历边界，非法时间戳会被忽略。聚合保留每类事件的计数、首末时间和衰减热度；笔记自身的 `reviewedAt` 不参与裁剪，因此迁移不会丢失最近复习时间。超过 730 天的活动不再出现在历史或温度计算中，也不承诺作为审计档案。
- `activity-elevation-v1` 使用打开（weight 1，半衰期 7 天）、编辑（3，30 天）、复习（2.5，14 天）的指数衰减；`score = 1 - exp(-rawHeat / 3)`。同一事件 ID 去重，打开事件在 60 秒内只计一次；保留聚合以其首末时间、计数和 compaction heat 参与计算，raw/aggregate provenance 在详情证据中分开显示。非法、未来或不支持的输入会被忽略，评估时间固定后结果确定。
- 分析在 Web Worker 中运行，支持取消，不阻塞主界面。
- 工具菜单提供“加载今日学习”，内置从 X `@MeowTsutaki1` 可见转帖整理的学习笔记（2026-08-03）；也可导入 `public/imports/x-reposts-2026-08-03.json`。

演示项目包含 1800 条确定性生成的中文笔记，首次打开即可操作。

## 本地运行

要求 Node.js 22.12 或更高版本。

```bash
npm install
npm run dev
```

生产构建与本地预览：

```bash
npm run build
npm run preview
```

质量检查：

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build
npm run size:check
npm run test:e2e
npm run test:visual
npm run test:a11y
npm run test:perf
```

`npm run test:perf` 会自行启动并关闭 preview 服务（OS 分配空闲端口，绑定 127.0.0.1），不再需要另开终端；若要复用已有服务，设置 `BASE_URL` 即可。性能预算与基线见 [`docs/perf-budget.md`](docs/perf-budget.md)。

首次运行 Playwright 时需先执行 `npx playwright install chromium`。

## 导入格式

每条记录至少需要 `content`。支持的字段别名：

| 标准字段 | 可识别字段 | 说明 |
| --- | --- | --- |
| `title` | `name` | 缺省时取正文前 48 个字符 |
| `content` | `body`, `text`, `description` | 必填 |
| `createdAt` | `created_at`, `date`, `time` | ISO 日期或浏览器可解析日期 |
| `tags` | - | 字符串或字符串数组 |
| `source` | `url` | 可选来源 |
| `weight` | - | 可选数字权重 |
| `id` | - | 可选稳定 ID |

### JSON / YAML

可以直接提供数组，也可以把数组放在 `notes`、`items`、`data`、`entries` 或 `records` 字段中。

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

### CSV / TSV

```csv
title,content,createdAt,tags,source
设计系统中的间距,"间距应表达信息层级。",2026-05-06,"设计系统,排版",daily-notes
```

### Markdown / 纯文本

一个文件对应一条笔记。Markdown 可使用 YAML frontmatter：

```markdown
---
title: 设计系统中的间距
createdAt: 2026-05-06
tags:
  - 设计系统
  - 排版
---

间距应表达信息层级，而不是只用于装饰。
```

`.terrain.json` 是应用自身的完整项目格式，包含笔记坐标、月份快照和峰值，可无损恢复已经生成的地形。

`area` / `areas` 仍是用户声明的领域标签。应用按 NFKC、连续空白和大小写确定性解析 taxonomy 别名，同时在 `declaredAreas` 与 plate membership provenance 中保留导入标签；taxonomy 重命名和重挂不会改变稳定 node ID。

### Obsidian vault 增量同步

从项目菜单选择“同步 Obsidian vault”，每次重新选择同一个 vault 根目录。扫描会为所有 Markdown 计算 SHA-256，但只重新解析新增或内容变化的文件；隐藏目录和非 Markdown 文件会被忽略。

- 原路径优先匹配；路径变化时只在 frontmatter `id` / `uid` 或原始内容 hash 唯一时保留 source/item ID。候选不唯一或归一化路径碰撞时必须先修正 vault 后重扫。
- 应用内和 vault 同时修改同一字段时逐字段选择保留应用版本或采用 vault 版本。无效 YAML 字段保留上次已接受值，并在预览中报告。
- 完整扫描中的移除会保留 source tombstone 并归档笔记；读取失败或多 vault 混合造成的不完整扫描不会推断删除。
- 已接受内容生成 `vault-sync` revision。有效文件修改时间只用于事件时间；不可用或晚于确认时间时明确回退到确认时间。重复扫描和与应用内相同的编辑不会重复增加活动温度。
- `.terrain.json` 导出/恢复保留 source 身份、同步基线和 revision provenance，但不包含浏览器目录权限。当前版本不提供跨设备同步。

### Obsidian vault 显式写回

从项目菜单选择“写回 Obsidian vault”，或在笔记详情中选择待写回字段/语义候选。写回只允许 `mastery`、`confidence`、`exploration`、`status`、`area/areas`、`reviewedAt` 与逐条确认的 WikiLink；标题、正文、标签和 weight 不会进入写回请求。

- 应用先显示 vault 相对路径、同步 source hash 和 exact diff；单文件一次确认，多文件还需要第二次摘要确认。
- 授权后及实际写入前都会重新读取原始 bytes 并检查 SHA-256。任一文件已被外部修改时整批保持 0 写入，需要先重新同步。
- 批量写入前会把全部原始 bytes 原子保存到 IndexedDB recovery batch，然后按路径串行写入；首个失败后停止，结果明确区分成功、失败与未尝试，并保留恢复材料。
- 写回成功会更新 source baseline，并记录独立的 `vault-writeback` revision，避免下一次增量同步把本次写回误判为外部修改。
- 目录写入依赖浏览器 File System Access API。该 API 没有 compare-and-swap，最终 hash 校验到 `createWritable()` 之间仍存在极小的并发修改窗口；应用缩小并记录该窗口，但无法从浏览器侧彻底消除。

## 分析流程

1. 规范化并按内容指纹稳定排序笔记。
2. 优先使用 `Xenova/multilingual-e5-small` 生成语义向量。
3. 优先使用 WebGPU，浏览器不支持时使用 WASM。
4. 模型下载或初始化失败时，切换到明确标记的确定性本地向量。
5. 使用固定随机种子的 UMAP 生成二维坐标（`umap-js-2d-v1`）；embedding model ID 与布局算法版本分别保存。
6. 通过 KDE、Gaussian blur 和对数高度整形生成月份累计地形。
7. 检测局部峰值，并用附近笔记标签命名。

首次成功使用语义模型时，浏览器需要联网下载模型资源；后续是否复用缓存取决于浏览器缓存策略。降级向量不需要网络，但语义质量低于模型向量。

## 今日学习清单

打开项目工具菜单并选择“加载今日学习”，应用会将截至 2026-08-03 收集的转帖整理为 6 条带来源的学习笔记，并通过现有分析 Worker 生成一张可搜索、可筛选的学习地形。重点主题包括 Agent Harness、长程 Agent 状态管理、评测、前端 Skill、UI 审查与产品视频工作流。

## 代码结构

```text
src/
  domain/       数据结构、演示项目与视图查询
  import/       JSON/CSV/TSV/Markdown/YAML 解析
  pipeline/     向量化、UMAP、地形算法与 Worker
  scene/        React Three Fiber 3D 场景
  fallback/     2D SVG 地形
  storage/      IndexedDB 项目仓库
  export/       项目包与 PNG 导出
  store/        Zustand 应用状态
  ui/           工具栏、筛选、时间轴与详情面板
tests/unit/     算法、导入与 Worker 回归测试
```

## 隐私与限制

- 笔记和生成项目保存在当前浏览器的 IndexedDB 中，不上传到应用服务器。
- 首次模型加载会向模型托管源请求模型文件；对完全离线环境会自动使用降级向量。
- 清除站点数据会同时删除 IndexedDB 项目和本地恢复点，请定期导出 `.terrain.json` 作为站点外备份。
- PNG 导出当前只包含地图画布，不包含周围的筛选、时间轴和详情 UI。
- 超大模型/WASM 资源会使首次加载和生产构建体积较大。

## 模型模式

应用会显式区分两种向量来源，不会静默降级：

- **语义模式**：使用 `Xenova/multilingual-e5-small`（WebGPU / WASM）生成真实语义向量。
- **降级模式**：模型下载或初始化失败时，切换为确定性本地向量，界面会标注"降级"。

在项目信息中可查看当前项目的 `modelId`（`semantic` 或 `deterministic-local-fallback`）。

## 已知缺口

- 2026-08-12 fresh check：`npm audit --omit=dev --audit-level=high` 报告 4 个 high、0 个 critical，且没有可用的自动修复：

  - `@huggingface/transformers` 经 `onnxruntime-node` 引入受影响的 `adm-zip`。
  - `@huggingface/transformers` 引入受影响的 `sharp`。

- 演示知识点主要是确定性模板数据，不等同于有来源、可引用的知识库。
- IndexedDB 已支持最多 8 份本地恢复点和 vault-sync 内容 revision，但仍缺站点外自动备份、通用编辑修订历史、回收站和跨设备同步。
- 搜索仍以字符串匹配为主；小规模编辑会触发全量 embedding/UMAP，布局稳定性和 10k/50k 数据规模未验证。
- a11y 门禁当前排除了暗色 8px 等宽小字的 `color-contrast` 规则，不能据此宣称完整 WCAG 2.2 AA。

完整交接见 [SESSION.md](SESSION.md)，成熟产品差距见 [GAP.md](GAP.md)。
