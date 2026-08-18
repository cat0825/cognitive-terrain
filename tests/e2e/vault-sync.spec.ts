import { expect, test, type Page } from '@playwright/test'
import { importVaultFixture, vaultFixtureDirectory } from '../helpers/import-vault-fixture'

test('establishes a vault baseline and keeps a repeated rescan idempotent', async ({ page }, testInfo) => {
  test.setTimeout(process.env.CI ? 120_000 : 45_000)
  const errors = collectErrors(page)
  await page.addInitScript(() => localStorage.setItem('cognitive-terrain:first-run', 'seen'))
  await page.goto('/')
  await importVaultFixture(page)

  await openVaultSync(page)
  await page.locator('.vault-sync-input').setInputFiles(vaultFixtureDirectory)
  await expect(page.getByText('首次建立同步基线')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.vault-sync-counts .is-unchanged dd')).toHaveText('12')
  await page.getByRole('button', { name: '建立同步基线' }).click()
  await expect(page.getByText('vault 同步完成')).toBeVisible()
  await page.getByRole('button', { name: '完成', exact: true }).click()

  await openVaultSync(page)
  await page.locator('.vault-sync-input').setInputFiles(vaultFixtureDirectory)
  await expect(page.getByText('增量同步预览')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.vault-sync-counts .is-unchanged dd')).toHaveText('12')
  await expect(page.getByText('vault 与当前项目一致，无需应用变更。')).toBeVisible()
  await expect(page.getByRole('button', { name: '确认同步 0 项' })).toBeDisabled()

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    panel: document.querySelector('.vault-sync-panel')
      ? document.querySelector('.vault-sync-panel')!.scrollWidth - document.querySelector('.vault-sync-panel')!.clientWidth
      : -1,
  }))
  expect(overflow).toEqual({ document: 0, panel: 0 })
  expect(errors).toEqual([])
  await testInfo.attach(`vault-sync-${testInfo.project.name}`, {
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  })
})

async function openVaultSync(page: Page): Promise<void> {
  await page.getByRole('button', { name: '打开项目菜单' }).click()
  await page.getByRole('button', { name: '同步 Obsidian vault' }).click()
  await expect(page.getByRole('dialog', { name: '同步 Obsidian vault' })).toBeVisible()
}

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}
