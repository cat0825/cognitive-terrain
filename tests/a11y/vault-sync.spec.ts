import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { importVaultFixture, vaultFixtureDirectory } from '../helpers/import-vault-fixture'

test('vault sync preview has no serious accessibility violations', async ({ page }) => {
  test.setTimeout(process.env.CI ? 120_000 : 45_000)
  await page.addInitScript(() => localStorage.setItem('cognitive-terrain:first-run', 'seen'))
  await page.goto('/')
  await importVaultFixture(page)
  await page.getByRole('button', { name: '切换二维等高线' }).click()
  await expect(page.locator('.terrain-2d')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '打开项目菜单' }).click()
  await page.getByRole('button', { name: '同步 Obsidian vault' }).click()
  await page.locator('.vault-sync-input').setInputFiles(vaultFixtureDirectory)
  await expect(page.getByText('首次建立同步基线')).toBeVisible({ timeout: 15_000 })

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .include('.vault-sync-panel')
    .disableRules(['color-contrast'])
    .analyze()

  expect(results.violations.filter((violation) =>
    violation.impact === 'critical' || violation.impact === 'serious')).toEqual([])
})
