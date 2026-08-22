import { expect, test, type Page } from '@playwright/test'

const DIMENSIONS = ['密度', '熟练度', '探索度', '活跃', '学习进程', '基础层级', '温度', '领域'] as const
const WIDTHS = [1024, 1180, 1280, 1440, 1600, 1920] as const

test.describe('reported UI regressions', () => {
  test('keeps peak labels after selecting and through every visual dimension', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Peak label budget differs on mobile; desktop is the reported case')
    test.setTimeout(120_000)
    const errors = collectErrors(page)
    await dismissFirstRun(page)
    await page.goto('/')
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
    const baseline = await waitForLabels(page)
    expect(baseline).toBeGreaterThan(1)

    // Issue 1, path A: selecting a note records an interaction event, which replaces
    // `project` and therefore the notes/peaks props feeding the peak geometry — the
    // reported case, reached here through the peak's member list because the 3D note
    // points are canvas raycast targets rather than DOM nodes.
    await page.locator('.peak-label-anchor[data-peak-visible="true"] .peak-label').first().click()
    const detail = page.locator('.note-detail')
    await expect(detail).toBeVisible()
    await detail.getByRole('region', { name: '峰值成员笔记' }).getByRole('button').first().click()
    await expect(detail.getByRole('button', { name: '聚焦到笔记' })).toBeVisible()
    expect(await countLabels(page, baseline)).toBeGreaterThan(1)

    // Issue 1, path B: the reported click was on a note point, reachable through the
    // 2D overlay; the labels have to survive coming back to 3D. Activated by keyboard
    // because 1800 points overlap each other and a mouse click hits whichever circle
    // is painted last — the handler is the same either way.
    await page.getByRole('button', { name: '切换二维等高线' }).click()
    await expect(page.locator('.terrain-2d')).toBeVisible()
    const point = page.locator('.terrain-points [role="button"]').first()
    await point.focus()
    await point.press('Enter')
    await expect(page.locator('.note-detail')).toBeVisible()
    await page.getByRole('button', { name: '切换二维等高线' }).click()
    expect(await countLabels(page, baseline)).toBeGreaterThan(1)

    // Issue 5: switching the dimension rebuilds the peak geometry too. All eight
    // stay on the 3D canvas with labels; none of them degrade to the 2D fallback.
    await page.getByRole('button', { name: '打开地图筛选' }).click()
    const panel = page.getByRole('complementary', { name: '地图筛选' })
    for (const label of DIMENSIONS) {
      await panel.locator('.visual-dimension-control').getByRole('button', { name: label, exact: true }).click()
      await expect(page.locator('.terrain-2d')).toBeHidden()
      expect(await countLabels(page, baseline), `切换到「${label}」后可见峰值标题数量`).toBeGreaterThan(1)
    }
    await page.getByRole('button', { name: '关闭筛选' }).click()
    expect(errors).toEqual([])
  })

  test('never overlaps the utility dock with the timeline control', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The reported overlap is a desktop percentage-layout problem')
    await dismissFirstRun(page)
    await page.goto('/')
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(120)
      const dock = await boxOf(page, '.utility-dock')
      const timeline = await boxOf(page, '.timeline-control')
      const rail = await boxOf(page, '.camera-rail')
      const ocean = await boxOf(page, '[aria-label="参考图谱海洋图层"]')
      expect(dock.right, `${width}px: 工具栏与时间轴水平间距`).toBeLessThan(timeline.left)
      expect(overlaps(dock, timeline), `${width}px: 工具栏与时间轴重叠`).toBe(false)
      expect(overlaps(dock, rail), `${width}px: 工具栏与相机栏重叠`).toBe(false)
      // The dock and the ocean overlay both anchor to the bottom-left corner.
      expect(overlaps(dock, ocean), `${width}px: 工具栏与海洋图层重叠`).toBe(false)
      expect(overlaps(ocean, timeline), `${width}px: 海洋图层与时间轴重叠`).toBe(false)
    }
  })

  test('docks the note detail panel in the right gutter beside the filters', async ({ page }, testInfo) => {
    await dismissFirstRun(page)
    await page.goto('/')
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
    await waitForLabels(page)
    await page.locator('.peak-label-anchor[data-peak-visible="true"] .peak-label').first().click()

    const detail = page.locator('.note-detail')
    await expect(detail).toBeVisible()
    const stage = await boxOf(page, '.terrain-stage')
    const detailBox = await boxOf(page, '.note-detail')

    if (testInfo.project.name === 'desktop') {
      // A right sidebar, not a floating card: it hugs the right edge and is tall.
      expect(stage.right - detailBox.right).toBeLessThan(60)
      expect(detailBox.height).toBeGreaterThan(stage.height * 0.6)
      expect(detailBox.left).toBeGreaterThan(stage.left + stage.width * 0.6)
      // The sidebar shares the right gutter with three other affordances; none of
      // them may end up underneath it.
      expect(overlaps(detailBox, await boxOf(page, '.camera-rail')), '详情侧边栏与相机栏重叠').toBe(false)
      const legendToggle = page.locator('.terrain-semantics-toggle')
      expect(overlaps(detailBox, await boxOf(page, '.terrain-semantics-toggle')), '详情侧边栏遮挡地形语义按钮').toBe(false)
      await legendToggle.click()
      await expect(legendToggle).toHaveAttribute('aria-expanded', 'true')
      await legendToggle.click()
      await expect(legendToggle).toHaveAttribute('aria-expanded', 'false')
      await page.getByRole('button', { name: '打开地图筛选' }).click()
      const filters = await boxOf(page, '.filter-panel')
      expect(overlaps(detailBox, filters), '详情侧边栏与筛选面板重叠').toBe(false)
      await page.getByRole('button', { name: '关闭筛选' }).click()
    } else {
      // Mobile keeps the bottom-sheet layout; a 296px sidebar would not fit.
      expect(detailBox.width).toBeGreaterThan(stage.width * 0.8)
    }

    await page.screenshot({
      path: `output/playwright/note-detail-sidebar-${testInfo.project.name}.png`,
      animations: 'disabled',
    })
  })

  test('shows the reference ocean layer for the demo project', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The overlay is desktop-only chrome')
    await dismissFirstRun(page)
    await page.goto('/')
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })

    // Issue 3: the ocean / gap layer needs an explicit reference atlas, and the demo
    // now ships with one selected, so it is visible without a manual pick.
    const ocean = page.getByRole('complementary', { name: '参考图谱海洋图层' })
    await expect(ocean).toBeVisible()
    await expect(ocean).toHaveAttribute('data-formula-version', /reference-gap/)
    await expect(ocean).toContainText('AI Infra 核心能力参考图谱')
    await expect(ocean.locator('.reference-gap-map-counts')).toContainText('缺失')

    const gap = ocean.getByRole('button', { name: /^查看缺口/ }).first()
    await expect(gap).toBeVisible()
    await gap.click()
    await expect(gap).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.note-detail')).toBeVisible()
    await page.screenshot({ path: 'output/playwright/reference-ocean-desktop.png', animations: 'disabled' })
  })
})

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('requestfailed', (request) => errors.push(`requestfailed ${request.url()}`))
  return errors
}

async function dismissFirstRun(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('cognitive-terrain:first-run', 'seen'))
}

async function waitForLabels(page: Page): Promise<number> {
  await expect
    .poll(() => countVisibleLabels(page), { timeout: 15_000 })
    .toBeGreaterThan(1)
  return countVisibleLabels(page)
}

/**
 * The label layout is throttled and the budget shrinks with zoom, so the assertion
 * is "labels did not collapse", not "the count is unchanged".
 */
async function countLabels(page: Page, baseline: number): Promise<number> {
  await expect
    .poll(() => countVisibleLabels(page), { timeout: 10_000 })
    .toBeGreaterThan(Math.min(1, baseline - 1))
  return countVisibleLabels(page)
}

function countVisibleLabels(page: Page): Promise<number> {
  return page.locator('.peak-label-anchor[data-peak-visible="true"] .peak-label').count()
}

interface Box { left: number; top: number; right: number; bottom: number; width: number; height: number }

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).first().boundingBox()
  expect(box, `${selector} 没有布局盒`).not.toBeNull()
  return { ...box!, left: box!.x, top: box!.y, right: box!.x + box!.width, bottom: box!.y + box!.height }
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}
