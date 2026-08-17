import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('main terrain view has no serious accessibility violations', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(800)

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .disableRules(['color-contrast'])
    .analyze()

  expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([])
})

test('import dialog is accessible', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '打开项目菜单' }).click()
  await page.getByRole('button', { name: '导入笔记' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .include('.import-panel')
    .disableRules(['color-contrast'])
    .analyze()

  expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([])
})

test('project recovery menu is accessible', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cognitive-terrain:first-run', 'seen')
  })
  await page.goto('/')
  await page.getByRole('button', { name: '打开项目菜单' }).click()
  await page.getByRole('button', { name: '创建恢复点' }).click()
  await expect(page.getByText('已创建本地恢复点', { exact: true })).toBeVisible()

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .include('.project-menu')
    .disableRules(['color-contrast'])
    .analyze()

  expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([])
})

test('note detail sheet is accessible', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cognitive-terrain:first-run', 'seen'))
  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '切换二维等高线' }).click()
  const note = page.getByRole('button', { name: 'GPU 资源池化', exact: true })
  await note.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('笔记详情')).toBeVisible()

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .include('.note-detail')
    .disableRules(['color-contrast'])
    .analyze()

  expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([])
})

test('exploration workbench is accessible', async ({ page }) => {
  test.setTimeout(60_000)
  await page.addInitScript(() => {
    localStorage.setItem('cognitive-terrain:first-run', 'seen')
    localStorage.setItem('cognitive-terrain:embedding', 'deterministic')
  })
  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '打开项目菜单' }).click()
  await page.getByRole('button', { name: '加载今日学习' }).click()
  await expect(page.getByRole('button', { name: '当前时间层' })).toContainText('2026年8月', { timeout: 30_000 })
  await page.getByRole('button', { name: '打开知识概览' }).click()
  await expect(page.getByRole('region', { name: '探索工作台' })).toBeVisible()

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .include('.exploration-workbench')
    .disableRules(['color-contrast'])
    .analyze()

  expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([])
})
