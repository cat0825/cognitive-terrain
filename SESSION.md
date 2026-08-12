# Handoff 2026-08-12 15:32 CST

## 目标

整理并归档 `cognitive-terrain` 当前阶段成果，使后续接手者能区分已实现、已验证和待发布事项。

## 进度

- 百分比：本阶段知识维护 P0 与视觉加固代码 100%；仓库归档与验证 100%。
- 检查点：分支 `codex/release-plan-hardening`，GitHub `cat0825/cognitive-terrain`。
- 发布判断：可作为本地优先 Demo 候选；尚未达到成熟知识图谱产品的生产可用度。

## 当前状态（fresh check）

| 范围 | 代码状态 | 验证状态 | 未收尾项 |
| --- | --- | --- | --- |
| 知识维护 P0 | 已写：Markdown/YAML 元数据、WikiLink 关系、维护候选、语义补链候选、迁移脚本 | 已验证：unit 9 files / 25 tests | 迁移脚本尚未用用户真实 vault 做破坏性迁移；只允许输出到忽略目录 |
| 视觉与交互 | 已写：材质/点云/峰值/雾层、四种点云编码、旋转/平移、2D fallback、移动端遮挡修复 | 已验证：E2E 10/10、visual 2/2、a11y 4/4、桌面导出与 perf | Safari/Firefox、更多移动尺寸和真实大数据尚未验证 |
| 工程门禁 | CI 已包含 quality/e2e/a11y/visual；本地构建与 size budget 已通过 | typecheck、lint、build、size 均通过 | GitHub CI 需在推送后确认远端结果 |

`MATURITY-PLAN.md` 是从 Demo 走向成熟知识产品的后续路线图，不表示其中 Schema v3、真实来源库、引用式 RAG、同步等已完成。`RAINFORM-VISUAL-MIGRATION.md` 是视觉机制的设计依据，实际完成度以代码和本文件的 fresh check 为准。

## 本阶段完成清单与证据

- `npm run typecheck`：exit 0。
- `npm run lint`：exit 0，0 warning。
- `npm run test:unit`：9 test files / 25 tests passed。
- `npm run build`：TypeScript + Vite 构建成功；主包 278.16 kB，Three chunk 1,149.46 kB，分析 WASM 23.57 MB。
- `npm run size:check`：主包 269.5 KiB、JS 2068.4 KiB、CSS 22.4 KiB，budget passed。
- `npm run test:e2e`：desktop + mobile 共 10/10 passed。首次运行发现移动端 dock/欢迎横幅拦截控件及并行 WebGL 超时，最小修复后按原交互断言通过。
- `npm run test:visual`：2/2 passed；未用更新基线绕过失败。
- `npm run test:a11y`：4/4 passed；仍保留 README 所述对比度排除边界。
- `npm run test:perf`（预览 `http://127.0.0.1:4174/`）：idle/playback/orbit/scrub 约 120 FPS，p95 8.6–9.1 ms；Canvas 非背景像素 89.45%，PNG 924,082 bytes，console errors 0。该结果只代表本机 Chrome headless 1440×960、DPR 1.5。
- 机密扫描：排除 `.git/node_modules/dist/test-results/output` 后，未发现 `.env` 或高置信明文 key。

## 未完成 / 阻塞

1. 视觉回归已在 Chromium 跑完，不再阻塞；Firefox、Safari 与真机仍未覆盖。
2. `npm audit --omit=dev --audit-level=high` 仍有 4 high：Transformers.js 的 `onnxruntime-node → adm-zip` 与 `sharp`，上游当前无自动修复。
3. 模板 Demo 缺真实来源、引用和审核；不能宣传为可信知识库。
4. IndexedDB 单机数据缺修订、回收站、自动备份、迁移回滚与同步。
5. `migrate:local-notes` 只做非破坏性读取与 JSON 输出；没有替用户执行真实 vault 全量迁移。

## 下一步（优先级）

1. P0：推送后确认 GitHub Actions；锁定一个 release candidate，并复核 visual baseline 变更。
2. P0：为依赖漏洞建立升级跟踪；在上游无修复时记录威胁模型与浏览器/Node 路径边界。
3. P1：以真实来源、Citation、Revision 和可恢复备份替换模板数据/单对象仓。
4. P1：建立 10k/50k fixture，验证增量布局、近邻索引、内存峰值和跨浏览器表现。
5. P2：再做混合搜索、来源检查器与带证据的问答；不要先堆视觉效果。

## 风险 / 红线

- 不将模板生成的 1800 点描述为 1800 篇已核验资料。
- 不自动读取或改写真实 Obsidian/Tolaria vault；迁移默认只输出到 `output/migration/`。
- 不用更新截图基线代替视觉回归判断。
- 不用本机 120 FPS 推断低端设备性能。
- 不把 a11y 4/4 等同于完整 WCAG 合规。
