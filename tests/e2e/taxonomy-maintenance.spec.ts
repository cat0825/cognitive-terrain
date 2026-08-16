import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('cognitive-terrain:first-run', 'seen')
  })
})

test('previews and applies a recoverable taxonomy rename with a stable node id', async ({ page }) => {
  const errors = collectErrors(page)

  await page.goto('/')
  await page.getByRole('button', { name: '打开地图筛选' }).click()
  const panel = page.getByRole('complementary', { name: '地图筛选' })
  const maintenance = panel.getByRole('region', { name: '领域维护' })
  await expect(maintenance).toContainText('v1 · 7 个节点')
  await expect(maintenance).toContainText('暂无未解析标签')

  const nodeSelect = maintenance.getByLabel('重命名节点')
  await nodeSelect.selectOption({ label: 'Agent 系统' })
  const nodeId = await nodeSelect.inputValue()
  await maintenance.getByLabel('新名称').fill('Agent 平台')
  await maintenance.getByRole('button', { name: '预览' }).first().click()

  const preview = maintenance.getByRole('dialog', { name: '维护操作预览' })
  await expect(preview).toContainText('影响 60 条笔记、1 个节点')
  await preview.getByRole('button', { name: '确认操作' }).click()

  await expect(maintenance).toContainText('v2 · 7 个节点', { timeout: 15_000 })
  await expect(maintenance).toContainText('重命名完成', { timeout: 15_000 })
  await nodeSelect.selectOption({ label: 'Agent 平台' })
  await expect(nodeSelect).toHaveValue(nodeId)

  const overflow = await page.evaluate(() => {
    const element = document.querySelector('.filter-panel')
    return {
      body: document.body.scrollWidth - document.body.clientWidth,
      panel: element ? element.scrollWidth - element.clientWidth : -1,
    }
  })
  expect(overflow).toEqual({ body: 0, panel: 0 })
  expect(errors).toEqual([])
})

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}
