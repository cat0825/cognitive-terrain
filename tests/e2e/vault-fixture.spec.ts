import { expect, test, type Page } from '@playwright/test'
import { importVaultFixture, openFixtureCollision } from '../helpers/import-vault-fixture'

test('imports, reloads, and inspects the anonymized vault without overflow', async ({ page }, testInfo) => {
  test.setTimeout(process.env.CI ? 90_000 : 45_000)
  const errors = collectErrors(page)
  await page.addInitScript(() => localStorage.setItem('cognitive-terrain:first-run', 'seen'))
  await page.goto('/')
  await importVaultFixture(page)

  await page.reload()
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '打开项目菜单' }).click()
  await expect(page.locator('.project-list-item.is-current')).toContainText('12 条')
  await page.getByRole('button', { name: '打开项目菜单' }).click()

  await openFixtureCollision(page)
  const detail = page.getByRole('complementary', { name: '板块碰撞详情' })
  await expect(detail.locator('.collision-method')).toContainText('可解析的 WikiLink')
  await expect(detail.locator('.collision-pairs li')).toHaveCount(3)
  await expect(detail.locator('.collision-metric')).toContainText(/3\s*条跨域 WikiLink/)

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }))
  expect(overflow).toEqual({ document: 0, body: 0 })
  const bounds = await detail.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(testInfo.project.use.viewport?.width ?? 1440)
  expect(errors).toEqual([])

  await testInfo.attach(`vault-collision-${testInfo.project.name}`, {
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  })
})

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}
