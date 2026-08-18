import { expect, test } from '@playwright/test'

test('keeps the terrain evidence contract inspectable across 2D and 3D', async ({ page }, testInfo) => {
  test.setTimeout(process.env.CI ? 70_000 : 40_000)
  await page.addInitScript(() => {
    localStorage.setItem('cognitive-terrain:first-run', 'seen')
    localStorage.setItem('cognitive-terrain:reference-atlas:demo-ai-infra-terrain', 'demo-ai-infra-reference-atlas')
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })

  const legend = page.getByRole('complementary', { name: '地形语义图例' })
  const toggle = legend.getByRole('button', { name: '地形语义' })
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(legend.locator('dt')).toHaveCount(8)
  await expect(legend).toContainText('平面位置')
  await expect(legend).toContainText('二维距离不是原始 embedding 分数')
  await expect(legend).toContainText('海洋 / 缺口')
  await toggle.click()

  const gapButton = page.getByRole('button', { name: /^查看缺口 / }).first()
  await gapButton.focus()
  await page.keyboard.press('Enter')
  const gapDetail = page.getByRole('complementary', { name: '知识缺口证据详情' })
  await expect(gapDetail).toBeVisible()
  await expect(gapDetail).toContainText('reference-gap-v1')
  await expect(gapDetail).toContainText('参考边界')
  await expect(gapDetail).toContainText('证据 IDs')
  await page.keyboard.press('Escape')
  await expect(gapDetail).toBeHidden()

  await page.getByRole('button', { name: '切换二维等高线' }).click()
  await page.locator('.terrain-points [role="button"]').first().focus()
  await page.keyboard.press('Enter')
  const noteDetail = page.getByRole('complementary', { name: '笔记详情' })
  const neighborEvidence = noteDetail.getByRole('region', { name: '邻居证据' })
  await expect(neighborEvidence).toContainText('Embedding')
  await expect(neighborEvidence).toContainText('rank')
  await expect(neighborEvidence).toContainText('2D UMAP approximate distance')
  await expect(neighborEvidence).toContainText('共享 taxonomy')
  await expect(neighborEvidence).toContainText('共享 tags')
  await expect(neighborEvidence).toContainText('显式 WikiLink')
  await expect(neighborEvidence).toContainText('证据 IDs')
  await neighborEvidence.getByRole('button').first().click()
  await expect(noteDetail).toContainText('2D UMAP approximate distance')

  const peak = page.getByRole('button', { name: /^峰值 / }).first()
  await peak.focus()
  await page.keyboard.press('Enter')

  const detail = page.getByRole('complementary', { name: '峰值证据详情' })
  await expect(detail).toBeVisible()
  await expect(detail).toContainText('peak-local-maximum-v1')
  await expect(detail).toContainText('density-kde-v1')
  await expect(detail).toContainText('证据 IDs')
  await expect(detail).toContainText('全项目最终时间层')
  const contractText = await detail.locator('.peak-evidence-grid').innerText()

  await page.getByRole('button', { name: '切换二维等高线' }).click()
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
  const restoredContractText = await detail.locator('.peak-evidence-grid').innerText()
  expect(restoredContractText.replace(/\s/g, '')).toBe(contractText.replace(/\s/g, ''))

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }))
  expect(overflow).toEqual({ document: 0, body: 0 })
  expect(errors).toEqual([])

  await page.screenshot({
    path: `output/playwright/terrain-evidence-inspector-${testInfo.project.name}.png`,
    animations: 'disabled',
  })
})
