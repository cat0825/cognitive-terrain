# Rainform 视觉机制迁移方案

> 状态：本阶段视觉实现依据；完成度与验证证据以 `SESSION.md` 为准
>
> 调研日期：2026-08-07
>
> 目标仓库：`cognitive-terrain`
>
> 参考仓库：`afterimage-lab/Rainform`，审阅提交 `3cd4d24fae733ab71c6d2ea0946c0f5da30b01ed`

## 1. 结论

Rainform 值得迁移的不是雨、水面和瀑布，而是以下视觉组织方法：

1. 大面积暗部与少量高光共同建立明暗节奏。
2. 同一批粒子通过大小、透明度、亮度和深度形成前中后景。
3. 低位雾带负责连接主体与背景，避免对象像贴在黑底上。
4. Fresnel、移动反射带和局部镜面高光让无贴图材质仍有流动感。
5. 固定随机种子、TypedArray、批量几何和 GPU 动画保证画面稳定。
6. 相机按视口构图，不只按窗口宽度缩放。

Cognitive Terrain 不应复制 Rainform 源码、Shader 或参数结构。Rainform 使用
PolyForm Noncommercial License 1.0.0，商业产品、客户项目、品牌项目和商业服务
不能直接使用其代码或派生实现。本方案只保留一般视觉原则，所有实现必须独立编写。

## 2. 当前差距

### 2.1 Cognitive Terrain 当前表现

- 地形颜色几乎只由高度决定，坡面、脊线和凹谷缺少材质差异。
- 等高线在全画面保持相近权重，压过了山体本身的体积。
- 每个峰值使用相近尺寸、颜色和光晕，缺少主峰、次峰、远峰层级。
- 点大小主要由透视决定，文章重要性、时间和聚类位置没有进入视觉编码。
- 线性雾只负责远处裁切，没有山脚雾和低置信区域表达。
- 暖灰地形、暖白点和暖黄光晕集中在相近色温，画面容易发闷。
- 峰值光晕由每峰一个 Sprite 和一个 Mesh 组成，峰越多 draw call 越多。
- 峰标签最多以 60 Hz 更新 DOM 投影，旋转时可能成为后续扩展瓶颈。

### 2.2 Rainform 有效的原因

- 背景接近纯黑，但主体不是整体提亮，只在局部反射带和峰值区域出现银白。
- 粒子不是统一亮度：远景更暗、更细，近景更清晰，峰值附近更密。
- 雾带只占低位小区域，不会把整个画面洗灰。
- 动画主要更新 uniform 或批量 BufferAttribute，不创建逐对象 React 状态。
- 粒子布局使用固定 seed，截图、重载和交互后仍保持相同视觉结构。

## 3. 视觉目标

目标不是把知识地形改成“下雨”，而是形成冷静、深邃、可读的 AI Infra 山脉：

- 主峰有银白矿物高光，山谷保持近黑。
- 山脊亮、背坡暗，峰体在无纹理条件下仍有体积。
- 前景点清楚，远景点退入雾中；重要文章比普通文章更亮、更大。
- 新内容有短期微光，旧内容稳定存在，不持续闪烁。
- 低置信度、未分类和知识稀疏区以极弱山脚雾表达。
- 选中状态使用克制的暖金色，与冷灰主体形成唯一强对比。

建议初始色板，后续以截图校准：

| 用途 | 建议值 |
| --- | --- |
| 背景 | `#080a0b` |
| 地形低位 | `#0d1012` |
| 地形中位 | `#182024` |
| 地形高位 | `#7b878d` |
| 等高线 | `#c2c8c7` |
| 普通点暗部 | `#647178` |
| 普通点亮部 | `#d5e1e0` |
| 峰顶高光 | `#eef4f2` |
| 选中状态 | `#f0c96a` |
| 山脚雾 | `#70858e` |

该色板只定义方向。最终颜色必须同时通过桌面、移动端、Bloom 开关和 PNG 导出检查。

## 4. P0：高收益视觉重构

预计 2–3 个工作日。保持 Schema v2，不增加新依赖。

### 4.1 地形材质重写

修改：`src/scene/TerrainScene.tsx`

地形亮度由以下信号共同决定：

```text
finalLight =
  heightWeight
  + slopeLight
  + ridgeWeight
  + peakWeight
  + reflectionBand
  + fresnel
  - valleyOcclusion
  - distanceFade
```

实现约束：

- `high`：采样中心和四邻域高度，计算近似法线、坡度和曲率。
- `medium`：使用屏幕空间导数计算坡度，减少高度纹理采样。
- `low`：保留高度渐变和等高线，不启用动态反射。
- 反射带只更新 `uTime`，不得每帧重建材质或几何。
- 反射移动速度控制在 18–30 秒完成一次弱循环，不能出现扫描线感。
- 等高线透明度随坡度和距离下降，谷底和远景不应同样清晰。
- 所有新效果合并进现有 Terrain Shader，P0 不增加地形 draw call。

### 4.2 点云层级

修改：`src/scene/TerrainScene.tsx`

为每个点增加静态 BufferAttribute：

| 属性 | Schema v2 来源 | 视觉作用 |
| --- | --- | --- |
| `importance` | `note.weight` 归一化 | 点大小、亮度 |
| `freshness` | `createdAtMs` 在项目时间范围内归一化 | 新内容微光 |
| `peakAffinity` | 到距离最小峰值的归一化距离 | 峰顶附近更清晰 |
| `selected` | 已有动态属性 | 暖金色、尺寸提升 |
| `seed` | note ID 的稳定 hash | 微弱相位差 |

点大小建议：

```text
size = perspective
  * mix(0.78, 1.28, importance)
  * mix(0.88, 1.12, freshness)
  * mix(0.86, 1.18, peakAffinity)
```

实现约束：

- 所有属性在几何创建时一次生成；仅 `selected` 允许局部更新。
- 不增加第二套普通文章点云。
- 动画仅改变 Shader uniform；不逐点写入位置、颜色或尺寸。
- `prefers-reduced-motion` 下冻结时间相位。
- 高质量档最大点尺寸需要 clamp，避免近景点变成光斑。

### 4.3 峰值批处理

修改：`src/scene/TerrainScene.tsx`

把当前“每峰一个 Sprite + 一个 Sphere”替换为：

- 一个峰值 `Points` 批次，绘制核心亮点。
- 一个峰值 `Points` 批次或 InstancedMesh，绘制柔光。
- 每峰属性：`height`、`noteCount`、`freshness`、`selected`、`seed`。

峰值强度：

```text
peakStrength =
  0.40 * normalizedHeight
  + 0.30 * logNormalizedNoteCount
  + 0.20 * freshness
  + 0.10 * confidenceProxy
```

Schema v2 没有真实 confidence。P0 使用峰高和覆盖文章数形成
`confidenceProxy`，UI 不得把它展示为真实置信度。

目标：

- 主峰明显亮于次峰。
- 小峰只保留核心点，不出现同尺寸大光晕。
- 峰值相关 draw call 固定为 2–3 个，不随峰数量线性增长。

### 4.4 深度分层

修改：

- `src/scene/TerrainScene.tsx`
- `src/scene/Terrain3D.tsx`

实现：

- 继续使用场景雾，但远景同时降低饱和度、对比度和点尺寸。
- 前景保留更高局部对比，中景负责主体信息，远景只保留轮廓和少量峰。
- 相机 near/far 不扩大；避免深度精度下降。
- 高质量 DPR 上限仍为 `1.5`，不得照搬 Rainform 的 `1.75`。
- Bloom 不提高全局强度；新材质先降低发光面积，再校准 Bloom。

### 4.5 山脚雾带

新增：`src/scene/TerrainMist.tsx`

修改：`src/scene/TerrainScene.tsx`

独立实现一个低成本雾层：

- 单个低细分 PlaneGeometry 或一张全局 Points 批次。
- 使用固定 seed 的噪声，不使用每帧 `Math.random()`。
- 强度由低高度、低点密度和未分类比例共同驱动。
- 雾只在山脚和谷底出现，峰顶必须保持清晰。
- `high` 启用动态呼吸，周期 14–22 秒。
- `medium` 使用静态雾。
- `low` 关闭。
- 最大新增 1 个 draw call。

## 5. P1：构图与交互精修

预计 2 个工作日。

### 5.1 相机按内容包围盒适配

Rainform 会按桌面、平板、移动端选相机配置，并以内容包围盒校正距离。
Cognitive Terrain 应独立实现：

- 根据地形包围盒、峰标签安全区和视口纵横比计算最小相机距离。
- 保留当前创作视角，只调整距离和 target，不自由改变方向。
- 移动端优先完整显示山脉，不靠提高 FOV 硬塞内容。
- resize 后下一帧复算一次；移动端方向变化稳定后再复算一次。

预计修改：

- `src/scene/terrain-camera.ts`
- `src/scene/TerrainScene.tsx`
- `tests/unit/terrain-camera.test.ts`

### 5.2 标签 LOD

- 静止时显示 18–30 个标签，旋转时只显示 8–12 个高优先级标签。
- 相机运动期间标签投影上限 30 Hz，停止后立即补一次精确布局。
- 屏幕边缘、背面和互相遮挡的标签隐藏。
- 选中峰标签永远保留。
- 不为每篇文章创建 DOM 标签。

### 5.3 视觉配置集中化

新增：`src/scene/terrain-visual-profile.ts`

集中管理：

- 调色板
- 高/中/低质量档开关
- 点尺寸范围
- 雾强度
- 反射速度
- 峰值强度
- 标签数量和更新频率

该文件只存 Cognitive Terrain 自己的语义和参数命名，不复刻 Rainform 的
`TUNING` 或 `QUALITY` 对象结构。

## 6. P2：语义驱动视觉

与 `MATURITY-PLAN.md` 的 Schema v3 同步，不应先于可信数据层实施。

### 6.1 真实视觉属性

当 Schema v3 可用后，替换 P0 的代理值：

| 视觉属性 | 真实数据 |
| --- | --- |
| 点重要性 | authority、引用数、用户评分、访问频率 |
| 新鲜度 | source publishedAt、retrievedAt、lastReviewedAt |
| 峰置信度 | taxonomy 一致性、聚类稳定性、来源覆盖 |
| 山脚雾 | 未分类、低可信、解析失败、来源缺失 |
| 峰值光晕 | 内容覆盖、来源质量、近期更新 |
| 暗谷 | 知识缺口、低覆盖 taxonomy 节点 |

### 6.2 语义动画

- 新导入内容只在 1.2–2.0 秒内出现一次扩散，不永久呼吸。
- 时间轴播放时，高光沿新增文章进入对应山丘，不做无意义环境粒子。
- 冲突来源使用短暂双脉冲；过期区域使用降低饱和度，不使用红色警报铺屏。
- 选中来源路径可以短时显示，退出焦点后彻底移除。

## 7. 明确不迁移

| Rainform 机制 | 不迁移原因 |
| --- | --- |
| 雨柱、珍珠雨串 | 与文章/知识语义不符 |
| 水面、镜像、瀑布 | 会把知识地形误读成天气或液体装置 |
| 水花、泡沫、喷溅 | 持续动画噪声高，增加 CPU/GPU 更新 |
| GPU 涟漪高度场 | 需要额外 render target 和 pass，收益低 |
| 音效 | 知识库默认应安静 |
| 原生 Three.js 生命周期 | 当前 R3F 架构已稳定，无重写收益 |
| 单纯提高粒子总量 | 当前 1800 点已足够，问题在层级而非数量 |
| 全量照搬质量参数 | 两个项目的画布、粒子和后处理成本不同 |

## 8. 性能预算

2026-08-07 本机、Chrome headless、`1440 × 960`、DPR `1.5`、High 质量实测：

| 场景 | FPS | p95 frame | >16.7 ms | long task |
| --- | ---: | ---: | ---: | ---: |
| Idle | 120 | 9.2 ms | 0 | 0 |
| Playback | 120 | 9.2 ms | 0 | 0 |
| Orbit | 120 | 9.3 ms | 0 | 0 |
| Synthetic scrub | 120 | 9.2 ms | 0 | 0 |
| Direct store scrub | 120 | 9.1 ms | 0 | 0 |
| Pointer scrub | 120 | 9.2 ms | 0 | 0 |

P0 合并后的硬门槛：

- High 质量 `p95 <= 10.5 ms`，相对当前回退不超过 `1.2 ms`。
- 所有场景 `over16Ms = 0`，`longTasks = []`。
- P0 新增 draw call 不超过 1；峰值批处理后总 draw call 应净下降。
- 不新增全屏后处理 pass。
- 不在动画循环创建数组、颜色、纹理、材质或几何。
- 动态 BufferAttribute 每帧上传总量不得随笔记数线性增长。
- 10k 点压力测试仍使用单个普通点云批次。
- 移动端默认 Medium；Low 必须关闭动态反射、雾动画、Bloom 和峰标签。

## 9. 验收标准

### 9.1 视觉

- 至少能一眼区分主峰、次峰、远峰和谷地。
- 不同山丘的亮度、光晕和点密度不再相同。
- 旋转后山体仍有稳定体积，不因屏幕方向变化出现强烈闪烁。
- 等高线退为辅助信息，不再成为画面最亮的大面积元素。
- 雾不覆盖峰顶，不形成横贯全屏的灰色面板。
- 选中状态是全画面唯一持续暖色高光。
- 首屏、详情打开、时间轴播放和截图导出均保持一致色彩。

### 9.2 工程

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit`
- `npm run build`
- `npm run size:check`
- `npm run test:visual`
- `npm run test:perf`
- 桌面 `1440 × 960` 和移动端 `390 × 844` 人工截图检查
- Reduced Motion 模式人工检查
- 浏览器控制台 0 error，WebGL context loss 后仍显示既有 fallback

视觉基线只能在人工确认差异符合本文件后更新，不能用更新截图掩盖回归。

## 10. 实施顺序

1. 建立 `terrain-visual-profile.ts`，只迁移现有参数，不改变画面。
2. 批处理峰值核心和光晕，先降低 draw call。
3. 增加点云静态属性，保持默认参数视觉近似不变。
4. 重写 Terrain Shader，引入坡度、曲率、反射带和 Fresnel。
5. 调整雾、远景衰减和点云层级。
6. 加入单 draw call 山脚雾。
7. 实现相机 fit 和标签 LOD。
8. 逐档校准 High/Medium/Low。
9. 跑完整质量门，保存桌面、移动端和 Reduced Motion 证据。

P0 完成后应先停止继续加特效，检查它是否真的提升了“AI Infra 知识山脉”的
可读性。只有当层级、语义和性能三项同时通过，才进入 P1。
