import { describe, expect, it, vi } from 'vitest'
import { REFERENCE_GAP_FORMULA_VERSION, type ReferenceGapReport } from '../../src/domain/reference-gaps'
import type { TerrainProject } from '../../src/domain/types'
import { referenceGapReportForExport } from '../../src/export/project-files'
import { drawReferenceGapSummary } from '../../src/export/share-card'

describe('reference gap PNG summary', () => {
  it('does not draw when reference-relative gaps are disabled', () => {
    const { context, text } = fakeCanvasContext()
    const report: ReferenceGapReport = {
      enabled: false,
      formulaVersion: REFERENCE_GAP_FORMULA_VERSION,
      evaluatedAt: '2026-08-15T00:00:00.000Z',
      reason: 'no-reference-atlas',
      gaps: [],
    }

    drawReferenceGapSummary(context, projectFixture(), report)

    expect(text).toEqual([])
    expect(context.save).not.toHaveBeenCalled()
  })

  it('draws atlas label, state counts, and no more than three non-spatial gap rows', () => {
    const { context, text } = fakeCanvasContext()
    const report: ReferenceGapReport = {
      enabled: true,
      formulaVersion: REFERENCE_GAP_FORMULA_VERSION,
      evaluatedAt: '2026-08-15T00:00:00.000Z',
      referenceAtlasId: 'atlas-ai',
      gaps: [
        gap('missing-high', 'Missing high', 'missing', 1, 4),
        gap('missing-low', 'Missing low', 'missing', 1, 1),
        gap('sparse', 'Sparse node', 'sparse', 0.5, 4),
        gap('stale', 'Stale node', 'stale', 0.75, 4),
        gap('covered', 'Covered node', 'covered', 0, 1),
      ],
    }

    drawReferenceGapSummary(context, projectFixture(), report)

    expect(text).toContain('REFERENCE OCEAN / GAP · 非空间摘要')
    expect(text).toContain('AI 基础参考图谱')
    expect(text).toContain('未覆盖 2 · 稀疏 1 · 已过期 1')
    expect(text).toContain('Missing high')
    expect(text).toContain('Stale node')
    expect(text).toContain('Sparse node')
    expect(text).not.toContain('Missing low')
    expect(text).not.toContain('Covered node')
    expect(text).toContain('另有 1 项 · 仅相对所选 atlas，不对应地图坐标')
  })

  it('derives an enabled report from the active atlas when the caller does not supply one', () => {
    const report = referenceGapReportForExport(projectFixture(), undefined, '2026-08-15T00:00:00.000Z')

    expect(report).toMatchObject({
      enabled: true,
      referenceAtlasId: 'atlas-ai',
      formulaVersion: REFERENCE_GAP_FORMULA_VERSION,
    })
    expect(report.gaps).toEqual([
      expect.objectContaining({ nodeId: 'taxonomy-ai', state: 'missing', gap: 1, ocean: 1 }),
    ])
  })

  it('keeps gap export disabled without an active atlas', () => {
    const project = { ...projectFixture(), activeReferenceAtlasId: undefined }

    expect(referenceGapReportForExport(project, undefined, '2026-08-15T00:00:00.000Z')).toMatchObject({
      enabled: false,
      reason: 'no-reference-atlas',
      gaps: [],
    })
  })
})

function fakeCanvasContext(): {
  context: CanvasRenderingContext2D
  text: string[]
} {
  const text: string[] = []
  const context = {
    canvas: { width: 1280, height: 720 },
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn((value: string) => text.push(value)),
    measureText: vi.fn((value: string) => ({ width: value.length * 8 })),
  } as unknown as CanvasRenderingContext2D
  return { context, text }
}

function projectFixture(): TerrainProject {
  return {
    notes: [],
    interactionEvents: [],
    taxonomyNodes: [{
      id: 'taxonomy-ai',
      workspaceId: 'project-1',
      label: 'AI',
      aliases: [],
      version: 1,
      status: 'active',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }],
    activeReferenceAtlasId: 'atlas-ai',
    referenceAtlases: [{
      id: 'atlas-ai',
      workspaceId: 'project-1',
      label: 'AI 基础参考图谱',
      taxonomyVersion: 1,
      taxonomyNodeIds: ['taxonomy-ai'],
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }],
  } as TerrainProject
}

function gap(
  nodeId: string,
  label: string,
  state: ReferenceGapReport['gaps'][number]['state'],
  value: number,
  expectedWeight: number,
): ReferenceGapReport['gaps'][number] {
  return {
    nodeId,
    label,
    expectedWeight,
    state,
    gap: value,
    ocean: value,
    supportingItemIds: [],
    expectedNodeIds: [nodeId],
  }
}
