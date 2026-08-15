import { expect, type Page } from '@playwright/test'
import path from 'node:path'

export const vaultFixtureDirectory = path.resolve('tests/fixtures/obsidian-vault/AtlasVault')

export async function importVaultFixture(page: Page): Promise<void> {
  await page.getByRole('button', { name: '打开项目菜单' }).click()
  await page.getByRole('button', { name: '导入笔记' }).click()
  await page.locator('.import-folder input[type="file"]').setInputFiles(vaultFixtureDirectory)
  await expect(page.locator('.import-count')).toContainText('12 条可分析笔记')
  await expect(page.locator('.import-issues')).toContainText('4 条导入问题')
  await page.locator('.embedding-choice select').selectOption('deterministic')
  await page.getByRole('button', { name: '生成地形' }).click()
  await expect(page.locator('.processing-overlay')).toBeHidden({ timeout: 20_000 })

  await page.getByRole('button', { name: '打开项目菜单' }).click()
  await expect(page.locator('.project-list-item.is-current')).toContainText('12 条', { timeout: 10_000 })
  await page.getByRole('button', { name: '打开项目菜单' }).click()
}

export async function openFixtureCollision(page: Page): Promise<void> {
  await page.getByRole('button', { name: '打开地图筛选' }).click()
  const panel = page.getByRole('complementary', { name: '地图筛选' })
  await panel.locator('.visual-dimension-control').getByRole('button', { name: '领域', exact: true }).click()
  await expect(panel.locator('.plate-legend-summary')).toContainText('6 个板块 · 13 条跨域 WikiLink · 1 个碰撞带 · 1 条未分类')
  await page.getByRole('button', { name: '关闭筛选' }).click()
  await page.getByRole('button', { name: '切换二维等高线' }).click()
  const band = page.getByRole('button', { name: /碰撞带，3 条跨域 WikiLink/ }).first()
  await expect(band).toBeVisible()
  await band.click()
  await expect(page.getByRole('complementary', { name: '板块碰撞详情' })).toBeVisible()
}
