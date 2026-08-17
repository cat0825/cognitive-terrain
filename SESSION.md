# Handoff 2026-08-17 19:42 CST

## 目标

按 Issue/PR 驱动推进 Cognitive Terrain。Issue #23 的本地优先 Obsidian vault 增量同步已提交 PR #33；下一项依赖任务是 Issue #24 的 opt-in diff-first write-back。

## 进度

- Issue #23：本地实现与定向验证 100%，分支 `codex/incremental-vault-sync`。
- PR：[#33](https://github.com/cat0825/cognitive-terrain/pull/33)，base=`main`，已关联 Issue #23，合并后自动关闭；GitHub quality check 正在运行，不等待 CI 继续本地工作。
- 路线图：[Issue #29](https://github.com/cat0825/cognitive-terrain/issues/29)。

## 已完成

- SHA-256 增量扫描：未变文件只计算 hash；新增、修改、安全重命名、移除、partial I/O 和 stale preview 有确定性预览。
- 稳定 source/item identity；三方字段合并；路径碰撞和模糊重命名在修正 vault 前禁止提交。
- 首次关联会比较现有项目与 vault 内容，差异逐字段确认，不会把扫描内容静默写成 accepted baseline。
- 重复标题 WikiLink 保持 unresolved；关系、Source、revision、activity provenance 和导出/恢复保留正确语义。
- IndexedDB v7：同步前恢复点、record-level materialization diff 和项目更新同事务提交；目录 binding 不进入项目包或恢复点。
- VaultSyncPanel：重新选择/重新授权目录、预览、冲突处理、不完整扫描提示、键盘焦点、桌面/移动无横向溢出。
- README 已记录同步规则、数据边界与已知限制。

## 验证

- `npx vitest run ...`：7 files / 61 tests passed；另一次全 unit/integration：19 files / 112 tests passed。
- `npm run typecheck`、`npm run lint`、`npm run build`、`git diff --check` 通过。
- `npm run size:check`：主包 342.2/346 KiB，JS 2190.6/2195 KiB，CSS 38.0/40 KiB。
- focused E2E：desktop/mobile 2/2 passed；focused a11y：desktop/mobile 2/2 passed。
- 截图：`output/playwright/vault-sync-preview-desktop.png`、`output/playwright/vault-sync-preview-mobile.png`（忽略目录，不入库）。

## 未完成

1. PR #33 的 GitHub CI/维护者 review 尚未完成。
2. PR #30 仍有 E2E timeout，PR #31 仍有 a11y timeout，PR #32 仍有 E2E/a11y/visual failure；三个 PR 的 quality 均通过，失败与 Issue #23 分支无关。
3. Issue #24 尚未开始实现；它依赖 Issue #23 的 source identity 与同步基线。

## 下一步

1. Fresh-check PR #33 的 checks/review；只处理可复现的本分支失败，不等待长耗时 CI 阻塞其他工作。
2. PR #33 可合并后，从更新后的 `main` 创建 Issue #24 feature 分支，先设计字节保真的 Markdown/frontmatter patch 与 exact-diff confirmation。
3. 分别处理 PR #30/#31/#32 的既有超时或断言失败，不把修复混入 PR #33。

## 风险 / 红线

- 当前产品流程使用 `webkitdirectory` 重新选择文件夹；持久目录句柄 store 已隔离，但 UI 尚未启用 retained handle。
- 当前同步只读 vault，不写回 Markdown；写回必须由 Issue #24 的 exact diff、显式确认、冲突检查和恢复证据保护。
- 不直接推 `main`；一个 implementation Issue 对应一个 feature branch 和一个 PR。
