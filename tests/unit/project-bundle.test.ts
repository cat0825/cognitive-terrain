import { describe, expect, it } from 'vitest'
import { createDemoProject } from '../../src/domain/demo'
import { parseProjectBundle, serializeProjectBundle } from '../../src/export/project-files'
import { migrateProject } from '../../src/storage/db'
import { createTaxonomyNode } from '../../src/domain/taxonomy'
import { buildPrerequisiteTopology, materializePrerequisites } from '../../src/domain/prerequisite-topology'
import type { TerrainProject } from '../../src/domain/types'

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

  it('round-trips prerequisite declarations, diagnostics, and derived evidence', async () => {
    const demo = createDemoProject()
    const root = { ...demo.notes[0], id: 'root', title: 'Root', prerequisites: [] }
    const child = {
      ...demo.notes[1],
      id: 'child',
      title: 'Child',
      prerequisites: materializePrerequisites('child', [{
        target: 'Root',
        provenance: 'app-confirmed',
        sourceField: 'app',
      }]),
    }
    const notes = [root, child]
    const source: TerrainProject = {
      ...demo,
      notes,
      prerequisiteTopology: buildPrerequisiteTopology(notes),
    }

    const restored = await parseProjectBundle(new File(
      [serializeProjectBundle(source)],
      'prerequisites.terrain.json',
      { type: 'application/json' },
    ))

    expect(restored.notes[1]?.prerequisites).toEqual(child.prerequisites)
    expect(restored.prerequisiteTopology).toEqual(source.prerequisiteTopology)
  })

  it('round-trips stable vault source identity, baselines, and sync provenance', async () => {
    const demo = createDemoProject()
    const note = {
      ...demo.notes[0],
      sourceId: 'source:vault:stable',
      sourceKey: 'vault-main:Math/Algebra.md',
      sourcePath: 'Math/Algebra.md',
      vault: 'Main vault',
    }
    const source: TerrainProject = {
      ...demo,
      notes: [note],
      vaultSync: {
        version: 1,
        vaults: [{
          vaultId: 'vault-main',
          displayName: 'Main vault',
          accessMode: 'directory-handle',
          lastScannedAt: '2026-08-17T12:00:00.000Z',
        }],
        sources: [{
          sourceId: note.sourceId,
          itemId: note.id,
          vaultId: 'vault-main',
          relativePath: 'Math/Algebra.md',
          status: 'present',
          rawContentHash: 'sha256:algebra',
          entityHash: 'entity:algebra',
          lastModifiedMs: 1_776_422_400_000,
          size: 512,
          acceptedFieldHashes: { title: 'field:title', content: 'field:content' },
          acceptedNote: {
            sourceKey: note.sourceKey,
            title: note.title,
            content: note.content,
            createdAt: note.createdAt,
            tags: [...note.tags],
            weight: note.weight,
            mastery: note.mastery,
            confidence: note.confidence,
            exploration: note.exploration,
            status: note.status,
            areas: [...(note.areas ?? [])],
            declaredAreas: [...(note.declaredAreas ?? [])],
            reviewedAt: note.reviewedAt,
            links: [...note.links],
          },
          acceptedAt: '2026-08-17T12:00:00.000Z',
        }],
        revisions: [{
          id: 'revision:vault-sync:algebra',
          sourceId: note.sourceId,
          itemId: note.id,
          operation: 'modify',
          rawContentHash: 'sha256:algebra',
          previousContentHash: 'sha256:algebra-old',
          entityHash: 'entity:algebra',
          acceptedAt: '2026-08-17T12:00:00.000Z',
          occurredAt: '2026-08-17T11:59:00.000Z',
          timestampSource: 'file-last-modified',
          provenance: 'vault-sync',
        }],
      },
    }

    const restored = await parseProjectBundle(new File(
      [serializeProjectBundle(source)],
      'vault-sync.terrain.json',
      { type: 'application/json' },
    ))

    expect(restored.notes[0]).toMatchObject({ sourceId: note.sourceId, sourceKey: note.sourceKey })
    expect(restored.vaultSync).toEqual(source.vaultSync)
    expect(JSON.stringify(restored)).not.toContain('vaultBindings')
  })
})
