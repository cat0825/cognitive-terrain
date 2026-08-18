import { expect, test, type Page } from '@playwright/test'
import {
  DESKTOP_PEAK_LABEL_LIMIT,
  MOBILE_PEAK_LABEL_LIMIT,
  peakLabelSafeArea,
} from '../../src/scene/peak-label-layout'

test('keeps peak labels bounded and collision-free through orbit and zoom', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await useAcceptanceViewport(page, testInfo.project.name)
  await page.addInitScript(() => localStorage.setItem('cognitive-terrain:first-run', 'seen'))
  await page.goto('/')

  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible({ timeout: 15_000 })
  await waitForVisibleLabels(page)
  await assertLabelLayout(page, testInfo.project.name)
  await page.getByRole('button', { name: '放大地图' }).click()
  await page.getByRole('button', { name: '放大地图' }).click()
  await page.waitForTimeout(250)
  await assertLabelLayout(page, testInfo.project.name)

  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  const centerX = box!.x + box!.width * 0.5
  const centerY = box!.y + box!.height * 0.52
  for (let index = 0; index < 3; index += 1) {
    await page.mouse.move(centerX, centerY)
    await page.mouse.down()
    await page.mouse.move(centerX + 55 - index * 18, centerY - 30 + index * 12, { steps: 4 })
    await page.mouse.up()
    await page.mouse.wheel(0, index % 2 === 0 ? -220 : 180)
    await page.waitForTimeout(180)
    await assertLabelLayout(page, testInfo.project.name)
  }

  expect(errors).toEqual([])
  await page.screenshot({
    path: `output/playwright/issue-11-${testInfo.project.name}-orbit.png`,
    animations: 'disabled',
  })
})

test('keeps a hidden peak discoverable through search and focus', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile guarantees hidden labels through its eight-label cap')
  await page.addInitScript(() => localStorage.setItem('cognitive-terrain:first-run', 'seen'))
  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
  await waitForVisibleLabels(page)

  const hiddenPeak = page.locator('.peak-label-anchor[data-peak-visible="false"]').first()
  await expect(hiddenPeak).toBeAttached()
  const peakLabel = await hiddenPeak.locator('.peak-label span').textContent()
  const peakId = await hiddenPeak.getAttribute('data-peak-id')
  expect(peakLabel).toBeTruthy()
  expect(peakId).toBeTruthy()

  await page.getByRole('button', { name: '搜索笔记' }).click()
  await page.getByRole('textbox', { name: '搜索笔记和标签' }).fill(peakLabel!)
  await page.getByRole('button', { name: '切换二维等高线' }).click()
  const note = page.locator('.terrain-points [role="button"]').first()
  await expect(note).toBeVisible()
  const noteTitle = await note.getAttribute('aria-label')
  expect(noteTitle).toBeTruthy()
  await note.click()
  await expect(page.getByRole('heading', { name: noteTitle!, exact: true })).toBeVisible()
  await page.getByRole('button', { name: '聚焦到笔记' }).click()
  await page.getByRole('button', { name: '切换二维等高线' }).click()
  await expect(page.locator('canvas').first()).toBeVisible()
  const focusedLabel = page.locator(`.peak-label-anchor[data-peak-id="${peakId}"]`)
  await expect(focusedLabel).toHaveAttribute('data-peak-visible', 'true', { timeout: 15_000 })
  await expect(focusedLabel.locator('.peak-label')).toHaveAttribute('aria-pressed', 'true')
})

async function useAcceptanceViewport(page: Page, projectName: string): Promise<void> {
  if (projectName === 'desktop') await page.setViewportSize({ width: 1280, height: 720 })
}

async function waitForVisibleLabels(page: Page): Promise<void> {
  await expect.poll(
    () => page.locator('.peak-label-anchor[data-peak-visible="true"]').count(),
    { timeout: 15_000 },
  ).toBeGreaterThan(0)
}

async function assertLabelLayout(page: Page, projectName: string): Promise<void> {
  const compact = projectName === 'mobile'
  const safeArea = peakLabelSafeArea(compact)
  const limit = compact ? MOBILE_PEAK_LABEL_LIMIT : DESKTOP_PEAK_LABEL_LIMIT
  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  const layer = page.locator('.peak-label-layer')
  const visibleLabels = page.locator('.peak-label-anchor[data-peak-visible="true"] .peak-label')
  const boxes = await visibleLabels.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
  }))

  expect(boxes.length).toBeGreaterThan(0)
  expect(boxes.length).toBeLessThanOrEqual(limit)
  await expect(layer).toHaveAttribute('data-visible-count', String(boxes.length))
  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(safeArea.left - 0.5)
    expect(box.top).toBeGreaterThanOrEqual(safeArea.top - 0.5)
    expect(box.right).toBeLessThanOrEqual(viewport!.width - safeArea.right + 0.5)
    expect(box.bottom).toBeLessThanOrEqual(viewport!.height - safeArea.bottom + 0.5)
  }
  for (let first = 0; first < boxes.length; first += 1) {
    for (let second = first + 1; second < boxes.length; second += 1) {
      expect(rectanglesOverlap(boxes[first], boxes[second])).toBe(false)
    }
  }
}

function rectanglesOverlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}
