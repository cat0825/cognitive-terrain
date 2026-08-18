import { expect, test, type Page } from '@playwright/test'

test('completes and reloads an explainable exploration loop', async ({ page }, testInfo) => {
  test.setTimeout(process.env.CI ? 120_000 : 45_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    localStorage.setItem('cognitive-terrain:first-run', 'seen')
    localStorage.setItem('cognitive-terrain:embedding', 'deterministic')
  })
  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '打开项目菜单' }).click()
  await page.getByRole('button', { name: '加载今日学习' }).click()
  await expect(page.getByRole('button', { name: '当前时间层' })).toContainText('2026年8月', { timeout: 30_000 })
  await openOverview(page)

  const workbench = page.getByRole('region', { name: '探索工作台' })
  await expect(workbench).toBeVisible()
  await expect(workbench).toContainText('未选择参考图谱，不生成覆盖缺口建议')
  const queue = workbench.getByRole('region', { name: '探索建议队列' })
  const proposed = queue.locator('[data-exploration-id]').first()
  await expect(proposed).toBeVisible()
  const suggestionId = await proposed.getAttribute('data-exploration-id')
  expect(suggestionId).toBeTruthy()
  await expect(proposed).toHaveAttribute('data-reason-code', /^(user-marked-goal|unassessed-note|low-confidence-note|unresolved-bridge)$/)

  const accept = proposed.getByRole('button', { name: '接受建议' })
  await accept.focus()
  await page.keyboard.press('Enter')

  const working = workbench.getByRole('region', { name: '当前工作集' })
  const active = working.locator(`[data-exploration-id="${suggestionId}"]`)
  await expect(active).toHaveAttribute('data-exploration-status', 'accepted')
  await active.getByRole('button', { name: '编辑动作' }).click()
  await active.getByLabel('下一步动作').fill('核对来源并记录一个结论')
  await active.getByLabel('个人记录').fill('E2E lifecycle evidence')
  await active.getByRole('button', { name: '保存动作' }).click()
  await expect(workbench).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
  await expect(active).toContainText('核对来源并记录一个结论')

  await active.getByText('查看原因与证据', { exact: true }).click()
  const support = active.locator('[data-supporting-item-id]').first()
  await expect(support).toBeVisible()
  await support.click()
  await expect(page.getByRole('complementary', { name: '笔记详情' })).toBeVisible()

  await openOverview(page)
  const resumed = page.getByRole('region', { name: '当前工作集' })
    .locator(`[data-exploration-id="${suggestionId}"]`)
  await resumed.getByRole('button', { name: '开始处理' }).click()
  await expect(workbench).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
  await expect(resumed).toHaveAttribute('data-exploration-status', 'in-progress')
  await resumed.getByRole('button', { name: '标记完成' }).click()
  await expect(workbench).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })

  await expect(page.locator(`[data-exploration-id="${suggestionId}"]`)).toHaveCount(0)
  await expect(workbench.getByText(/最近决定/)).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({
    path: `output/playwright/exploration-loop-${testInfo.project.name}.png`,
    animations: 'disabled',
  })

  await page.reload()
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
  await openOverview(page)
  const restored = page.getByRole('region', { name: '探索工作台' })
  await expect(restored.locator(`[data-exploration-id="${suggestionId}"]`)).toHaveCount(0)
  const history = restored.getByText(/最近决定/)
  await history.click()
  await expect(restored.locator(`[data-exploration-history-id="${suggestionId}"]`))
    .toContainText('核对来源并记录一个结论')
  await expectNoHorizontalOverflow(page)
})

async function openOverview(page: Page): Promise<void> {
  await page.getByRole('button', { name: '打开知识概览' }).click()
  await expect(page.getByRole('complementary', { name: '知识概览' })).toBeVisible()
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.viewportWidth)
}
