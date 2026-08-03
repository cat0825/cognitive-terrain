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

  const slider = page.getByRole('slider', { name: '时间轴' })
  const max = Number(await slider.getAttribute('aria-valuemax'))
  expect(max).toBeGreaterThan(0)

  await page.getByRole('button', { name: '播放时间演化' }).click()
  await expect(page.getByRole('button', { name: '暂停时间演化' })).toBeVisible()
  await page.getByRole('button', { name: '暂停时间演化' }).click()

  expect(errors).toEqual([])
})

test('imports a JSON study pack and generates terrain', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '打开项目菜单' }).click()
  await page.getByRole('button', { name: '加载今日学习' }).click()

  await expect(
    page.getByRole('heading', { name: 'DeepSeek Harness 内测：用代表作说话' }),
  ).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('canvas').first()).toBeVisible()
})
