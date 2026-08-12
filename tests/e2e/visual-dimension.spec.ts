import { expect, test, type Page } from '@playwright/test'

const dimensions = ['密度', '熟练度', '探索度', '领域'] as const

test('switches point cloud encoding across all four visual dimensions', async ({ page }) => {
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
  }

  await buttons[0].click()
  await expect(buttons[0]).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: '关闭筛选' }).click()
  await expect(panel).toBeHidden()

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

  await page.getByRole('button', { name: '切换二维等高线' }).click()
  await expect(page.locator('.terrain-2d')).toBeVisible()
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
