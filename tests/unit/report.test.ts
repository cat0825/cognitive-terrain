import { describe, expect, it } from 'vitest'
import { createDemoProject } from '../../src/domain/demo'
import { buildProjectReport } from '../../src/export/project-files'

describe('project review report', () => {
  it('contains peaks, notes, and model metadata', async () => {
    const report = await buildProjectReport(createDemoProject())

    expect(report).toContain('# AI Infra 知识地形 复盘报告')
    expect(report).toContain('## 主题峰值')
    expect(report).toContain('## 笔记清单')
    expect(report).toMatch(/模型：/)
    expect(report).toMatch(/笔记数：1800/)
    expect(report).toMatch(/^### /m)
    expect(report).toMatch(/^- \[/m)
  })

  it('sorts peaks by height descending', async () => {
    const report = await buildProjectReport(createDemoProject())
    const section = report.split('## 主题峰值')[1]?.split('## 笔记清单')[0] ?? ''
    const heights = [...section.matchAll(/高度：([\d.]+)/g)].map((match) => Number(match[1]))
    expect(heights.length).toBeGreaterThan(0)
    expect(heights).toEqual([...heights].sort((a, b) => b - a))
  })
})
