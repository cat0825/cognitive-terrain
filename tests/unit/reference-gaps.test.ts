import { describe, expect, it } from 'vitest'
import {
  REFERENCE_GAP_FORMULA_VERSION,
  bindReferenceAtlasToTaxonomy,
  buildProjectReferenceGapReport,
  buildReferenceGapReport,
} from '../../src/domain/reference-gaps'
import { mergeTaxonomyNodes, reparentTaxonomyNode, renameTaxonomyNode } from '../../src/domain/taxonomy'
import type { TerrainProject } from '../../src/domain/types'

const evaluatedAt = '2026-08-15T00:00:00.000Z'
const atlas = {
  id: 'atlas-ai',
  label: 'AI 基础',
  taxonomyVersion: 'taxonomy-v1',
  nodes: [
    { id: 'root', label: 'Root' },
    { id: 'ml', label: 'ML', parentId: 'root' },
    { id: 'systems', label: 'Systems', parentId: 'root' },
  ],
} as const

describe('reference-relative gaps', () => {
  it('disables gap and ocean values when no atlas is selected', () => {
    expect(buildReferenceGapReport(undefined, [], { evaluatedAt })).toEqual({
      enabled: false,
      formulaVersion: REFERENCE_GAP_FORMULA_VERSION,
      evaluatedAt,
      reason: 'no-reference-atlas',
      gaps: [],
    })
  })

  it('exposes missing, sparse, stale and covered states with supporting items', () => {
    const report = buildReferenceGapReport(atlas, [
      { itemId: 'm1', taxonomyNodeIds: ['ml'], lastActivityAt: '2026-08-14T00:00:00.000Z' },
      { itemId: 'm2', taxonomyNodeIds: ['ml'], lastActivityAt: '2026-08-13T00:00:00.000Z' },
      { itemId: 'old', taxonomyNodeIds: ['systems'], lastActivityAt: '2026-01-01T00:00:00.000Z' },
    ], { evaluatedAt })

    expect(report.enabled).toBe(true)
    expect(report.referenceAtlasId).toBe('atlas-ai')
    expect(report.gaps.find((gap) => gap.nodeId === 'root')).toMatchObject({ state: 'missing', gap: 1, ocean: 1, expectedNodeIds: ['root', 'ml', 'systems'] })
    expect(report.gaps.find((gap) => gap.nodeId === 'ml')).toMatchObject({ state: 'covered', gap: 0, supportingItemIds: ['m1', 'm2'] })
    expect(report.gaps.find((gap) => gap.nodeId === 'systems')).toMatchObject({ state: 'stale', gap: 0.75, supportingItemIds: ['old'] })
  })

  it('rejects unsupported formula versions', () => {
    expect(() => buildReferenceGapReport(atlas, [], { evaluatedAt, formulaVersion: 'reference-gap-v0' as never })).toThrow(/Unsupported reference gap formula/)
  })

  it('builds project coverage from taxonomy aliases and retained aggregate activity', () => {
    const report = buildProjectReferenceGapReport(projectFixture(), 'atlas-ai', evaluatedAt)

    expect(report.referenceAtlasId).toBe('atlas-ai')
    expect(report.gaps).toEqual([
      expect.objectContaining({
        nodeId: 'ml',
        state: 'sparse',
        supportingItemIds: ['note-1'],
        lastSupportingAt: '2026-08-14T12:00:00.000Z',
      }),
    ])
  })

  it('keeps snapshot labels and hierarchy stable after rename, reparent, and merge', () => {
    const project = projectFixture()
    const manifest = project.referenceAtlases![0]
    const root = {
      id: 'root', workspaceId: project.id, label: 'Root', aliases: ['Foundation'], version: 1,
      status: 'active' as const, createdAt: project.createdAt, updatedAt: project.updatedAt,
    }
    const ml = project.taxonomyNodes![0]
    project.taxonomyNodes = [root, { ...ml, parentId: root.id }]
    project.taxonomyVersion = 1
    manifest.taxonomyNodeIds = [root.id, ml.id]
    project.referenceAtlases = [bindReferenceAtlasToTaxonomy(manifest, project.taxonomyNodes, 1, project.updatedAt)]
    const before = buildProjectReferenceGapReport(project, manifest.id, evaluatedAt)

    const reparanted = reparentTaxonomyNode(project.taxonomyNodes, ml.id, undefined, [], '2026-08-15T01:00:00.000Z').nodes
    const renamed = renameTaxonomyNode(reparanted, root.id, 'Renamed root', [], '2026-08-15T02:00:00.000Z').nodes
    const merged = mergeTaxonomyNodes(renamed, ml.id, root.id, [], '2026-08-15T03:00:00.000Z').nodes
    project.taxonomyVersion = 4
    project.taxonomyNodes = merged
    const after = buildProjectReferenceGapReport(project, manifest.id, evaluatedAt)

    expect(after).toEqual(before)
    expect(after.gaps.find((gap) => gap.nodeId === root.id)).toMatchObject({
      label: 'Root',
      expectedNodeIds: ['root', 'ml'],
    })
  })

  it('disables a legacy atlas after taxonomy changes and enables an explicit rebind', () => {
    const project = projectFixture()
    project.taxonomyVersion = 2
    project.taxonomyNodes = project.taxonomyNodes!.map((node) => ({
      ...node,
      label: 'Machine Learning v2',
      aliases: ['ML v2'],
      version: 2,
    }))

    const invalid = buildProjectReferenceGapReport(project, 'atlas-ai', evaluatedAt)
    expect(invalid).toMatchObject({
      enabled: false,
      reason: 'atlas-rebind-required',
      referenceTaxonomyVersion: 1,
      currentTaxonomyVersion: 2,
    })

    project.referenceAtlases = [bindReferenceAtlasToTaxonomy(
      project.referenceAtlases![0],
      project.taxonomyNodes,
      2,
      project.updatedAt,
    )]
    const rebound = buildProjectReferenceGapReport(project, 'atlas-ai', evaluatedAt)
    expect(rebound.enabled).toBe(true)
    expect(rebound.gaps[0]).toMatchObject({ label: 'Machine Learning v2' })
  })
})

function projectFixture(): TerrainProject {
  return {
    schemaVersion: 3,
    id: 'project-1',
    name: 'Reference gap project',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
    timeZone: 'UTC',
    modelId: 'test-model',
    embeddingMode: 'fallback',
    sourceDigest: 'test-digest',
    gridSize: 2,
    notes: [{
      id: 'note-1',
      fingerprint: 'note-1',
      title: 'Machine learning',
      content: 'Coverage note',
      createdAt: '2026-08-01T00:00:00.000Z',
      createdAtMs: Date.parse('2026-08-01T00:00:00.000Z'),
      tags: [],
      weight: 1,
      declaredAreas: ['ML'],
      links: [],
      x: 0,
      y: 0,
    }],
    snapshots: [],
    peaks: [],
    noteNeighbors: [],
    cognitiveStates: [],
    interactionEvents: [{
      id: 'invalid-opened',
      itemId: 'note-1',
      type: 'opened',
      occurredAt: 'invalid',
    }, {
      id: 'future-opened',
      itemId: 'note-1',
      type: 'opened',
      occurredAt: '2026-08-16T12:00:00.000Z',
    }, {
      id: 'opened-1',
      itemId: 'note-1',
      type: 'opened',
      occurredAt: '2026-08-13T12:00:00.000Z',
    }],
    activityHistory: {
      policyVersion: 1,
      timeZone: 'UTC',
      rawEvents: [],
      aggregates: [{
        id: 'aggregate-1',
        policyVersion: 1,
        itemId: 'note-1',
        type: 'edited',
        granularity: 'day',
        bucket: '2026-08-14',
        timeZone: 'UTC',
        count: 2,
        firstOccurredAt: '2026-08-14T10:00:00.000Z',
        lastOccurredAt: '2026-08-14T12:00:00.000Z',
        heatAtCompactedAt: 1,
        compactedAt: '2026-08-14T12:00:00.000Z',
      }],
    },
    terrainProfiles: [{
      id: 'density',
      label: 'Density',
      elevation: 'density',
      color: 'area',
      formulaVersion: 'density-v1',
    }],
    activeTerrainProfileId: 'density',
    taxonomyNodes: [{
      id: 'ml',
      workspaceId: 'project-1',
      label: 'Machine Learning',
      aliases: ['ML'],
      version: 1,
      status: 'active',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }],
    referenceAtlases: [{
      id: 'atlas-ai',
      workspaceId: 'project-1',
      label: 'AI basics',
      taxonomyVersion: 1,
      taxonomyNodeIds: ['ml'],
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }],
    activeReferenceAtlasId: 'atlas-ai',
  }
}
