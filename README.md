# Cognitive Terrain

把笔记按语义关系投影为可探索的认知地形。应用在浏览器中完成导入、向量化、二维布局、密度地形生成和本地保存，不需要业务后端。

## 功能

- 3D 地形与 2D 等高线双视图，WebGL 不可用时自动降级。
- 按月份回放知识积累过程，时间快照为累计数据。
- 搜索、标签筛选、峰值标签与笔记详情联动。
- 导入 JSON、CSV、TSV、Markdown、纯文本和 YAML。
- 导入/导出 `.terrain.json` 完整项目包，导出当前地图为 PNG。
- 项目自动保存到 IndexedDB。
- 分析在 Web Worker 中运行，支持取消，不阻塞主界面。
- 工具菜单提供“加载今日学习”，内置从 X `@MeowTsutaki1` 可见转帖整理的学习笔记（2026-08-03）；也可导入 `public/imports/x-reposts-2026-08-03.json`。

演示项目包含 1080 条确定性生成的中文笔记，首次打开即可操作。

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
npm test
```

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

## 分析流程

1. 规范化并按内容指纹稳定排序笔记。
2. 优先使用 `Xenova/multilingual-e5-small` 生成语义向量。
3. 优先使用 WebGPU，浏览器不支持时使用 WASM。
4. 模型下载或初始化失败时，切换到明确标记的确定性本地向量。
5. 使用固定随机种子的 UMAP 生成二维坐标。
6. 通过 KDE、Gaussian blur 和对数高度整形生成月份累计地形。
7. 检测局部峰值，并用附近笔记标签命名。

首次成功使用语义模型时，浏览器需要联网下载模型资源；后续是否复用缓存取决于浏览器缓存策略。降级向量不需要网络，但语义质量低于模型向量。

## 今日学习清单

打开项目工具菜单并选择“加载今日学习”，应用会将最近转帖整理为 6 条带来源的学习笔记，并通过现有分析 Worker 生成一张可搜索、可筛选的学习地形。重点主题包括 Agent Harness、长程 Agent 状态管理、评测、前端 Skill、UI 审查与产品视频工作流。

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
- 清除站点数据会删除 IndexedDB 项目，请先导出 `.terrain.json` 备份。
- PNG 导出当前只包含地图画布，不包含周围的筛选、时间轴和详情 UI。
- 超大模型/WASM 资源会使首次加载和生产构建体积较大。

## 模型模式

应用会显式区分两种向量来源，不会静默降级：

- **语义模式**：使用 `Xenova/multilingual-e5-small`（WebGPU / WASM）生成真实语义向量。
- **降级模式**：模型下载或初始化失败时，切换为确定性本地向量，界面会标注"降级"。

在项目信息中可查看当前项目的 `modelId`（`semantic` 或 `deterministic-local-fallback`）。

## 依赖审计

截至 2026-07-31，`npm audit` 报告 4 个 high、0 个 critical，且没有可用的自动修复：

- `@huggingface/transformers` 经 `onnxruntime-node` 引入受影响的 `adm-zip`。
- `@huggingface/transformers` 引入受影响的 `sharp`。

这些告警位于 Transformers.js 的 Node 侧依赖链，当前浏览器运行路径使用 WebGPU/WASM，但仍应随上游版本修复及时升级。部署前应根据实际威胁模型重新运行 `npm audit`。
