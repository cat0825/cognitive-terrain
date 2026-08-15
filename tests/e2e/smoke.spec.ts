import { expect, test } from '@playwright/test'

test('app loads the demo terrain and renders a canvas', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('slider', { name: '时间轴' })).toBeVisible()
  await expect.poll(
    () => page.locator('.peak-label-anchor[style*="transform"]').count(),
    { timeout: 15_000 },
  ).toBeGreaterThan(0)

  const positionedLabels = await page.locator('.peak-label-anchor[style*="transform"]').evaluateAll(
    (elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight
    }),
  )
  expect(positionedLabels.some(Boolean)).toBe(true)

  const slider = page.getByRole('slider', { name: '时间轴' })
  const max = Number(await slider.getAttribute('aria-valuemax'))
  expect(max).toBeGreaterThan(0)

  await page.getByRole('button', { name: '播放时间演化' }).click()
  await expect(page.getByRole('button', { name: '暂停时间演化' })).toBeVisible()
  await page.getByRole('button', { name: '暂停时间演化' }).click()

  expect(errors).toEqual([])
})

test('switches between rotate and pan camera drag modes', async ({ page }) => {
  await page.goto('/')
  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible({ timeout: 15_000 })

  const rotateMode = page.getByRole('button', { name: '旋转模式' })
  const panMode = page.getByRole('button', { name: '平移模式' })
  await expect(rotateMode).toHaveAttribute('aria-pressed', 'true')
  await expect(panMode).toHaveAttribute('aria-pressed', 'false')

  await panMode.click()
  await expect(panMode).toHaveAttribute('aria-pressed', 'true')
  await expect(canvas).toHaveCSS('cursor', 'grab')

  const canvasBox = await canvas.boundingBox()
  expect(canvasBox).not.toBeNull()
  const startX = (canvasBox?.x ?? 0) + (canvasBox?.width ?? 0) * 0.28
  const startY = (canvasBox?.y ?? 0) + (canvasBox?.height ?? 0) * 0.56
  const before = await page.locator('.peak-label-anchor').first().getAttribute('style')
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 70, startY - 12, { steps: 20 })
  await page.mouse.up()
  await page.waitForTimeout(150)
  const after = await page.locator('.peak-label-anchor').first().getAttribute('style')

  expect(after).not.toBe(before)
})

test('imports a JSON study pack and generates terrain', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cognitive-terrain:embedding', 'deterministic')
  })
  await page.goto('/')
  await page.getByRole('button', { name: '打开项目菜单' }).click()
  await page.getByRole('button', { name: '加载今日学习' }).click()

  await expect(
    page.getByRole('heading', { name: 'DeepSeek Harness 内测：用代表作说话' }),
  ).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('canvas').first()).toBeVisible()
})
