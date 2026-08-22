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

  it('separates activity elevation, temperature, mastery, and learning progression semantics', async () => {
    const report = await buildProjectReport(createDemoProject())

    expect(report).toContain('活动海拔（activity-elevation-v1）：仅将近期打开、编辑和复习事件的衰减聚合映射到高度')
    expect(report).toContain('温度：仅将同类近期事件的衰减热度编码为颜色')
    expect(report).toContain('熟练度：来自显式 mastery 认知状态；学习进度是独立的跨时间概念')
  })

  it('disables gap claims without an active reference atlas', async () => {
    // The demo ships with its atlas selected, so the disabled path has to be set up
    // the way an imported project arrives: atlases available, none chosen.
    const report = await buildProjectReport({ ...createDemoProject(), activeReferenceAtlasId: undefined })

    expect(report).toContain('海洋/缺口（reference-gap-v1）：disabled')
    expect(report).toContain('不生成知识或技能缺口声明；低活动不等于缺口')
  })

  it('enables gap claims for the demo project without a manual pick', async () => {
    const report = await buildProjectReport(createDemoProject())

    expect(report).toContain('海洋/缺口（reference-gap-v1）：enabled')
    expect(report).toContain('Active reference atlas：AI Infra 核心能力参考图谱（taxonomy v1）')
  })

  it('describes gaps relative to the active reference atlas', async () => {
    const project = createDemoProject()
    project.referenceAtlases = [{
      id: 'atlas-engineering-v3',
      workspaceId: project.id,
      label: 'Engineering reference',
      taxonomyVersion: 3,
      taxonomyNodeIds: [],
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }]
    project.activeReferenceAtlasId = 'atlas-engineering-v3'

    const report = await buildProjectReport(project)

    expect(report).toContain('Active reference atlas：Engineering reference（taxonomy v3）')
    expect(report).toContain('海洋/缺口（reference-gap-v1）：enabled')
    expect(report).toContain('仅表示当前项目相对「Engineering reference」预期 taxonomy nodes 的覆盖差距')
    expect(report).not.toContain('海洋/缺口（reference-gap-v1）：disabled')
  })
})
