# 审查发现台账

- 来源：[`2026-08-18-independent-audit.md`](2026-08-18-independent-audit.md)（审查于 `codex/terrain-evidence-inspector` HEAD `7d98eea`）
- 台账维护：随修复 PR 更新，每条发现只允许一个状态
- 关联 milestone：`v1.3 - Reliability and Reproducibility`（[Issue #51](https://github.com/cat0825/cognitive-terrain/issues/51)）

状态定义：

- **fixed**：已合并修复，附 PR 与 merge commit。
- **accepted**：明确接受当前行为，附接受人与理由。不是"以后再说"。
- **tracked**：仍有未完成工作，附跟踪 Issue。

## 严重问题

| 发现 | 状态 | Issue | PR / merge commit | 说明 |
| --- | --- | --- | --- | --- |
| H1 时间轴按 UTC 计算月份边界，与项目时区分桶冲突 | fixed | — | [#52](https://github.com/cat0825/cognitive-terrain/pull/52) `9e073eee` | 抽出统一日历时间模块 `src/domain/calendar-time.ts`，所有月份截止点只走这一处。回归见 `tests/unit/calendar-time.test.ts` |
| H2 批量合并未对输入内部去重，内存状态与持久化状态分叉 | fixed | — | [#52](https://github.com/cat0825/cognitive-terrain/pull/52) `9e073eee` | 批内按规范化 ID 去重；`replaceProject` 改为持久化成功后再提交内存状态。例外见下方 accepted 条目 |
| H3 分析取消使用模块级全局句柄，缺少请求代际保护 | fixed | — | [#52](https://github.com/cat0825/cognitive-terrain/pull/52) `9e073eee` | 每次分析分配单调递增 generation，只有当前 generation 能写 progress/project/error。回归见 `tests/unit/latest-request.test.ts` |

## 中等问题

| 发现 | 状态 | Issue | PR / merge commit | 说明 |
| --- | --- | --- | --- | --- |
| M1 未来时间戳污染活动热度与海拔 | fixed | [#41](https://github.com/cat0825/cognitive-terrain/issues/41) | [#54](https://github.com/cat0825/cognitive-terrain/pull/54) `f3f677e2` | 压缩、热度、陈旧判定三个边界统一忽略超过 5 分钟时钟偏移容差的输入，导入以 warning 列出忽略条数。回归见 `tests/unit/future-activity.test.ts` |
| M2 reference gap 评估时间在页面生命周期内被冻结 | fixed | [#42](https://github.com/cat0825/cognitive-terrain/issues/42) | [#56](https://github.com/cat0825/cognitive-terrain/pull/56) `b8d11afa` | 评估时间改为由项目 `updatedAt` 派生（`src/domain/evaluation-time.ts`），随活动前进而非页面加载冻结 |
| M3 版本化 reference atlas 实际按当前 taxonomy 解释 | fixed | [#43](https://github.com/cat0825/cognitive-terrain/issues/43) | [#65](https://github.com/cat0825/cognitive-terrain/pull/65) `bb6d3151` | 采用 snapshot 方案并写入 [ADR-004](../adr/004-reference-atlas-taxonomy-snapshot.md)：atlas 绑定不可变 taxonomy 快照，legacy atlas 在 taxonomy 变化后禁用并要求显式重绑 |
| M4 导入没有资源上限 | fixed | [#44](https://github.com/cat0825/cognitive-terrain/issues/44) | [#64](https://github.com/cat0825/cognitive-terrain/pull/64) `6873f95a` | 建立可配置上限与预检阶段，见 [`docs/import-budget.md`](../import-budget.md)。10k/50k 规模仍未验证，见下方 accepted 条目 |

## 低等问题

| 发现 | 状态 | Issue | PR / merge commit | 说明 |
| --- | --- | --- | --- | --- |
| L1 验证门禁不能独立复现（`test:perf` 依赖手工启动 4174） | fixed | [#45](https://github.com/cat0825/cognitive-terrain/issues/45) | [#61](https://github.com/cat0825/cognitive-terrain/pull/61) `b3cacd3e`、[#62](https://github.com/cat0825/cognitive-terrain/pull/62) `82f901b9`、[#63](https://github.com/cat0825/cognitive-terrain/pull/63) `869cb2fe` | 脚本自行构建、启动并关闭 preview server（OS 分配端口），CI 纳入 perf job |
| L2 交接文档靠人工维护，已成误导来源 | fixed | — | 本 PR | `SESSION.md` 顶部固定 commit pin 与"必须 fresh check"警示；README 明确它是快照而非状态源。见下方"交接文档约定" |

## 审查同时提出的整改项

| 项目 | 状态 | Issue | PR / merge commit |
| --- | --- | --- | --- |
| 桌面端恢复点 a11y 用例失败 | accepted | — | 见下方 A3 |
| exploration E2E 超时 | accepted | — | 见下方 A3 |
| 视觉基线漂移导致 visual 门禁不可判读 | fixed | [#46](https://github.com/cat0825/cognitive-terrain/issues/46) | [#53](https://github.com/cat0825/cognitive-terrain/pull/53) `acb08ad6` |
| CI 拆成独立可重复 job | fixed | — | [#60](https://github.com/cat0825/cognitive-terrain/pull/60) `ffaebb04`，成本取舍见 [`docs/ci-cost.md`](../ci-cost.md) |
| vault sync / write-back 事务边界 | fixed | [#47](https://github.com/cat0825/cognitive-terrain/issues/47) | [#59](https://github.com/cat0825/cognitive-terrain/pull/59) `93773823` |
| 拆分 core / derived 数据并定义显式版本组合 | fixed | [#49](https://github.com/cat0825/cognitive-terrain/issues/49) | [#66](https://github.com/cat0825/cognitive-terrain/pull/66) `fa0e60c5`，见 [ADR-005](../adr/005-core-derived-split.md) |
| 分析成功与保存成功建模为独立状态 | fixed | [#49](https://github.com/cat0825/cognitive-terrain/issues/49) | [#66](https://github.com/cat0825/cognitive-terrain/pull/66) `fa0e60c5` |
| 视觉层语义准入门槛 | fixed | [#50](https://github.com/cat0825/cognitive-terrain/issues/50) | [#67](https://github.com/cat0825/cognitive-terrain/pull/67) `dc0ecd1e`，见 [ADR-006](../adr/006-visual-dimension-contract.md) |

## 明确接受的例外

每条都是有意接受，不是遗漏。接受人为仓库维护者（`@cat0825`），日期 2026-08-21。

### A1 `commit.vaultSync` 路径的原子性弱于普通保存

- 来源：H2 修复过程中发现并记录
- 位置：[`src/store/app-store.ts`](../../src/store/app-store.ts) 的 `vault-sync` 提交分支
- 行为：vault-sync 提交先写 IndexedDB 事务，成功后才切换内存项目，与 `persistProject` 同一不变量。但它跨 `saveVaultSyncProject` 与后续 store 更新两个步骤，不是单一事务。
- 接受理由：真正的原子边界在 IndexedDB 事务内，保存失败时内存项目不切换，用户不会看到"已同步但未落盘"。要把 store 更新也纳入同一事务需要把 Zustand 状态机塞进 IDB 事务回调，代价明显高于收益。
- 残余风险：保存成功后、store 更新前进程被杀，则下次启动读到已落盘的新数据，界面与磁盘仍然一致，方向是安全的。

### A2 `npm audit --omit=dev` 的 4 个 high 不阻塞发布

- `adm-zip <0.6.0`（[GHSA-xcpc-8h2w-3j85](https://github.com/advisories/GHSA-xcpc-8h2w-3j85)，构造 ZIP 触发 4GB 内存分配），链路 `@huggingface/transformers` → `onnxruntime-node` → `adm-zip`
- `sharp <0.35.0`（[GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj)，继承 libvips 的 CVE-2026-33327/33328/35590/35591），链路 `@huggingface/transformers` → `sharp`
- 状态：accepted，无可用自动修复（`No fix available`）
- 接受理由：两者都是 `@huggingface/transformers` 的 **Node 侧可选依赖**。本应用完全在浏览器运行，向量化走 WebGPU/WASM 后端，`onnxruntime-node` 与 `sharp` 不进入构建产物。已核对：`rg 'onnxruntime-node|sharp|adm-zip' dist/` 无命中。攻击面需要在 Node 侧用这两个包处理不可信 ZIP 或图片，本项目没有该路径。
- 复核条件：出现上游修复版本时升级；若将来引入任何 Node 侧运行时（SSR、构建期图片处理、CLI），此接受立即失效，必须重新评估。

### A3 审查所见的 a11y 与 e2e 失败属分支现场，非主线缺陷

- 来源：审查「验证账本」中的 `test:a11y` 1 failed 与 `test:e2e` 首个用例超时
- 事实核对：审查在 `codex/terrain-evidence-inspector` HEAD `7d98eea` 上执行，该分支当时**落后 `origin/main` 55 个提交**，审查报告自己也指出「本地验证结果只代表这个旧 stacked 分支」。
- 接受理由：这两条不是主线缺陷，而是过期分支的现场，不应作为主线缺陷跟踪。对应稳定性工作已由 [#39](https://github.com/cat0825/cognitive-terrain/pull/39) `859efd70`（拆分 desktop/mobile job、放宽软件 WebGL 超时）与 `5f29177`（exploration loop CI 稳定化）在主线完成，因此不单独开修复 Issue。
- 当前主线实测（2026-08-21，`origin/main` `dc0ecd1`）：`npm run test:a11y` 16 passed；`npm run test:e2e -- --project=desktop` 21 passed / 1 skipped；CI 上 a11y、e2e desktop 1-4、e2e mobile 1-2 全部 SUCCESS。
- 残余风险：本地并行跑满 a11y 套件时偶发单用例 flake（曾见 recovery menu、vault-sync preview 各一次），单独重跑与 CI 均通过。未达到需要单独 Issue 的程度，若在 CI 复现则升级为 tracked。

### A4 10k / 50k 规模未验证

- 状态：accepted 为已知边界，不是缺陷
- 行为：导入预检强制 2,000 条记录上限并显示实际值与允许值，超限默认拒绝。
- 接受理由：与其宣称未经证明的规模，不如给出有明确资源边界的上限。README「已知缺口」已声明该边界。
- 复核条件：若要提高上限，先建立 10k/50k 基准脚本与降级策略，再改限额。

## `output/` 目录决策

审查要求单独决定 `output/imagegen/` 等视觉探索产物的归属。

决策：**不进仓库，纳入 `.gitignore`**。

| 目录 | 体积 | 处置 |
| --- | --- | --- |
| `output/imagegen/` | 12 MB | ignore。视觉概念探索图，属于 [#28](https://github.com/cat0825/cognitive-terrain/issues/28) 的讨论材料，需要时贴到 issue thread |
| `output/migration/` | 9.2 MB | ignore（已在 `.gitignore`） |
| `output/playwright/` | 34 MB | ignore（已在 `.gitignore`），测试产物 |
| `output/reference-video/` | 2.3 MB | ignore（已在 `.gitignore`） |
| `output/watch-reference-20260731/` | 272 KB | ignore（已在 `.gitignore`） |

理由：这些是生成物与参考素材，不是源码或决策记录。合计 57 MB 进 git 历史会永久拖累 clone，且它们不参与构建、测试或任何门禁。真正需要长期保留的设计结论属于 ADR，已经在 `docs/adr/`。

## 交接文档约定

`SESSION.md` 是**快照**，不是状态源。约定：

1. 顶部必须写明对应的 `origin/main` commit 与生成时间。
2. 任何"当前状态"判断必须先 fresh check：`git fetch --prune origin`、`git status`、`gh pr list`、`gh issue list`。
3. 不得在 PR 描述、Issue 或 review 中把 `SESSION.md` 当作现状依据引用。

这条约定针对的是 L2 指出的真实问题：文档本身无害，把它当状态源才有害。
