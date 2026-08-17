import { describe, expect, it } from 'vitest'
import { createDemoProject } from '../../src/domain/demo'
import { parseProjectBundle, serializeProjectBundle } from '../../src/export/project-files'
import { migrateProject } from '../../src/storage/db'
import { createTaxonomyNode } from '../../src/domain/taxonomy'

describe('project bundle migration', () => {
  it('loads a Schema v2 bundle into the Schema v3 compatibility shape', async () => {
    const project = createDemoProject()
    const {
      cognitiveStates: _cognitiveStates,
      interactionEvents: _interactionEvents,
      terrainProfiles: _terrainProfiles,
      activeTerrainProfileId: _activeTerrainProfileId,
      ...legacy
    } = project
    const serialized = {
      ...legacy,
      schemaVersion: 2,
      notes: legacy.notes.slice(0, 2).map((note, index) => index === 0
        ? { ...note, area: '数学', areas: ['数学', '物理'] }
        : note),
      snapshots: [],
      peaks: [],
      noteNeighbors: [[], []],
    }
    const file = new File([JSON.stringify(serialized)], 'legacy.terrain.json', {
      type: 'application/json',
    })

    const migrated = await parseProjectBundle(file)

    expect(migrated.schemaVersion).toBe(3)
    expect(migrated.notes).toHaveLength(2)
    expect(migrated.cognitiveStates).toHaveLength(2)
    expect(migrated.interactionEvents).toEqual([])
    expect(migrated.activeTerrainProfileId).toBe('density')
    expect(migrated.notes[0]).toMatchObject({ area: '数学', areas: ['数学', '物理'] })
  })

  it('round-trips compacted activity history without losing review timestamps', async () => {
    const demo = createDemoProject()
    const source = migrateProject({
      ...demo,
      updatedAt: '2026-08-15T00:00:00.000Z',
      notes: [{ ...demo.notes[0], reviewedAt: '2025-08-15T00:00:00.000Z' }],
      interactionEvents: [{
        id: 'event:old-review',
        itemId: demo.notes[0].id,
        type: 'reviewed',
        occurredAt: '2025-01-01T00:00:00.000Z',
      }],
    })
    const file = new File([serializeProjectBundle(source)], 'activity.terrain.json', {
      type: 'application/json',
    })

    const restored = await parseProjectBundle(file)

    expect(restored.notes[0]?.reviewedAt).toBe('2025-08-15T00:00:00.000Z')
    expect(restored.activityHistory?.aggregates).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'reviewed', count: 1 }),
    ]))
  })

  it('round-trips taxonomy hierarchy, aliases, versions, and declared labels', async () => {
    const demo = createDemoProject()
    const root = createTaxonomyNode({ workspaceId: demo.id, label: 'Engineering', aliases: ['工程'], version: 3 }, demo.updatedAt)
    const child = createTaxonomyNode({ workspaceId: demo.id, label: 'Systems', parentId: root.id, aliases: ['系统'], version: 3 }, demo.updatedAt)
    const source = migrateProject({
      ...demo,
      taxonomyNodes: [root, child],
      taxonomyVersion: 3,
      referenceAtlases: [{
        id: 'atlas-engineering-v3',
        workspaceId: demo.id,
        label: 'Engineering reference',
        taxonomyVersion: 3,
        taxonomyNodeIds: [root.id, child.id],
        createdAt: demo.updatedAt,
        updatedAt: demo.updatedAt,
      }],
      notes: [{ ...demo.notes[0], area: 'Systems', areas: ['Systems'], declaredAreas: [' 系统 '] }],
    })
    const file = new File([serializeProjectBundle(source)], 'taxonomy.terrain.json', { type: 'application/json' })

    const restored = await parseProjectBundle(file)

    expect(restored.taxonomyVersion).toBe(3)
    expect(restored.taxonomyNodes).toEqual([root, child])
    expect(restored.referenceAtlases).toEqual(source.referenceAtlases)
    expect(restored.notes[0]?.declaredAreas).toEqual([' 系统 '])
  })
})
