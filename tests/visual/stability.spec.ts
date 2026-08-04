import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

const baselineDir = path.resolve('tests/visual/baselines')
const diffDir = path.resolve('tests/visual/diffs')
const update = process.env.UPDATE_BASELINES === '1'

async function compareScreenshot(page: import('@playwright/test').Page, name: string): Promise<void> {
  const shot = await page.screenshot({ animations: 'disabled' })
  const baselinePath = path.join(baselineDir, `${name}.png`)
  if (update || !existsSync(baselinePath)) {
    mkdirSync(baselineDir, { recursive: true })
    writeFileSync(baselinePath, shot)
    expect.soft(true).toBe(true)
    return
  }
  const baseline = PNG.sync.read(readFileSync(baselinePath))
  const current = PNG.sync.read(shot)
  const width = Math.max(baseline.width, current.width)
  const height = Math.max(baseline.height, current.height)
  const diff = new PNG({ width, height })
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
    writeFileSync(path.join(diffDir, `${name}.png`), PNG.sync.write(diff))
  }
}

test('desktop overview renders stably', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1200)
  await compareScreenshot(page, 'desktop-overview')
})

test('note details panel renders stably', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(800)
  await page.locator('.note-detail').hover()
  await compareScreenshot(page, 'desktop-note-details')
})
