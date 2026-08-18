import { expect, test, type Page } from '@playwright/test'

const dimensions = ['密度', '熟练度', '探索度', '活跃', '温度', '领域'] as const

test('switches point cloud encoding across all six visual dimensions', async ({ page }) => {
  test.setTimeout(process.env.CI ? 90_000 : 45_000)
  const errors = collectErrors(page)

  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })

  const panel = page.getByRole('complementary', { name: '地图筛选' })
  await expect(panel).toBeHidden()
  await page.getByRole('button', { name: '打开地图筛选' }).click()
  await expect(panel).toBeVisible()

  const buttons = dimensions.map((label) =>
    panel.locator('.visual-dimension-control').getByRole('button', { name: label, exact: true }),
  )
  await expect(buttons[0]).toHaveAttribute('aria-pressed', 'true')

  for (const [index, label] of dimensions.entries()) {
    await buttons[index].click()
    for (const [otherIndex, otherLabel] of dimensions.entries()) {
      await expect(
        buttons[otherIndex],
        `切换到「${label}」后，「${otherLabel}」的 aria-pressed 不正确`,
      ).toHaveAttribute('aria-pressed', String(otherIndex === index))
    }
    await expect(panel.locator('.dimension-help')).not.toBeEmpty()
    await expect(page.locator('canvas').first()).toBeVisible()
    if (label === '领域') {
      const legend = panel.getByRole('group', { name: '知识板块图例' })
      await expect(legend).toBeVisible()
      const plateButtons = legend.locator('.plate-legend-list').getByRole('button')
      const firstPlate = plateButtons.first()
      const secondPlate = plateButtons.nth(1)
      await firstPlate.click()
      await secondPlate.click()
      await expect(firstPlate).toHaveAttribute('aria-pressed', 'true')
      await expect(secondPlate).toHaveAttribute('aria-pressed', 'true')
      await legend.getByRole('button', { name: '显示全部' }).click()
      await expect(firstPlate).toHaveAttribute('aria-pressed', 'false')
      await expect(secondPlate).toHaveAttribute('aria-pressed', 'false')
      await expect(panel.locator('.plate-legend-summary')).toContainText(/[1-9]\d* 条跨域 WikiLink/)
      await expect(panel.locator('.plate-legend-summary')).toContainText(/[1-9]\d* 个碰撞带/)
    }
  }

  await page.getByRole('button', { name: '关闭筛选' }).click()
  await expect(panel).toBeHidden()

  expect(errors).toEqual([])
})

test('records note activity without moving its stable coordinates', async ({ page }) => {
  const errors = collectErrors(page)

  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '关闭欢迎提示' }).click()
  await page.getByRole('button', { name: '切换二维等高线' }).click()

  const note = page.getByRole('button', { name: 'SM 与 Tensor Core', exact: true })
  const originalX = await note.getAttribute('cx')
  const originalY = await note.getAttribute('cy')
  await note.click()
  await expect(page.getByLabel('知识温度')).toContainText('打开 1')
  const activityEvidence = page.getByText('查看活动海拔证据', { exact: true })
  await activityEvidence.click()
  await expect(page.locator('.activity-elevation-evidence')).toContainText('raw heat')
  await expect(page.locator('.activity-elevation-evidence')).toContainText('评估于')
  await expect(page.locator('.activity-elevation-evidence')).toContainText('原始事件')
  await expect(page.getByRole('region', { name: '活动历史' })).toBeVisible()
  await expect(page.getByRole('region', { name: '活动历史' }).getByRole('button', { name: '日' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: '打开地图筛选' }).click()
  const panel = page.getByRole('complementary', { name: '地图筛选' })
  const activity = panel.locator('.visual-dimension-control').getByRole('button', { name: '活跃', exact: true })
  await activity.click()
  await expect(activity).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.locator('.dimension-help')).toContainText('activity-elevation-v1')
  await expect(panel.getByRole('group', { name: '知识温度图例' })).toContainText('1 个事件')
  await expect(note).toHaveAttribute('cx', originalX ?? '')
  await expect(note).toHaveAttribute('cy', originalY ?? '')

  await panel.locator('.visual-dimension-control').getByRole('button', { name: '温度', exact: true }).click()
  await expect(panel.getByRole('group', { name: '知识温度图例' })).toContainText('1 个事件')
  await expect(note).toHaveAttribute('cx', originalX ?? '')
  await expect(note).toHaveAttribute('cy', originalY ?? '')
  await page.getByRole('button', { name: '关闭筛选' }).click()

  await page.getByRole('button', { name: '标记已复习' }).click()
  await expect(page.getByLabel('知识温度')).toContainText('复习 1')
  await expect(page.locator('.activity-elevation-evidence')).toContainText('复习：1 次')
  expect(errors).toEqual([])
})

test('replays learning progression evidence and checkpoint comparison', async ({ page }) => {
  const errors = collectErrors(page)

  await page.addInitScript(() => localStorage.setItem('cognitive-terrain:first-run', 'seen'))
  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '打开地图筛选' }).click()
  const panel = page.getByRole('complementary', { name: '地图筛选' })
  const progression = panel.locator('.visual-dimension-control').getByRole('button', { name: '学习进程', exact: true })
  await progression.click()
  await expect(progression).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.locator('.dimension-help')).toContainText('显式认知观测')
  await page.getByRole('button', { name: '关闭筛选' }).click()
  await page.getByRole('button', { name: '切换二维等高线' }).click()

  const note = page.getByRole('button', { name: 'SM 与 Tensor Core', exact: true })
  await note.click()
  await expect(page.getByLabel('笔记详情')).toBeVisible()
  await expect(page.getByLabel('学习进程证据')).toContainText('学习进程海拔')
  await page.getByText('查看学习进程证据', { exact: true }).click()
  await expect(page.locator('.progression-evidence')).toContainText('自我评估')

  const checkpoint = page.getByRole('combobox', { name: '学习进程检查点' })
  await expect(checkpoint).toBeVisible()
  await checkpoint.selectOption({ index: 1 })
  await expect(page.getByTestId('progression-comparison')).toContainText('检查点海拔')
  expect(errors).toEqual([])
})

test('disables knowledge-gap claims until a reference atlas is selected', async ({ page }) => {
  const errors = collectErrors(page)

  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '打开知识概览' }).click()

  const gaps = page.getByRole('region', { name: '参考图谱知识缺口' })
  await expect(gaps).toBeVisible()
  await expect(gaps).toContainText('未选择参考图谱')
  await expect(gaps).toContainText('活动低不等于知识缺口')
  await expect(gaps.locator('.reference-gap-item')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('persists an explicit reference atlas and exposes gap evidence', async ({ page }) => {
  const errors = collectErrors(page)

  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '打开知识概览' }).click()

  const gaps = page.getByRole('region', { name: '参考图谱知识缺口' })
  const atlas = gaps.getByRole('combobox', { name: '选择参考图谱' })
  await atlas.selectOption({ label: 'AI Infra 核心能力参考图谱' })

  await expect(page.getByRole('complementary', { name: '参考图谱海洋图层' })).toBeVisible()
  await expect(gaps.locator('.reference-gap-item')).not.toHaveCount(0)
  await gaps.locator('.reference-gap-item summary').first().click()
  await expect(gaps.locator('.reference-gap-evidence').first()).toContainText('预期节点')
  await expect(gaps.locator('.reference-gap-evidence').first()).toContainText('支持项')

  await page.reload()
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '打开知识概览' }).click()
  await expect(page.getByRole('region', { name: '参考图谱知识缺口' })
    .getByRole('combobox', { name: '选择参考图谱' })).toHaveValue('demo-ai-infra-reference-atlas')
  await expect(page.getByRole('complementary', { name: '参考图谱海洋图层' })).toBeVisible()

  expect(errors).toEqual([])
})

test('opens an explainable collision band from the keyboard in 2D', async ({ page }) => {
  const errors = collectErrors(page)

  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '打开地图筛选' }).click()
  const panel = page.getByRole('complementary', { name: '地图筛选' })
  await panel.locator('.visual-dimension-control').getByRole('button', { name: '领域', exact: true }).click()
  await page.getByRole('button', { name: '关闭筛选' }).click()
  await page.getByRole('button', { name: '切换二维等高线' }).click()

  const band = page.locator('.plate-collision-band[marker-end]').first()
  await expect(band).toBeVisible()
  await expect(band).toHaveAttribute('aria-label', /碰撞带.*指向.*跨域 WikiLink/)
  await band.focus()
  await page.keyboard.press('Enter')

  await expect(page.getByText('板块碰撞带', { exact: true })).toBeVisible()
  await expect(page.locator('.collision-method').last()).toContainText('可解析的源笔记')
  const evidence = page.locator('.collision-pairs button').first()
  await expect(evidence).toBeVisible()
  await expect(evidence).toHaveAttribute('data-source-note-id', /.+/)
  await expect(evidence).toHaveAttribute('data-target-note-id', /.+/)
  expect(errors).toEqual([])
})

test('keeps the visual dimension selection while switching to the 2D fallback', async ({ page }) => {
  const errors = collectErrors(page)

  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '打开地图筛选' }).click()

  const panel = page.getByRole('complementary', { name: '地图筛选' })
  const mastery = panel.locator('.visual-dimension-control').getByRole('button', { name: '熟练度', exact: true })
  await mastery.click()
  await expect(mastery).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: '关闭筛选' }).click()
  await page.getByRole('button', { name: '切换二维等高线' }).click()
  await expect(page.locator('.terrain-2d')).toBeVisible()
  await page.getByRole('button', { name: '打开地图筛选' }).click()
  await expect(mastery).toHaveAttribute('aria-pressed', 'true')

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
