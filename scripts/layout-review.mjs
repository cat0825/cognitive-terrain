import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:4174/'
const outputDir = path.resolve('output/layout-review')
await mkdir(outputDir, { recursive: true })

const viewports = [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'mobile', width: 390, height: 844 },
]

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const report = []
const problems = []

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1.5,
    })
    const errors = []
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('[vite] failed to connect to websocket')) {
        errors.push(message.text())
      }
    })
    page.on('pageerror', (error) => errors.push(error.message))

    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.locator('canvas').first().waitFor({ state: 'visible' })
    await page.waitForTimeout(900)

    await shoot(page, viewport, 'detail-only')
    const detailOnly = await inspect(page, viewport)

    await page.getByRole('button', { name: '打开地图筛选' }).click()
    await page.getByRole('complementary', { name: '地图筛选' }).waitFor({ state: 'visible' })
    await page.waitForTimeout(350)
    await shoot(page, viewport, 'filters-open')
    const bothOpen = await inspect(page, viewport)

    for (const dimension of ['熟练度', '探索度', '领域']) {
      await page
        .getByRole('complementary', { name: '地图筛选' })
        .getByRole('button', { name: dimension, exact: true })
        .click()
      await page.waitForTimeout(250)
      await shoot(page, viewport, `dimension-${dimension}`)
    }

    await page.getByRole('button', { name: '关闭筛选' }).click()
    await page.waitForTimeout(250)
    const candidates = await page.locator('.semantic-candidates').count()
    await shoot(page, viewport, 'semantic-candidates')
    const detailScroll = await page.locator('.note-detail').evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      overflows: element.scrollHeight > element.clientHeight + 1,
    })).catch(() => null)

    report.push({ viewport: viewport.name, detailOnly, bothOpen, semanticCandidateSections: candidates, detailScroll, errors })
    if (errors.length) problems.push(`${viewport.name}: 控制台 ${errors.length} 个错误`)
    for (const entry of [...detailOnly.offscreen, ...bothOpen.offscreen]) {
      problems.push(`${viewport.name}: ${entry.selector} 超出视口 (${entry.detail})`)
    }
    for (const overlap of bothOpen.overlaps) {
      problems.push(`${viewport.name}: ${overlap.a} 与 ${overlap.b} 重叠 ${overlap.area}px²`)
    }
    await page.close()
  }

  console.log(JSON.stringify({ report, problems }, null, 2))
  console.log(problems.length ? `\n发现 ${problems.length} 个布局问题，需人工确认截图。` : '\n未发现自动可检出的遮挡或溢出。')
  console.log(`截图目录：${outputDir}`)
} finally {
  await browser.close()
}

async function shoot(page, viewport, label) {
  await page.screenshot({ path: path.join(outputDir, `${viewport.name}-${label}.png`) })
}

async function inspect(page, viewport) {
  const tracked = ['.note-detail', '.filter-panel', '.utility-dock', '.timeline-control', '.camera-rail']
  const boxes = await page.evaluate((selectors) => {
    const result = {}
    for (const selector of selectors) {
      const element = document.querySelector(selector)
      if (!element) continue
      const rect = element.getBoundingClientRect()
      result[selector] = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
    }
    return result
  }, tracked)

  const offscreen = []
  for (const [selector, box] of Object.entries(boxes)) {
    const detail = []
    if (box.x < -1) detail.push(`left ${box.x}`)
    if (box.y < -1) detail.push(`top ${box.y}`)
    if (box.x + box.width > viewport.width + 1) detail.push(`right ${box.x + box.width} > ${viewport.width}`)
    if (box.y + box.height > viewport.height + 1) detail.push(`bottom ${box.y + box.height} > ${viewport.height}`)
    if (detail.length) offscreen.push({ selector, detail: detail.join(', ') })
  }

  const overlaps = []
  const entries = Object.entries(boxes)
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const [aSelector, a] = entries[i]
      const [bSelector, b] = entries[j]
      const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      if (width > 2 && height > 2) overlaps.push({ a: aSelector, b: bSelector, area: width * height })
    }
  }
  return { boxes, offscreen, overlaps }
}
