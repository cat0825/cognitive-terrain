import { describe, expect, it } from 'vitest'
import { createDemoProject, createProjectFromNotes } from '../../src/domain/demo'
import {
  DENSITY_FORMULA_VERSION,
  projectVersionTuple,
  rebuildProjectDerivedData,
  refreshDerivedRecord,
  sameVersionTuple,
} from '../../src/domain/derived-data'
import { migrateProject } from '../../src/storage/db'
import { migrateTerrainProjectToV3 } from '../../src/domain/schema-v3'
import type { TerrainNote, TerrainProject } from '../../src/domain/types'

function note(id: string, overrides: Partial<TerrainNote> = {}): TerrainNote {
  const createdAt = overrides.createdAt ?? '2026-03-04T02:00:00.000Z'
  return {
    id,
    fingerprint: id,
    title: id,
    content: `${id} content`,
    createdAt,
    createdAtMs: Date.parse(createdAt),
    tags: ['tag'],
    weight: 1,
    links: [],
    x: 0.1,
    y: -0.2,
    ...overrides,
  }
}

const analyzed = createProjectFromNotes(
  'Derived data',
  [
    note('note-a'),
    note('note-b', { x: -0.4, y: 0.3, createdAt: '2026-04-11T02:00:00.000Z' }),
    note('note-c', { x: 0.5, y: 0.5, createdAt: '2026-05-19T02:00:00.000Z' }),
  ],
  'deterministic-local-fallback',
)

describe('project version tuple', () => {
  it('records every input that changes what derived data means', () => {
    const tuple = projectVersionTuple(migrateProject(analyzed))

    expect(tuple).toMatchObject({
      tupleVersion: 1,
      densityFormulaVersion: DENSITY_FORMULA_VERSION,
      layoutFormulaVersion: 'umap-js-2d-v1',
      neighborFormulaVersion: 'embedding-cosine-neighbors-v1',
      prerequisiteFormulaVersion: 'explicit-prerequisite-dag-v1',
      embeddingModelId: 'deterministic-local-fallback',
      embeddingMode: 'fallback',
      referenceAtlasVersion: null,
    })
  })

  it('follows the bound atlas rather than the newest taxonomy version', () => {
    const demo = migrateProject(createDemoProject())
    const atlas = demo.referenceAtlases![0]
    const bound: TerrainProject = { ...demo, activeReferenceAtlasId: atlas.id }
    const renamedTaxonomy: TerrainProject = {
      ...bound,
      taxonomyVersion: 2,
      taxonomyNodes: bound.taxonomyNodes!.map((node) => ({ ...node, version: 2 })),
    }

    expect(projectVersionTuple(bound).referenceAtlasVersion).toBe(atlas.taxonomyVersion)
    expect(projectVersionTuple(renamedTaxonomy).referenceAtlasVersion).toBe(atlas.taxonomyVersion)
    // A taxonomy change alone must invalidate derived comparisons: the same gap
    // report means something different once labels move.
    expect(sameVersionTuple(
      projectVersionTuple(bound),
      projectVersionTuple(renamedTaxonomy),
    )).toBe(false)
  })

  it('refreshes the tuple on migration while keeping recorded terrain parameters', () => {
    const migrated = migrateProject({ ...analyzed, taxonomyVersion: 3 })

    expect(migrated.derived?.versionTuple.taxonomyVersion).toBe(3)
    expect(migrated.derived?.terrain).toEqual(analyzed.derived?.terrain)
  })
})

describe('derived rebuild equivalence', () => {
  it('reproduces snapshots, peaks, and topology from core data and the tuple', () => {
    const stored = migrateProject(analyzed)
    const result = rebuildProjectDerivedData(stored)

    expect(result.status).toBe('rebuilt')
    expect(result.mismatches).toEqual([])
    expect(result.project.snapshots.map((snapshot) => snapshot.bucket))
      .toEqual(stored.snapshots.map((snapshot) => snapshot.bucket))
    expect(result.project.peaks).toEqual(stored.peaks)
    for (const [index, snapshot] of result.project.snapshots.entries()) {
      expect(Array.from(snapshot.values)).toEqual(Array.from(stored.snapshots[index].values))
    }
  })

  it('reports drift instead of trusting a tampered snapshot', () => {
    const stored = migrateProject(analyzed)
    const tampered: TerrainProject = {
      ...stored,
      snapshots: stored.snapshots.map((snapshot, index) => index === 0
        ? { ...snapshot, values: snapshot.values.map((value) => value * 0.25) as Float32Array }
        : snapshot),
    }

    const result = rebuildProjectDerivedData(tampered)

    expect(result.status).toBe('rebuilt')
    expect(result.mismatches).toContain('snapshots')
    // The rebuilt values win: keeping the tampered snapshot would leave the
    // terrain showing heights its own notes cannot produce.
    expect(Array.from(result.project.snapshots[0].values))
      .toEqual(Array.from(stored.snapshots[0].values))
  })

  it('keeps authored demo peaks instead of replacing them with detected ones', () => {
    const demo = migrateProject(createDemoProject())
    const result = rebuildProjectDerivedData(demo)

    expect(demo.derived?.terrain?.peaks).toBe('authored')
    expect(result.mismatches).not.toContain('peaks')
    expect(result.project.peaks).toEqual(demo.peaks)
  })

  it('keeps derived data cached when the project has no terrain parameters', () => {
    const legacy = { ...migrateProject(analyzed) }
    legacy.derived = { versionTuple: projectVersionTuple(legacy), terrain: null }

    const result = rebuildProjectDerivedData(legacy)

    expect(result.status).toBe('cached')
    expect(result.reason).toContain('bandwidth')
    expect(result.project.snapshots).toEqual(legacy.snapshots)
  })

  it('rebuilds the prerequisite topology from declarations rather than trusting it', () => {
    const stored = migrateProject(analyzed)
    const tampered: TerrainProject = {
      ...stored,
      prerequisiteTopology: {
        version: 1,
        formulaVersion: 'explicit-prerequisite-dag-v1',
        relations: [],
        diagnostics: [],
        assignments: [{
          itemId: 'note-a',
          status: 'derived',
          depth: 4,
          branchRootIds: ['note-a'],
          relationIds: [],
          sourceNoteIds: [],
        }],
      },
    }

    const result = rebuildProjectDerivedData(tampered)

    expect(result.mismatches).toContain('prerequisiteTopology')
    expect(result.project.prerequisiteTopology?.assignments).toEqual(
      stored.prerequisiteTopology?.assignments,
    )
  })
})

describe('derived record propagation', () => {
  it('carries the derived record into the materialized workspace', () => {
    const stored = migrateProject(analyzed)
    const { bundle } = migrateTerrainProjectToV3(stored)

    expect(bundle.workspace.derived).toEqual(refreshDerivedRecord(stored))
    expect(bundle.workspace.derived?.terrain?.formulaVersion).toBe(DENSITY_FORMULA_VERSION)
  })

  it('buckets the terrain in the project time zone so a rebuild agrees', () => {
    const utcNotes = [
      note('boundary-a', { createdAt: '2026-03-31T20:00:00.000Z' }),
      note('boundary-b', { createdAt: '2026-04-30T20:00:00.000Z', x: -0.3, y: 0.4 }),
    ]
    const project = createProjectFromNotes('Zoned', utcNotes, 'deterministic-local-fallback', undefined, 'UTC')

    expect(project.timeZone).toBe('UTC')
    expect(project.derived?.terrain?.timeZone).toBe('UTC')
    expect(project.snapshots.map((snapshot) => snapshot.bucket)).toEqual(['2026-03', '2026-04'])
    expect(rebuildProjectDerivedData(migrateProject(project)).mismatches).toEqual([])
  })
})
