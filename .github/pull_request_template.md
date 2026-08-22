## 变更内容

<!-- 改了什么，为什么。关联 Issue 用 Closes #NN。 -->

## 验证

<!-- 实际跑过的命令与结果。没跑的门禁要写原因。 -->

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build` 与 `npm run size:check`
- [ ] 受影响的 `npm run test:e2e` / `test:a11y` / `test:perf`
- [ ] 改了布局或样式时的 `npm run test:visual`（**仅本地有**，CI 不跑，理由见台账 A5）

## 视觉维度准入

改动涉及地形语义、视觉通道或证据检查器时必须逐条确认，契约见
[`docs/adr/006-visual-dimension-contract.md`](../docs/adr/006-visual-dimension-contract.md)。
不涉及时勾选「不适用」。

- [ ] 不适用：本 PR 不新增也不改变任何视觉通道语义。
- [ ] `tests/unit/visual-contract.test.ts` 通过，`evaluateVisualContract()` 为空。
- [ ] 新增或改动的通道在 `VISUAL_DIMENSION_CONTRACT` 有填满的行，公式版本来自拥有它的模块常量。
- [ ] 契约行链接的测试真的证明可复现规则与缺失值行为。
- [ ] 遵守通道分离约束：颜色不承载认知状态强弱；海洋只承载参考缺口；活动只叠加不改写基础语义；embedding 位置不表示能力。
- [ ] 证据检查器能把该通道追回原始字段与版本。

## 风险与回滚

<!-- 已知风险、迁移影响、如何回滚。 -->
