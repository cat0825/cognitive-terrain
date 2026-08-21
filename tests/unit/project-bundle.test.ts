import { describe, expect, it } from 'vitest'
import { createDemoProject } from '../../src/domain/demo'
import { migrateTerrainProjectToV3 } from '../../src/domain/schema-v3'
import { parseProjectBundle, parseProjectBundleWithWarnings, serializeProjectBundle } from '../../src/export/project-files'
import { migrateProject } from '../../src/storage/db'
import { createTaxonomyNode } from '../../src/domain/taxonomy'
import { createCognitiveObservation } from '../../src/domain/learning-progression'
import { buildPrerequisiteTopology, materializePrerequisites } from '../../src/domain/prerequisite-topology'
import { buildProjectReferenceGapReport } from '../../src/domain/reference-gaps'
import type { ExplorationLifecycleItem, TerrainProject } from '../../src/domain/types'

describe('project bundle future-dated activity', () => {
  it('drops future activity, reports it, and still imports the rest of the bundle', async () => {
    const demo = createDemoProject()
    const itemId = demo.notes[0].id
    const past = {
      id: 'event-past',
      itemId,
      type: 'edited' as const,
      occurredAt: new Date(Date.now() - 86_400_000).toISOString(),
    }
    const future = {
      id: 'event-future',
      itemId,
      type: 'edited' as const,
      occurredAt: '2030-01-01T00:00:00.000Z',
    }
    // Inject the future event after migration: migrateProject strips it, so
    // building the source through it would serialize an already-clean bundle and
    // the test would pass without exercising the import boundary at all.
    const migrated = migrateProject({ ...demo, interactionEvents: [past] })
    const source: TerrainProject = {
      ...migrated,
      interactionEvents: [...migrated.interactionEvents, future],
    }

    const { project, futureActivityWarnings } = await parseProjectBundleWithWarnings(new File(
      [serializeProjectBundle(source)],
      'future-activity.terrain.json',
      { type: 'application/json' },
    ))

    // The valid event and the notes survive: one bad timestamp must not cost the
    // user their whole project.
    expect(project.interactionEvents.map((event) => event.id)).toEqual(['event-past'])
    expect(project.notes.length).toBe(demo.notes.length)
    expect(futureActivityWarnings).toEqual([
      { scope: 'interaction-event', itemId, occurredAt: '2030-01-01T00:00:00.000Z' },
    ])
  })

  it('reports no warnings for a bundle whose activity is entirely in the past', async () => {
    const demo = createDemoProject()
    const source = migrateProject({
      ...demo,
      interactionEvents: [{
        id: 'event-past',
        itemId: demo.notes[0].id,
        type: 'reviewed' as const,
        occurredAt: new Date(Date.now() - 86_400_000).toISOString(),
      }],
    })

    const { futureActivityWarnings } = await parseProjectBundleWithWarnings(new File(
      [serializeProjectBundle(source)],
      'past-activity.terrain.json',
      { type: 'application/json' },
    ))

    expect(futureActivityWarnings).toEqual([])
  })
})

describe('project bundle migration', () => {
  it('round-trips learning observations while snapshot-only projects stay history-free', async () => {
    const demo = createDemoProject()
    const observation = createCognitiveObservation({
      id: 'observation:bundle:mastery:1',
      itemId: demo.notes[0].id,
      field: 'mastery',
      value: 0.76,
      observedAt: '2026-08-17T08:00:00.000Z',
      provenance: 'yaml-import',
      reason: 'Obsidian frontmatter import',
    })
    const source = migrateProject({
      ...demo,
      cognitiveObservations: [observation],
      learningProgressionProfileVersion: 'learning-progression-v1',
    })
    const restored = await parseProjectBundle(new File(
      [serializeProjectBundle(source)],
      'learning-progression.terrain.json',
      { type: 'application/json' },
    ))
    const snapshotOnly = await parseProjectBundle(new File(
      [serializeProjectBundle({ ...demo, cognitiveObservations: undefined })],
      'snapshot-only.terrain.json',
      { type: 'application/json' },
    ))

    expect(restored.cognitiveObservations).toEqual([observation])
    expect(restored.learningProgressionProfileVersion).toBe('learning-progression-v1')
    expect(snapshotOnly.cognitiveObservations).toEqual([])
  })

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

  it('round-trips inspectable embedding neighbor evidence', async () => {
    const demo = createDemoProject()
    const source = migrateProject({
      ...demo,
      noteNeighborEvidence: [[{
        sourceId: demo.notes[0].id,
        targetId: demo.notes[1].id,
        rank: 1,
        score: 0.875,
        modelId: 'Xenova/multilingual-e5-small',
        embeddingMode: 'semantic',
        formulaVersion: 'embedding-cosine-neighbors-v1',
        provenance: 'embedding',
      }]],
    })
    const file = new File([serializeProjectBundle(source)], 'neighbor-evidence.terrain.json', {
      type: 'application/json',
    })

    const restored = await parseProjectBundle(file)

    expect(restored.noteNeighborEvidence).toEqual(source.noteNeighborEvidence)
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
      activeReferenceAtlasId: 'atlas-engineering-v3',
      notes: [{ ...demo.notes[0], area: 'Systems', areas: ['Systems'], declaredAreas: [' 系统 '] }],
    })
    const file = new File([serializeProjectBundle(source)], 'taxonomy.terrain.json', { type: 'application/json' })

    const restored = await parseProjectBundle(file)

    expect(restored.taxonomyVersion).toBe(3)
    expect(restored.taxonomyNodes).toEqual([root, child])
    expect(restored.referenceAtlases).toEqual(source.referenceAtlases)
    expect(restored.activeReferenceAtlasId).toBe('atlas-engineering-v3')
    expect(restored.notes[0]?.declaredAreas).toEqual([' 系统 '])
  })

  it('preserves an immutable reference-atlas taxonomy snapshot in project bundles', async () => {
    const demo = createDemoProject()
    const source = migrateProject(demo)

    const restored = await parseProjectBundle(new File(
      [serializeProjectBundle(source)],
      'atlas-snapshot.terrain.json',
      { type: 'application/json' },
    ))

    expect(restored.referenceAtlases?.[0]?.taxonomySnapshot).toEqual(source.referenceAtlases?.[0]?.taxonomySnapshot)
  })

  it('migrates a legacy atlas without inventing a snapshot and disables it after a taxonomy change', async () => {
    const demo = createDemoProject()
    const legacy = {
      ...demo,
      taxonomyVersion: 2,
      taxonomyNodes: (demo.taxonomyNodes ?? []).map((node) => ({ ...node, version: 2 })),
      referenceAtlases: (demo.referenceAtlases ?? []).map((atlas) => ({
        ...atlas,
        taxonomyVersion: 1,
        taxonomySnapshot: undefined,
      })),
      activeReferenceAtlasId: demo.referenceAtlases?.[0]?.id,
    }

    const restored = await parseProjectBundle(new File(
      [serializeProjectBundle(legacy)],
      'legacy-atlas.terrain.json',
      { type: 'application/json' },
    ))

    expect(restored.referenceAtlases?.[0]?.taxonomySnapshot).toBeUndefined()
    expect(restored.referenceAtlases?.[0]?.taxonomyVersion).toBe(1)
    expect(buildProjectReferenceGapReport(
      restored,
      restored.activeReferenceAtlasId ?? '',
      '2026-08-21T00:00:00.000Z',
    )).toMatchObject({ enabled: false, reason: 'atlas-rebind-required' })
  })

  it('clears a dangling active reference atlas during materialization and bundle migration', async () => {
    const demo = createDemoProject()
    const root = createTaxonomyNode({
      workspaceId: demo.id,
      label: 'Engineering',
      version: 1,
    }, demo.updatedAt)
    const project = {
      ...demo,
      taxonomyNodes: [root],
      taxonomyVersion: 1,
      referenceAtlases: [{
        id: 'atlas-engineering-v1',
        workspaceId: demo.id,
        label: 'Engineering reference',
        taxonomyVersion: 1,
        taxonomyNodeIds: [root.id],
        createdAt: demo.updatedAt,
        updatedAt: demo.updatedAt,
      }],
      activeReferenceAtlasId: 'atlas-missing',
    }

    const { bundle } = migrateTerrainProjectToV3(project)
    const file = new File([serializeProjectBundle(project)], 'dangling-atlas.terrain.json', {
      type: 'application/json',
    })
    const restored = await parseProjectBundle(file)

    expect(bundle.workspace.activeReferenceAtlasId).toBeUndefined()
    expect(restored.referenceAtlases).toEqual(project.referenceAtlases)
    expect(restored.referenceAtlases?.[0]?.taxonomySnapshot).toBeUndefined()
    expect(restored.activeReferenceAtlasId).toBeUndefined()
  })

  it('round-trips exploration lifecycle state and removes dangling supporting note ids', async () => {
    const demo = createDemoProject()
    const lifecycle: ExplorationLifecycleItem = {
      id: 'explore-linear-algebra',
      suggestion: {
        id: 'suggestion-linear-algebra',
        reason: { code: 'unassessed-note', detail: '该笔记尚未完成自评' },
        supportingItemIds: [demo.notes[0].id, 'deleted-note'],
        sourceRoute: { kind: 'note', noteId: 'deleted-note' },
        evidenceFingerprint: 'evidence-v1',
        priority: 0.8,
        action: { title: '补充熟练度自评', detail: '回到原笔记记录当前掌握程度' },
      },
      status: 'snoozed',
      action: { title: '补充熟练度自评', detail: '回到原笔记记录当前掌握程度' },
      userNotes: '周末处理',
      snoozedUntil: '2026-08-22T00:00:00.000Z',
      updatedAt: demo.updatedAt,
      history: [{
        id: 'explore-event-1',
        type: 'snooze',
        occurredAt: demo.updatedAt,
        fromStatus: 'accepted',
        toStatus: 'snoozed',
        evidenceFingerprint: 'evidence-v1',
        note: '等待周末',
      }],
    }
    const source = migrateProject({ ...demo, explorationItems: [lifecycle] })
    const file = new File([serializeProjectBundle(source)], 'exploration.terrain.json', {
      type: 'application/json',
    })

    const restored = await parseProjectBundle(file)

    expect(restored.explorationItems).toHaveLength(1)
    expect(restored.explorationItems?.[0]).toMatchObject({
      status: 'snoozed',
      userNotes: '周末处理',
      suggestion: {
        supportingItemIds: [demo.notes[0].id],
        sourceRoute: { kind: 'unavailable', originalKind: 'note' },
      },
      history: [expect.objectContaining({ type: 'snooze', toStatus: 'snoozed' })],
    })
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
