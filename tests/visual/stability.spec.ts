import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

const baselineDir = path.resolve('tests/visual/baselines')
const diffDir = path.resolve('tests/visual/diffs')
const update = process.env.UPDATE_BASELINES === '1'
const platform = process.platform

async function compareScreenshot(page: import('@playwright/test').Page, name: string): Promise<void> {
  const shot = await page.screenshot({ animations: 'disabled' })
  const baselineName = `${name}-${platform}.png`
  const baselinePath = path.join(baselineDir, baselineName)
  if (update) {
    mkdirSync(baselineDir, { recursive: true })
    writeFileSync(baselinePath, shot)
    return
  }
  expect(existsSync(baselinePath), `Missing ${platform} visual baseline: ${baselineName}`).toBe(true)
  if (!existsSync(baselinePath)) return

  const baseline = PNG.sync.read(readFileSync(baselinePath))
  const current = PNG.sync.read(shot)
  expect(current.width).toBe(baseline.width)
  expect(current.height).toBe(baseline.height)
  if (current.width !== baseline.width || current.height !== baseline.height) return

  const diff = new PNG({ width: baseline.width, height: baseline.height })
  const changed = pixelmatch(
    baseline.data,
    current.data,
    diff.data,
    baseline.width,
    baseline.height,
    { threshold: 0.08, diffColorAlt: [255, 0, 0] },
  )
  const ratio = changed / (baseline.width * baseline.height)
  expect.soft(ratio).toBeLessThan(0.002)
  if (ratio >= 0.002) {
    mkdirSync(diffDir, { recursive: true })
    writeFileSync(path.join(diffDir, `${name}-${platform}.png`), PNG.sync.write(diff))
    writeFileSync(path.join(diffDir, `${name}-${platform}-current.png`), shot)
  }
}

test('desktop overview renders stably', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1200)
  await compareScreenshot(page, 'desktop-overview')
})

test('note details panel renders stably', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cognitive-terrain:first-run', 'seen'))
  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(800)
  await page.locator('.peak-label:visible').first().click()
  await expect(page.locator('.note-detail')).toBeVisible()
  await page.locator('.note-detail').hover()
  await compareScreenshot(page, 'desktop-note-details')
})
