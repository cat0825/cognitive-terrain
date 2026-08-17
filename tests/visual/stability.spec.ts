import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import { importVaultFixture, openFixtureCollision } from '../helpers/import-vault-fixture'

const baselineDir = path.resolve('tests/visual/baselines')
const diffDir = path.resolve('tests/visual/diffs')
const update = process.env.UPDATE_BASELINES === '1'
const platform = process.platform
const fixedTime = new Date('2026-08-17T08:00:00.000Z')

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(fixedTime)
})

async function compareScreenshot(page: import('@playwright/test').Page, name: string): Promise<void> {
  const shot = await page.screenshot({ animations: 'disabled' })
  const baselineName = `${name}-${platform}.png`
  const baselinePath = path.join(baselineDir, baselineName)
  if (update) {
    mkdirSync(baselineDir, { recursive: true })
    writeFileSync(baselinePath, shot)
    return
  }
  if (!existsSync(baselinePath)) {
    mkdirSync(diffDir, { recursive: true })
    writeFileSync(path.join(diffDir, `${name}-${platform}-current.png`), shot)
    expect(existsSync(baselinePath), `Missing ${platform} visual baseline: ${baselineName}`).toBe(true)
    return
  }

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

test('peak labels render stably in desktop and mobile camera states', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => localStorage.setItem('cognitive-terrain:first-run', 'seen'))
  for (const scenario of [
    { name: 'desktop', width: 1280, height: 720, zoomButton: '放大地图' },
    { name: 'mobile', width: 390, height: 844, zoomButton: '缩小地图' },
  ]) {
    await page.setViewportSize({ width: scenario.width, height: scenario.height })
    await page.goto('/')
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 })
    await expect.poll(
      () => page.locator('.peak-label-anchor[data-peak-visible="true"]').count(),
      { timeout: 15_000 },
    ).toBeGreaterThan(0)
    await page.getByRole('button', { name: scenario.zoomButton }).click()
    await page.getByRole('button', { name: scenario.zoomButton }).click()
    await page.waitForTimeout(900)
    await compareScreenshot(page, `peak-labels-${scenario.name}`)
  }
})

test('dense vault collision details render stably on desktop and mobile', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => localStorage.setItem('cognitive-terrain:first-run', 'seen'))
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  await importVaultFixture(page)

  for (const scenario of [
    { name: 'desktop', width: 1280, height: 720 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: scenario.width, height: scenario.height })
    await page.goto('/')
    await openFixtureCollision(page)
    await page.locator('.note-detail').hover()
    await compareScreenshot(page, `vault-collision-${scenario.name}`)
  }
})
