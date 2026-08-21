import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { startPreviewServer } from './perf-server.mjs'
import { PERF_BUDGET, assertWithinBudget, profileForHost } from './perf-budget.mjs'

const hostProfile = profileForHost()
const quality = process.env.QUALITY ?? hostProfile.quality
const visualDimension = process.env.VISUAL_DIMENSION

/**
 * The gate owns its server unless BASE_URL points at an existing one.
 *
 * Requiring a manually started preview made this gate unreproducible: the audit
 * logged a perf failure that was only a forgotten server.
 */
const externalBaseUrl = process.env.BASE_URL
const previewServer = externalBaseUrl ? undefined : await startPreviewServer()
const baseUrl = externalBaseUrl ?? previewServer.baseUrl
if (previewServer) {
  console.log(`perf gate started its own preview server at ${baseUrl}`)
  // Ensure the port is released even when the run is interrupted, or the next
  // run fails on --strictPort for reasons unrelated to performance.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { void previewServer.close().finally(() => process.exit(1)) })
  }
}

const targetUrl = new URL(baseUrl)
targetUrl.searchParams.set('perf', '1')
for (const [key, value] of new URLSearchParams(process.env.PERF_FLAGS)) {
  targetUrl.searchParams.set(key, value)
}
const outputDir = path.resolve('output/playwright')
const screenshotPath = path.join(outputDir, 'perf-final-desktop.png')
const exportPath = path.join(outputDir, 'perf-export.png')

await mkdir(outputDir, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({
  viewport: hostProfile.viewport,
  deviceScaleFactor: hostProfile.deviceScaleFactor,
})
await page.addInitScript(() => {
  Object.defineProperty(Navigator.prototype, 'share', { configurable: true, value: undefined })
  Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: undefined })
})
const errors = []
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('[vite] failed to connect to websocket')) {
    errors.push(message.text())
  }
})
page.on('pageerror', (error) => errors.push(error.message))

let gateError
try {
  await page.goto(targetUrl.href, {
    waitUntil: 'networkidle',
  })
  if (quality) {
    if (!['high', 'medium', 'low'].includes(quality)) throw new Error(`未知渲染质量：${quality}`)
    await page.evaluate((level) => {
      if (!window.__cognitiveTerrainPerf) throw new Error('性能控制面未启用')
      window.__cognitiveTerrainPerf.setQuality(level)
    }, quality)
  }
  if (visualDimension) {
    if (!['density', 'mastery', 'exploration', 'area'].includes(visualDimension)) {
      throw new Error(`未知点云编码：${visualDimension}`)
    }
    await page.evaluate((dimension) => {
      if (!window.__cognitiveTerrainPerf) throw new Error('性能控制面未启用')
      window.__cognitiveTerrainPerf.setVisualDimension(dimension)
    }, visualDimension)
    await page.waitForTimeout(400)
  }
  await page.locator('canvas').waitFor({ state: 'visible' })
  await page.waitForTimeout(1000)

  const canvas = page.locator('canvas')
  const timeline = page.getByRole('slider', { name: '时间轴' })
  const play = page.getByRole('button', { name: '播放时间演化' })
  const canvasBox = await canvas.boundingBox()
  const timelineBox = await timeline.boundingBox()
  if (!canvasBox || !timelineBox) throw new Error('无法读取 Canvas 或时间轴位置')

  const idle = await measure(page, 'idle', 1500, hostProfile.scenarioTimeoutMs, async () => page.waitForTimeout(1500))
  await play.click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '暂停时间演化' }).click()
  const playback = await measure(page, 'playback', 2500, hostProfile.scenarioTimeoutMs, async () => {
    await play.click()
    await page.waitForTimeout(2500)
    await page.getByRole('button', { name: '暂停时间演化' }).click()
  })
  const orbit = await measure(page, 'orbit', 1800, hostProfile.scenarioTimeoutMs, async () => {
    const startX = canvasBox.x + canvasBox.width * 0.54
    const startY = canvasBox.y + canvasBox.height * 0.46
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + canvasBox.width * 0.19, startY - canvasBox.height * 0.08, { steps: hostProfile.orbitSteps })
    await page.mouse.move(startX - canvasBox.width * 0.14, startY + canvasBox.height * 0.06, { steps: hostProfile.orbitSteps })
    await page.mouse.up()
    await page.waitForTimeout(300)
  })
  const syntheticScrub = await measure(page, 'syntheticScrub', 2100, hostProfile.scenarioTimeoutMs, async () => {
    await timeline.evaluate(
      (element) =>
        new Promise((resolve) => {
          const rect = element.getBoundingClientRect()
          const startedAt = performance.now()
          const duration = 1800
          const pointerId = 1
          element.dispatchEvent(
            new PointerEvent('pointerdown', {
              bubbles: true,
              clientX: rect.right,
              clientY: rect.top + rect.height / 2,
              pointerId,
              pointerType: 'mouse',
              isPrimary: true,
            }),
          )
          const tick = (now) => {
            const progress = Math.min(1, (now - startedAt) / duration)
            const sweep = progress < 0.5 ? 1 - progress * 2 : (progress - 0.5) * 2
            element.dispatchEvent(
              new PointerEvent('pointermove', {
                bubbles: true,
                clientX: rect.left + rect.width * sweep,
                clientY: rect.top + rect.height / 2,
                pointerId,
                pointerType: 'mouse',
                isPrimary: true,
              }),
            )
            if (progress < 1) {
              requestAnimationFrame(tick)
              return
            }
            element.dispatchEvent(
              new PointerEvent('pointerup', {
                bubbles: true,
                clientX: rect.left + rect.width * sweep,
                clientY: rect.top + rect.height / 2,
                pointerId,
                pointerType: 'mouse',
                isPrimary: true,
              }),
            )
            resolve()
          }
          requestAnimationFrame(tick)
        }),
      Number(await timeline.getAttribute('aria-valuemax')),
    )
    await page.waitForTimeout(300)
  })
  const directStoreScrub = await measure(page, 'directStoreScrub', 2100, hostProfile.scenarioTimeoutMs, async () => {
    await page.evaluate(
      async (maximum) => {
        if (!window.__cognitiveTerrainPerf) throw new Error('性能控制面未启用')
        await new Promise((resolve) => {
          const startedAt = performance.now()
          const duration = 1800
          const tick = (now) => {
            const progress = Math.min(1, (now - startedAt) / duration)
            const sweep = progress < 0.5 ? 1 - progress * 2 : (progress - 0.5) * 2
            window.__cognitiveTerrainPerf.setTimeline(sweep * maximum)
            if (progress < 1) requestAnimationFrame(tick)
            else resolve()
          }
          requestAnimationFrame(tick)
        })
      },
      Number(await timeline.getAttribute('aria-valuemax')),
    )
    await page.waitForTimeout(300)
  })
  const pointerScrub = await measure(page, 'pointerScrub', 1800, hostProfile.scenarioTimeoutMs, async () => {
    const y = timelineBox.y + timelineBox.height / 2
    const left = timelineBox.x + 4
    const right = timelineBox.x + timelineBox.width - 4
    await page.mouse.move(right, y)
    await page.mouse.down()
    await page.mouse.move(left, y, { steps: hostProfile.pointerSteps })
    await page.mouse.move(right, y, { steps: hostProfile.pointerSteps })
    await page.mouse.up()
    await page.waitForTimeout(300)
  })

  await page.screenshot({ path: screenshotPath })
  const pixels = await canvas.evaluate((element) => {
    const canvasElement = element
    canvasElement.dispatchEvent(new Event('cognitive-terrain:prepare-export'))
    const sample = document.createElement('canvas')
    sample.width = 32
    sample.height = 32
    const context = sample.getContext('2d', { willReadFrequently: true })
    if (!context) return { nonBackgroundRatio: 0, variance: 0 }
    context.drawImage(canvasElement, 0, 0, 32, 32)
    const data = context.getImageData(0, 0, 32, 32).data
    let changed = 0
    let variance = 0
    for (let index = 0; index < data.length; index += 4) {
      const delta = Math.abs(data[index] - 20) + Math.abs(data[index + 1] - 20) + Math.abs(data[index + 2] - 20)
      if (delta > 9) changed += 1
      variance += delta
    }
    return { nonBackgroundRatio: changed / 1024, variance: variance / 1024 }
  })

  // Keep the measurements visible even if the later PNG export stalls. This is
  // especially useful on software-rendered CI hosts, where export can be much
  // slower than the interaction probes that preceded it.
  console.log(
    JSON.stringify(
      { phase: 'measurements', hostProfile: hostProfile.id, visualDimension: visualDimension ?? 'density', quality: quality ?? 'high', idle, playback, orbit, syntheticScrub, directStoreScrub, pointerScrub, pixels, errors },
      null,
      2,
    ),
  )

  // Software rendering makes the export render far slower: the first CI run timed
  // out here after every measurement had already completed. Scale the allowance
  // with the host rather than weakening it everywhere.
  const downloadPromise = page.waitForEvent('download', { timeout: hostProfile.exportTimeoutMs })
  await page.getByRole('button', { name: '分享截图' }).click()
  const download = await downloadPromise
  await download.saveAs(exportPath)
  const exported = await stat(exportPath)

  console.log(
    JSON.stringify(
      { hostProfile: hostProfile.id, visualDimension: visualDimension ?? 'density', quality: quality ?? 'high', idle, playback, orbit, syntheticScrub, directStoreScrub, pointerScrub, pixels, exportBytes: exported.size, errors },
      null,
      2,
    ),
  )
  if (pixels.nonBackgroundRatio < 0.04 || pixels.variance < 1) throw new Error('Canvas 像素检查失败')
  if (exported.size < PERF_BUDGET.minExportBytes) {
    throw new Error(`PNG 导出过小：${exported.size} < ${PERF_BUDGET.minExportBytes} bytes`)
  }
  if (errors.length) throw new Error(`浏览器控制台出现 ${errors.length} 个错误`)

  // Without these assertions the gate only printed numbers and could never fail
  // on a regression, which is what made it a report rather than a gate.
  assertWithinBudget({ idle, playback, orbit, syntheticScrub, directStoreScrub, pointerScrub })
} catch (error) {
  gateError = error
}

const cleanupErrors = []
await cleanupStep('browser', () => browser.close(), cleanupErrors)
if (previewServer) await cleanupStep('preview server', () => previewServer.close(), cleanupErrors)
if (gateError && cleanupErrors.length) throw new AggregateError([gateError, ...cleanupErrors], 'perf gate and cleanup failed')
if (gateError) throw gateError
if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'perf cleanup failed')

async function cleanupStep(label, action, errors) {
  console.log(`perf cleanup: closing ${label}`)
  let timer
  try {
    await Promise.race([
      action(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} cleanup exceeded 10000ms`)), 10_000)
      }),
    ])
    console.log(`perf cleanup: ${label} closed`)
  } catch (error) {
    errors.push(error)
  } finally {
    clearTimeout(timer)
  }
}

async function measure(page, scenario, expectedDuration, timeoutMs, action) {
  console.log(`perf scenario ${scenario} started (${timeoutMs}ms timeout)`)
  await page.evaluate(() => {
    const samples = []
    const longTasks = []
    let active = true
    let previous = performance.now()
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration)
    })
    observer.observe({ type: 'longtask', buffered: false })
    const frame = (now) => {
      if (!active) return
      samples.push(now - previous)
      previous = now
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    window.__terrainPerf = { samples, longTasks, stop: () => { active = false; observer.disconnect() } }
  })
  const start = Date.now()
  let timeout
  try {
    await Promise.race([
      action(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`perf scenario ${scenario} exceeded ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
  const elapsed = Date.now() - start
  if (elapsed < expectedDuration) await page.waitForTimeout(expectedDuration - elapsed)
  return page.evaluate(() => {
    const probe = window.__terrainPerf
    probe.stop()
    const samples = probe.samples.slice(2).sort((a, b) => a - b)
    const mean = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length)
    const percentile = (ratio) => samples[Math.min(samples.length - 1, Math.floor(samples.length * ratio))] ?? 0
    const round = (value) => Math.round(value * 10) / 10
    return {
      durationMs: round(samples.reduce((sum, value) => sum + value, 0)),
      fps: round(1000 / mean),
      p95Ms: round(percentile(0.95)),
      maxMs: round(samples.at(-1) ?? 0),
      over16Ms: samples.filter((value) => value > 16.7).length,
      over33Ms: samples.filter((value) => value > 33.3).length,
      longTasks: probe.longTasks.map(round),
    }
  })
}
