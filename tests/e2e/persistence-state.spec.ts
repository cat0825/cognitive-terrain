import { expect, test } from '@playwright/test'

/**
 * Save state must be readable on its own, not inferred from the analysis
 * overlay. Audit finding H2 was exactly this confusion: the app reported
 * progress for a project that had never reached IndexedDB.
 */
test('reports the save state separately from analysis progress', async ({ page }) => {
  test.setTimeout(process.env.CI ? 120_000 : 60_000)
  await page.addInitScript(() => localStorage.setItem('cognitive-terrain:first-run', 'seen'))
  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '切换二维等高线' }).click()
  await expect(page.locator('.terrain-2d')).toBeVisible({ timeout: 20_000 })

  const status = page.locator('.persistence-status')
  await expect(status).toBeHidden()

  const note = page.locator('.terrain-2d [role="button"]').first()
  await note.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.note-detail')).toBeVisible()
  await page.getByRole('button', { name: '标记已复习' }).click()

  await expect(status).toBeVisible({ timeout: 30_000 })
  await expect(status).toHaveAttribute('data-save-scope', 'review')
  await expect(status).toContainText('复习记录已保存')
  // The analysis overlay must stay out of it: marking a review does not analyze.
  await expect(page.locator('.processing-overlay')).toBeHidden()
  // Successful saves are transient feedback, not a permanent badge.
  await expect(status).toBeHidden({ timeout: 15_000 })
})
