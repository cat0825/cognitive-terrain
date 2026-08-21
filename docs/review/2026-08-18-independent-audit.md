# Cognitive Terrain 独立审查报告

- 日期：2026-08-18
- 审查对象：`/Users/qianyuhe/Documents/GitHub/cognitive-terrain`
- 审查分支：`codex/terrain-evidence-inspector`，HEAD `7d98eea`
- 性质：只读审查，未修改任何源码；结论基于当前工作树 fresh check，不沿用历史会话记录
- 审查范围：数据模型、状态管理、时间语义、导入管线、reference atlas、验证体系、依赖与产品方向

## 总体结论

项目的基础工程质量可以接受：类型检查、lint、单元与集成测试、构建、体积预算均通过，领域逻辑有明确的版本化公式和证据契约。

真正的问题不在功能数量，而在于**功能堆叠速度已经超过数据模型和异步状态管理的可靠性**。当前存在四类系统性缺陷：

1. 时间语义不统一，时区边界会让时间轴与地形数据互相矛盾。
2. 导入与持久化不是原子的，界面可以显示成功而数据没有落盘。
3. 分析任务的取消依赖模块级全局句柄，存在真实竞态。
4. 声明的语义保证（忽略未来事件、版本化 atlas）在实现中没有完全兑现。

因此下一阶段不应继续优先做视觉概念、新地形维度或新交互，而应先修复数据可信度与验证体系。项目当前更接近“功能丰富的可交互演示”，尚未达到“结果可复现、失败可恢复、语义可解释的本地知识工具”。

## 当前状态核对

历史交接文档与当前工作树不一致，任何基于旧记录的“已完成/全绿”判断都不可直接采信。

| 项目 | 当前实际值 |
| --- | --- |
| 当前分支 | `codex/terrain-evidence-inspector` |
| HEAD | `7d98eea` |
| 落后同名远端分支 | 32 个提交 |
| 本地 `main` 落后 `origin/main` | 55 个提交 |
| `origin/main` | `59f1d91`（PR #37 合并） |
| 工作区 | 存在未跟踪目录 `output/` |
| `SESSION.md` | 已过期，记录 `67cc548` 与 PR #32 open，与远端状态不符 |

`HEAD..origin/main` 的差异达到 85 个文件、约 9433 行新增，包含 `vault-sync`、`vault-writeback`、`learning-progression`、`prerequisite-topology` 等主线能力。也就是说，本工作副本既不是主线，也不是主线的子集视图，本地验证结果只代表这个旧 stacked 分支。

## 验证账本

在当前分支实际执行的命令与结果：

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过，0 warnings / 0 errors，102 文件 / 104 规则 |
| `npm run test:unit` | 通过，23 files / 145 tests |
| `npm run build` | 通过，但存在超过 700 KiB chunk 警告 |
| `npm run size:check` | 通过，主包 334.1 KiB，JS 2241.1 KiB，CSS 40.0 KiB |
| `npm run test:a11y` | **失败**，11 passed / 1 failed |
| `npm run test:e2e` | **失败**，首个用例超时，整套在 240 秒被终止 |
| `npm run test:perf` | **失败**，`ERR_CONNECTION_REFUSED` |
| `npm audit --omit=dev` | **4 个 high**，无可用自动修复 |

失败细节：

- a11y：`tests/a11y/accessibility.spec.ts:39` 的 `getByText('已创建本地恢复点')` 在 5 秒内未出现，仅桌面端失败，移动端同名用例通过。
- e2e：`tests/e2e/exploration-loop.spec.ts:3` 耗时 45.1 秒失败；该套件单 worker 串行执行，后续用例未跑完。
- perf：`scripts/perf-check.mjs:34` 直接访问 `http://127.0.0.1:4174/?perf=1`，脚本自身不启动 preview server，必须依赖外部手工启动。

构建产物体积（gzip 前）：

- `ort-wasm-simd-threaded.asyncify` WASM：约 23.5 MB
- `three` chunk：约 1.15 MB
- `analysis.worker`：约 665 KB
- 主入口 `index`：约 342 KB

依赖告警链：`@huggingface/transformers` → `onnxruntime-node`、`sharp`；`onnxruntime-node` → `adm-zip`（GHSA-xcpc-8h2w-3j85）。这些包属于 Node 侧可选依赖，浏览器运行时风险有限，但仍会污染审计门禁，需要显式决策而不是长期忽略。

## 严重问题

### H1 时间轴按 UTC 计算月份边界，与项目时区分桶冲突

- 位置：[`src/domain/project-view.ts:36`](../../src/domain/project-view.ts)、[`src/scene/TerrainScene.tsx:1148`](../../src/scene/TerrainScene.tsx)
- 现状：两处都用 `Date.UTC(year, month, 1) - 1` 作为 `YYYY-MM` 的截止点。
- 冲突：快照分桶使用项目 `timeZone`（[`src/pipeline/terrain.ts:303`](../../src/pipeline/terrain.ts)）。

后果：在 `Asia/Shanghai` 这类正偏移时区下，8 月的截止点会包含 `08-31T16:00Z` 之后的事件，而这些事件在本地日历属于 9 月。于是：

- 时间轴可见笔记与地形栅格不一致
- 月份累计计数不可信
- 3D 点位与等高线来源数据不同步
- 对比模式的新增/消失差异出现虚假变化

这是核心语义 bug，优先级高于任何视觉改进。

修复方向：抽出单一时间模块，提供“项目时区下的下一个本地月初”换算，所有截止点计算只走这一处实现；补充 UTC 偏移、月末边界、DST 时区的单元测试与回放测试。

### H2 批量合并未对输入内部去重，导致内存状态与持久化状态分叉

- 位置：[`src/store/app-store.ts:419`](../../src/store/app-store.ts)、[`src/store/app-store.ts:570`](../../src/store/app-store.ts)、[`src/domain/schema-v3.ts:525`](../../src/domain/schema-v3.ts)

`mergeNotes` 只用既有项目 ID 过滤输入：

```ts
const existingIds = new Set(existing.map((note) => note.id))
const deduped = newNotes.filter((note) => !existingIds.has(note.id?.trim() ?? ''))
```

`newNotes` 内部的重复 ID 会保留下来。随后 `replaceProject` 先 `setProjectState` 再 `saveProject`，而 materialization 会拒绝重复 item ID。

后果链：分析成功 → 内存项目已替换 → IndexedDB 保存失败 → 用户刷新后回到旧数据。用户看到的是“分析成功但数据消失”，属于数据可信度问题，不只是错误提示不友好。

修复方向：在解析边界与 `mergeNotes` 边界按规范化 ID 或 fingerprint 去重并报告冲突；`replaceProject` 改为持久化成功后再提交内存状态，或失败时原子回滚；补“批内重复 ID”和“保存失败不改变当前项目”两条回归测试。

### H3 分析取消使用模块级全局句柄，缺少请求代际保护

- 位置：[`src/store/app-store.ts:163`](../../src/store/app-store.ts)、[`src/store/app-store.ts:348`](../../src/store/app-store.ts)、[`src/store/app-store.ts:565`](../../src/store/app-store.ts)

竞态路径：

1. 启动分析 A，`activeAnalysis = A`
2. 启动分析 B，先 `A.cancel()`，再 `activeAnalysis = B`
3. A 的 rejection 到达，其 `finally` 执行 `activeAnalysis = null`
4. B 仍在运行，但已无法被 `cancelAnalysis` 取消

同时，A 的 `catch` 会写入 `error`、`isAnalyzing: false`，覆盖 B 的进行中状态。快速连续导入、编辑后重分析、连点操作都会触发。

修复方向：为每次分析分配单调递增 generation，只有当前 generation 才允许更新 progress、project、error 并清理句柄；把句柄放入 store 实例而非模块全局。现有 [`tests/unit/worker-client.test.ts:26`](../../tests/unit/worker-client.test.ts) 只覆盖单请求取消，需补“取消 A 后立即启动 B”的竞态用例。

## 中等问题

### M1 未来时间戳会污染活动热度与海拔

- 位置：[`src/domain/activity-history.ts:97`](../../src/domain/activity-history.ts)、[`src/domain/activity-temperature.ts:44`](../../src/domain/activity-temperature.ts)、[`src/export/project-files.ts:182`](../../src/export/project-files.ts)

压缩逻辑只排除非法日期，不排除 `occurredAt > now`；热度用 `Math.max(0, now - occurredAt)` 把未来事件当成刚发生。README 第 26 行明确承诺未来输入会被忽略，实现没有兑现。

后果：导入一个未来时间戳的项目包，即可长期维持满热度，并改变 activity elevation、温度、最近活动与 reference gap 的 stale 判定。

修复方向：在项目包导入、`compactActivityHistory`、`buildActivitySummaries` 三个边界统一忽略未来事件，并保留可诊断的导入 warning；测试覆盖 future raw event、future aggregate、future `lastOccurredAt`。

### M2 reference gap 的评估时间在页面生命周期内被冻结

- 位置：[`src/App.tsx:78`](../../src/App.tsx)、[`src/domain/reference-gaps.ts:145`](../../src/domain/reference-gaps.ts)

`useState(() => Date.now())` 只在首次加载取时间，`retainLatestActivity` 又会丢弃晚于该时刻的活动。用户打开页面后再复习或编辑笔记，这些活动会被当作“未来事件”忽略。

后果：缺口图层、证据面板与 PNG 导出无法反映本次会话的活动，且与“最近活动”语义不一致。

修复方向：生成报告时使用当前时间，或让评估时间随用户活动刷新；若为导出可复现而需要冻结，必须把冻结时间作为显式的报告版本语义展示出来。补一条“页面加载后产生 reviewed 事件”的回归测试。

### M3 版本化 reference atlas 实际按当前 taxonomy 解释

- 位置：[`src/domain/reference-gaps.ts:127`](../../src/domain/reference-gaps.ts)、[`src/domain/types.ts:20`](../../src/domain/types.ts)、[`src/domain/schema-v3.ts:467`](../../src/domain/schema-v3.ts)

manifest 保存了 `taxonomyVersion`，但 schema 只校验其 `<= currentVersion`，计算时用 manifest 的 node ID 去查**当前** taxonomy 的 label 与 `parentId`，没有保存或读取版本快照。

后果：taxonomy 重命名、重挂或合并后，旧 atlas 仍显示旧版本号，却按新层级生成 `expectedNodeIds` 与缺口；历史报告不可复现，探索建议的 evidence fingerprint 会漂移。

修复方向：二选一并写入 ADR——atlas 创建时保存不可变 taxonomy node snapshot；或限制 active atlas 必须等于当前 taxonomy version，taxonomy 变更后强制失效并要求重新绑定。补 reparent / merge 后旧 atlas 的测试。

### M4 导入没有资源上限，误导入大 vault 即可拖垮页面

- 位置：[`src/import/parse.ts:8`](../../src/import/parse.ts)

整文件 `file.text()`，多文件用无上限 `Promise.all`，随后触发全量 embedding 与 UMAP。当前没有对单文件大小、文件数量、总记录数、单条内容长度、并发解析数做任何约束。

对本地优先应用来说，现实风险不是攻击而是误操作。演示项目验证到 1800 条，README 提到的更大规模缺少基准与降级策略，属于未经证明的产品承诺。

修复方向：建立可配置上限与预检阶段（规模、重复、非法时间、未知 taxonomy、预计耗时），分批或流式处理，UI 明确拒绝原因；加入极限输入测试与取消延迟预算。

## 低等问题

### L1 验证门禁不能独立复现

`test:perf` 依赖手工启动的 4174 端口，README 也把这一步写成注释提示。这类需要口头约定的门禁在 CI 与本地都容易被跳过，实际等于没有性能回归保护。

修复方向：脚本自行启动并关闭 preview server，或复用 Playwright `webServer` 配置。

### L2 交接文档靠人工维护，已成为误导来源

`SESSION.md` 与远端状态脱节，且历史上多次被当作“当前状态”引用。文档本身不是问题，把它当状态源才是问题。

修复方向：改为合并时自动生成，或明确标注“快照，仅对应某个 commit”，并在流程上禁止据此判断当前状态。

## 产品方向判断

之前的设计探索集中在基础层到分支的渐变、taxonomy 驱动的地质材质、reference atlas 海洋空间化。这些方向在叙事上成立，但不应作为下一阶段主线。理由很直接：当前最大的风险不是用户看不懂地形，而是用户看到的地形与报告可能并非由一致、可复现的数据计算得出。

另一个结构性风险是语义过载。同一个 `TerrainProject` 与同一条分析流程正在同时承载 embedding 语义空间、taxonomy、WikiLink、activity、mastery、learning progression、prerequisite topology、reference atlas gap、exploration feedback、vault sync 与 write-back。这些概念理论上可分离，但持续在共享结构上追加字段，会让“地形到底表达什么”越来越难验证。

因此建议设一条准入门槛：视觉层不再吸收新语义，直到每个已有维度都具备明确的数据来源、计算公式、时间语义、版本语义、缺失值语义、可复现规则与回归测试。

## 整改路线

### 第一阶段：可靠性修复

1. 建立统一时间模块，处理项目时区、月份边界与 DST，替换全部截止点计算。
2. 修复批内重复 ID，并让分析提交与持久化成为原子操作。
3. 为分析流程引入 request generation，隔离取消与状态写入。
4. 在三个边界统一忽略未来事件并保留 warning。
5. 修复 gap `evaluatedAt` 的生命周期语义。
6. 为以上每项补最小单元测试与集成测试。

### 第二阶段：把验证门禁修到真实可用

1. 修复桌面端恢复点 a11y 用例。
2. 定位 exploration E2E 超时的真实原因，区分产品竞态、测试等待条件与资源限制，不再单纯放大 timeout。
3. 让 `test:perf` 自启动 preview server。
4. 将 unit、e2e、a11y、visual、perf 拆成独立可重复运行的 CI job。
5. CI 与本地验证都明确基于当前 `origin/main`，避免旧 stacked 分支被当作主线。
6. 让交接文档自动生成，或降级为带 commit 标注的快照。

### 第三阶段：控制系统复杂度

1. 拆分 `TerrainProject`：稳定核心数据与可重建派生数据分离。
2. 明确哪些数据必须持久化，哪些可从 notes / events / taxonomy 重建。
3. 为 taxonomy、atlas、terrain formula、embedding model、UMAP layout 定义显式版本组合。
4. 把“分析成功”和“保存成功”建模为两个独立状态。
5. 为导入建立预检阶段，覆盖规模、重复、非法时间、未知字段与预计耗时。
6. 为 vault sync 与 write-back 单独定义事务边界、冲突策略与回滚策略。

### 第四阶段：再推进视觉功能

继续做视觉表达，但遵守语义隔离约束：

- 颜色只表达 taxonomy 或类型
- 渐变只表达显式的 prerequisite 或层级关系
- 海洋只表达 reference gap
- 活动只影响 activity 维度，不改变基础语义
- embedding 位置不表示因果、权威性或用户能力
- 所有视觉映射都能在证据检查器中追溯到原始字段与版本

## 未运行项

- `npm run test:visual`：未运行，本次以只读审查为主，且视觉基线与平台相关。
- E2E 剩余用例：首个失败后整套在 240 秒被终止，未获得完整结果。
- 大规模导入基准（10k / 50k）：项目当前没有对应脚本或基线。
