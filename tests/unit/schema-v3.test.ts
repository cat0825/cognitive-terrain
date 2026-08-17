import { describe, expect, it } from 'vitest'
import { createDemoProject } from '../../src/domain/demo'
import { plateIdForArea } from '../../src/domain/knowledge-plates'
import { migrateTerrainProjectToV3 } from '../../src/domain/schema-v3'
import { createTaxonomyNode } from '../../src/domain/taxonomy'
import { DEFAULT_TERRAIN_PROFILES, profileIdForVisualDimension } from '../../src/domain/terrain-profile'
import type { TerrainProject } from '../../src/domain/types'

const schemaDemoFixture = createDemoProject()

function migrationFixture(): TerrainProject {
  const demo = schemaDemoFixture
  return {
    ...demo,
    id: 'migration-fixture',
    name: '迁移样本',
    notes: [
      {
        ...demo.notes[0],
        id: 'linear-algebra',
        title: '线性代数',
        content: '矩阵与向量空间',
        source: 'https://example.com/linear-algebra',
        sourcePath: undefined,
        vault: undefined,
        links: ['概率论', '尚未创建的主题'],
        area: 'math.linear-algebra',
        areas: ['math.linear-algebra', 'physics'],
        mastery: 0.7,
        confidence: 0.8,
        exploration: 0.9,
      },
      {
        ...demo.notes[1],
        id: 'probability',
        title: '概率论',
        content: '随机变量',
        source: undefined,
        sourcePath: undefined,
        vault: undefined,
        links: [],
        area: undefined,
        areas: undefined,
        mastery: undefined,
        confidence: undefined,
        exploration: undefined,
        status: undefined,
      },
    ],
    snapshots: [],
    peaks: [],
    noteNeighbors: [[], []],
    cognitiveStates: [],
    interactionEvents: [],
    taxonomyNodes: undefined,
    taxonomyVersion: undefined,
    referenceAtlases: undefined,
    activeReferenceAtlasId: undefined,
  }
}

describe('Schema v3 dry-run migration', () => {
  it('separates facts, cognitive state, relations, and layout without losing item identity', () => {
    const project = migrationFixture()
    const { bundle, report } = migrateTerrainProjectToV3(project)

    expect(bundle.workspace).toMatchObject({ schemaVersion: 3, id: project.id, activeTerrainProfileId: 'density' })
    expect(bundle.items.map((item) => item.id)).toEqual(project.notes.map((note) => note.id))
    expect(bundle.layouts.map(({ itemId, x, y }) => ({ itemId, x, y }))).toEqual(
      project.notes.map(({ id: itemId, x, y }) => ({ itemId, x, y })),
    )
    expect(bundle.sources).toHaveLength(1)
    expect(bundle.items.find((item) => item.id === 'probability')).toMatchObject({ sourceIds: [], status: 'draft' })
    expect(bundle.cognitiveStates).toEqual([
      expect.objectContaining({ itemId: 'linear-algebra', mastery: 0.7, provenance: 'migration' }),
    ])
    expect(bundle.plateMemberships).toEqual([
      expect.objectContaining({ itemId: 'linear-algebra', taxonomyNodeId: plateIdForArea('math.linear-algebra'), weight: 0.5, provenance: 'migration' }),
      expect.objectContaining({ itemId: 'linear-algebra', taxonomyNodeId: plateIdForArea('physics'), weight: 0.5, provenance: 'migration' }),
    ])
    expect(bundle.items[0]).toMatchObject({ area: 'math.linear-algebra', areas: ['math.linear-algebra', 'physics'] })
    expect(bundle.plateMemberships.reduce((sum, membership) => sum + membership.weight, 0)).toBe(1)
    expect(report).toMatchObject({
      itemCount: 2,
      sourceCount: 1,
      relationCount: 2,
      unresolvedRelationCount: 1,
      cognitiveStateCount: 1,
      layoutCount: 2,
      citationCount: 0,
      revisionCount: 2,
    })
    expect(bundle.citations).toEqual([])
    expect(bundle.revisions).toHaveLength(2)
    expect(JSON.stringify(bundle.revisions)).not.toContain('矩阵与向量空间')
  })

  it('resolves WikiLinks by normalized title and preserves unresolved targets', () => {
    const { bundle } = migrateTerrainProjectToV3(migrationFixture())

    expect(bundle.relations).toEqual([
      expect.objectContaining({ fromItemId: 'linear-algebra', toItemId: 'probability', resolved: true }),
      expect.objectContaining({ fromItemId: 'linear-algebra', targetTitle: '尚未创建的主题', resolved: false }),
    ])
  })

  it('keeps YAML provenance on imported area membership', () => {
    const project = migrationFixture()
    project.notes[0].cognitiveStateProvenance = 'yaml'
    const { bundle } = migrateTerrainProjectToV3(project)

    expect(bundle.plateMemberships[0]).toMatchObject({
      taxonomyNodeId: plateIdForArea('math.linear-algebra'),
      provenance: 'yaml',
    })
  })

  it('preserves the declared area label while resolving an alias to a versioned taxonomy node', () => {
    const project = migrationFixture()
    const declaredLabel = '  ＳＴＡＴＳ  '
    const taxonomyNode = createTaxonomyNode({
      id: 'taxonomy-statistics',
      workspaceId: project.id,
      label: 'Statistics',
      aliases: ['stats'],
      version: 4,
    }, project.updatedAt)
    project.notes[0] = {
      ...project.notes[0],
      area: 'Statistics',
      areas: ['Statistics'],
      declaredAreas: [declaredLabel],
    }
    project.taxonomyNodes = [taxonomyNode]
    project.taxonomyVersion = 4

    const { bundle } = migrateTerrainProjectToV3(project)

    expect(bundle.items[0]).toMatchObject({ declaredAreas: [declaredLabel] })
    expect(bundle.plateMemberships).toContainEqual(expect.objectContaining({
      itemId: project.notes[0].id,
      taxonomyNodeId: taxonomyNode.id,
      declaredLabel,
      resolved: true,
      resolution: 'alias',
      taxonomyVersion: 4,
    }))
    expect(bundle.workspace.taxonomyVersion).toBe(4)
    expect(bundle.taxonomyNodes).toEqual([taxonomyNode])
  })

  it('links local Obsidian source paths to their items without inventing citations', () => {
    const project = migrationFixture()
    project.notes[1] = {
      ...project.notes[1],
      sourcePath: 'math/probability.md',
      vault: 'research',
    }

    const { bundle, report } = migrateTerrainProjectToV3(project)
    const item = bundle.items.find((candidate) => candidate.id === 'probability')
    const source = bundle.sources.find((candidate) => candidate.sourcePath === 'math/probability.md')

    expect(source).toBeDefined()
    expect(item?.sourceIds).toEqual([source?.id])
    expect(item?.status).toBe('active')
    expect(bundle.citations).toEqual([])
    expect(report.sourceCount).toBe(2)
  })

  it('rejects duplicate item ids instead of silently overwriting records', () => {
    const project = migrationFixture()
    project.notes[1] = { ...project.notes[1], id: project.notes[0].id }

    expect(() => migrateTerrainProjectToV3(project)).toThrow(/duplicate item id/)
  })

  it('rejects orphan cognitive state and interaction event references instead of dropping them', () => {
    const stateProject = migrationFixture()
    stateProject.cognitiveStates = [{
      itemId: 'missing-item',
      mastery: 0.5,
      updatedAt: stateProject.updatedAt,
      provenance: 'migration',
    }]
    expect(() => migrateTerrainProjectToV3(stateProject)).toThrow(/cognitive state reference to missing item/)

    const eventProject = migrationFixture()
    eventProject.interactionEvents = [{
      id: 'orphan-event',
      itemId: 'missing-item',
      type: 'opened',
      occurredAt: eventProject.updatedAt,
    }]
    expect(() => migrateTerrainProjectToV3(eventProject)).toThrow(/interaction event reference to missing item/)
  })
})

describe('terrain profiles', () => {
  it('give every elevation a stable, unique profile and keep area as a color-only compatibility mode', () => {
    expect(new Set(DEFAULT_TERRAIN_PROFILES.map((profile) => profile.id)).size).toBe(DEFAULT_TERRAIN_PROFILES.length)
    expect(DEFAULT_TERRAIN_PROFILES.map((profile) => profile.elevation)).toEqual([
      'density',
      'mastery',
      'exploration',
      'activity',
      'structure',
    ])
    expect(profileIdForVisualDimension('area')).toBe('density')
    expect(profileIdForVisualDimension('temperature')).toBe('density')
  })
})
