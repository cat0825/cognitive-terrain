import { expect, test, type Locator, type Page } from '@playwright/test'

test('keeps the fresh terrain viewport clear and dismisses onboarding by keyboard and pointer', async ({ page }, testInfo) => {
  await useAcceptanceViewport(page, testInfo.project.name)
  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })

  const welcome = page.locator('.first-run-banner')
  const stage = page.locator('.terrain-stage')
  await expect(welcome).toBeVisible()
  await expect(page.locator('.note-detail')).toBeHidden()
  await assertNoSelectedNote(page)
  await expect.poll(
    () => page.locator('.peak-label-anchor[style*="transform"]').count(),
    { timeout: 15_000 },
  ).toBeGreaterThan(0)
  await expectOverlaysNotToOverlap(welcome, [
    page.locator('.camera-rail'),
    page.locator('.utility-dock'),
    page.locator('.timeline-control'),
  ])
  await expectNoHorizontalOverflow(page)
  await captureState(page, testInfo.project.name, 'fresh')

  const closeWelcome = page.getByRole('button', { name: '关闭欢迎提示' })
  await closeWelcome.focus()
  await page.keyboard.press('Escape')
  await expect(welcome).toBeHidden()
  await expect(stage).toBeFocused()
  await captureState(page, testInfo.project.name, 'dismissed')

  await page.evaluate(() => localStorage.removeItem('cognitive-terrain:first-run'))
  await page.reload()
  await expect(page.locator('.first-run-banner')).toBeVisible()
  await page.getByRole('button', { name: '关闭欢迎提示' }).click()
  await expect(page.locator('.first-run-banner')).toBeHidden()
  await expect(stage).toBeFocused()
})

test('opens a bounded detail sheet and restores focus on dismiss', async ({ page }, testInfo) => {
  await useAcceptanceViewport(page, testInfo.project.name)
  await page.addInitScript(() => localStorage.setItem('cognitive-terrain:first-run', 'seen'))
  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.note-detail')).toBeHidden()
  await page.getByRole('button', { name: '切换二维等高线' }).click()

  const note = page.getByRole('button', { name: 'GPU 资源池化', exact: true })
  await note.focus()
  await page.keyboard.press('Enter')

  const detail = page.locator('.note-detail')
  const closeDetail = page.getByRole('button', { name: '关闭详情' })
  await expect(detail).toBeVisible()
  await expect(closeDetail).toBeFocused()
  await expect(page.getByRole('region', { name: '邻居证据' })).toContainText('2D UMAP approximate distance')
  await expect(page.getByLabel('领域归属').locator('span')).toHaveCount(2)
  const detailBox = await detail.boundingBox()
  const viewport = page.viewportSize()
  expect(detailBox).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(detailBox!.height).toBeLessThanOrEqual(viewport!.height * 0.55)
  await expectNoHorizontalOverflow(page)
  await captureState(page, testInfo.project.name, 'detail-open')

  if (testInfo.project.name === 'mobile') {
    const collapse = page.getByRole('button', { name: '收起详情' })
    await collapse.click()
    await expect(detail).toHaveClass(/is-collapsed/)
    const expand = page.getByRole('button', { name: '展开详情' })
    await expect(expand).toHaveAttribute('aria-expanded', 'false')
    await expand.click()
    await expect(detail).not.toHaveClass(/is-collapsed/)
  }

  await page.keyboard.press('Escape')
  await expect(detail).toBeHidden()
  await expect(note).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(closeDetail).toBeFocused()
  await closeDetail.click()
  await expect(detail).toBeHidden()
  await expect(note).toBeFocused()
})

async function useAcceptanceViewport(page: Page, projectName: string): Promise<void> {
  if (projectName === 'desktop') await page.setViewportSize({ width: 1280, height: 720 })
}

async function assertNoSelectedNote(page: Page): Promise<void> {
  await expect(page.locator('.terrain-stage')).toHaveAttribute('data-selected-note-id', '')
}

async function expectOverlaysNotToOverlap(overlay: Locator, controls: Locator[]): Promise<void> {
  const overlayBox = await overlay.boundingBox()
  expect(overlayBox).not.toBeNull()
  for (const control of controls) {
    const controlBox = await control.boundingBox()
    expect(controlBox).not.toBeNull()
    expect(rectanglesOverlap(overlayBox!, controlBox!)).toBe(false)
  }
}

function rectanglesOverlap(a: NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>, b: NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.viewportWidth)
}

async function captureState(page: Page, projectName: string, state: string): Promise<void> {
  await page.screenshot({
    path: `output/playwright/issue-10-${projectName}-${state}.png`,
    animations: 'disabled',
  })
}
