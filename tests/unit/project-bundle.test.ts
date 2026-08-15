import { describe, expect, it } from 'vitest'
import { createDemoProject } from '../../src/domain/demo'
import { parseProjectBundle } from '../../src/export/project-files'

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
})
