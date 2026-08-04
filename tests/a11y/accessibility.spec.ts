import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('main terrain view has no serious accessibility violations', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(800)

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .disableRules(['color-contrast'])
    .analyze()

  expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([])
})

test('import dialog is accessible', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '打开项目菜单' }).click()
  await page.getByRole('button', { name: '导入笔记' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .include('.import-panel')
    .disableRules(['color-contrast'])
    .analyze()

  expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([])
})