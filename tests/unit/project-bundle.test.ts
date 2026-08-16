import { describe, expect, it } from 'vitest'
import { createDemoProject } from '../../src/domain/demo'
import { parseProjectBundle, serializeProjectBundle } from '../../src/export/project-files'
import { migrateProject } from '../../src/storage/db'

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
})