import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

test('terrain evidence inspector has no serious accessibility violations', async ({ page }) => {
  test.setTimeout(60_000)
  await page.addInitScript(() => {
    localStorage.setItem('cognitive-terrain:first-run', 'seen')
    localStorage.setItem('cognitive-terrain:reference-atlas:demo-ai-infra-terrain', 'demo-ai-infra-reference-atlas')
  })
  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })

  const legend = page.getByRole('complementary', { name: '地形语义图例' })
  await legend.getByRole('button', { name: '地形语义' }).click()
  await expectNoSeriousViolations(page, '[aria-label="地形语义图例"]')
  await legend.getByRole('button', { name: '地形语义' }).click()

  const gap = page.getByRole('button', { name: /^查看缺口 / }).first()
  await gap.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('complementary', { name: '知识缺口证据详情' })).toBeVisible()
  await expectNoSeriousViolations(page, '.note-detail')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: '切换二维等高线' }).click()
  await page.locator('.terrain-points [role="button"]').first().focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: '邻居证据' })).toBeVisible()
  await expectNoSeriousViolations(page, '.note-detail')
})

async function expectNoSeriousViolations(page: Page, selector: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .include(selector)
    .disableRules(['color-contrast'])
    .analyze()
  expect(results.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')).toEqual([])
}
