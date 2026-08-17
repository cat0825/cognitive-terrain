import { describe, expect, it } from 'vitest'
import { ACTIVITY_ELEVATION_FORMULA_VERSION } from '../../src/domain/activity-elevation'
import { buildPlateCollisions } from '../../src/domain/knowledge-plates'
import { buildReferenceGapReport, REFERENCE_GAP_FORMULA_VERSION } from '../../src/domain/reference-gaps'
import {
  COLLISION_EVIDENCE_FORMULA_VERSION,
  NOTE_NEIGHBOR_EVIDENCE_FORMULA_VERSION,
  PEAK_DENSITY_FORMULA_VERSION,
  TERRAIN_EVIDENCE_SCHEMA_VERSION,
  buildCollisionEvidence,
  buildGapEvidence,
  buildNoteNeighborEvidence,
  buildPeakEvidence,
  buildTerrainSemanticsLegend,
} from '../../src/domain/terrain-evidence'
import type { TerrainNote, TerrainProject } from '../../src/domain/types'

const evaluatedAt = '2026-08-17T08:00:00.000Z'

describe('terrain evidence contract', () => {
  it('defines all eight visual semantics with active formulas and boundaries', () => {
    const project = projectFixture()
    const legend = buildTerrainSemanticsLegend(project, { evaluatedAt })

    expect(legend.entries.map((entry) => entry.kind)).toEqual([
      'planar-position',
      'peak',
      'elevation',
      'color',
      'overlay',
      'plate',
      'collision',
      'gap',
    ])
    expect(legend.entries.find((entry) => entry.kind === 'planar-position')).toMatchObject({
      provenance: ['embedding-model', 'umap-projection'],
      limitation: expect.stringContaining('不证明显式关系'),
    })
    expect(legend.entries.find((entry) => entry.kind === 'elevation')).toMatchObject({
      formulaVersion: 'mastery-density-v1',
      active: true,
    })
    expect(legend.entries.find((entry) => entry.kind === 'gap')).toMatchObject({
      formulaVersion: REFERENCE_GAP_FORMULA_VERSION,
      supportingIds: ['atlas-math'],
      active: true,
    })
    expect(JSON.parse(JSON.stringify(legend))).toEqual(legend)
  })

  it('describes the effective temperature encoding instead of the stored density profile color', () => {
    const legend = buildTerrainSemanticsLegend(projectFixture(), {
      visualDimension: 'temperature',
      evaluatedAt,
    })

    expect(legend.activeProfileId).toBe('density')
    expect(legend.entries.find((entry) => entry.kind === 'elevation')).toMatchObject({
      formulaVersion: 'density-kde-v1',
    })
    expect(legend.entries.find((entry) => entry.kind === 'color')).toMatchObject({
      formulaVersion: 'activity-temperature-v1',
      provenance: ['raw-event', 'retained-aggregate'],
    })
  })

  it('keeps original embedding score, approximate UMAP distance, taxonomy, tags and WikiLink separate', () => {
    const project = projectFixture()
    const evidence = buildNoteNeighborEvidence(project, 'a', 'b', {
      embeddingScore: 0.91,
      embeddingScoreKind: 'similarity',
      modelId: 'semantic-test-model',
      evaluatedAt,
    })

    expect(evidence).toMatchObject({
      schemaVersion: TERRAIN_EVIDENCE_SCHEMA_VERSION,
      formulaVersion: NOTE_NEIGHBOR_EVIDENCE_FORMULA_VERSION,
      storedNeighborRank: 1,
      embedding: {
        mode: 'semantic',
        modelId: 'semantic-test-model',
        score: 0.91,
        scoreKind: 'similarity',
        semanticEvidence: true,
      },
      projection: { algorithm: 'UMAP', approximate: true },
      taxonomy: { sharedNodeIds: ['taxonomy-math'], sharedLabels: ['math'] },
      tags: { sharedTags: ['linear'] },
      wikiLink: { explicit: true },
    })
    expect(evidence?.projection.distance).toBeCloseTo(Math.hypot(0.3, 0.4))
    expect(evidence?.wikiLink.links).toEqual([
      expect.objectContaining({ fromItemId: 'a', toItemId: 'b', declaredTarget: 'Beta' }),
    ])
  })

  it('does not invent semantic or WikiLink evidence from fallback proximity', () => {
    const project = projectFixture()
    project.embeddingMode = 'fallback'
    project.notes = project.notes.map((item) => ({ ...item, links: [] }))

    const evidence = buildNoteNeighborEvidence(project, 'a', 'b')

    expect(evidence).toMatchObject({
      embedding: {
        mode: 'fallback',
        score: null,
        scoreKind: 'unavailable',
        semanticEvidence: false,
        limitation: expect.stringContaining('不是语义 embedding'),
      },
      wikiLink: { explicit: false, links: [] },
    })
    expect(evidence?.provenance).not.toContain('explicit-wikilink')
  })

  it('prefers persisted high-dimensional neighbor evidence over projected distance', () => {
    const project = projectFixture()
    project.noteNeighborEvidence = [[{
      sourceId: 'a',
      targetId: 'b',
      rank: 1,
      score: 0.87,
      modelId: 'persisted-embedding-model',
      embeddingMode: 'semantic',
      formulaVersion: 'embedding-cosine-neighbors-v1',
      provenance: 'embedding',
    }], []]

    const evidence = buildNoteNeighborEvidence(project, 'a', 'b')

    expect(evidence?.embedding).toMatchObject({
      modelId: 'persisted-embedding-model',
      formulaVersion: 'embedding-cosine-neighbors-v1',
      scoreSource: 'stored-embedding-evidence',
      score: 0.87,
      semanticEvidence: true,
    })
    expect(evidence?.projection.distance).toBeCloseTo(0.5)
  })

  it('explains peak membership, label source, local density and missing active-height inputs', () => {
    const evidence = buildPeakEvidence(projectFixture(), 'peak-1')

    expect(evidence).toMatchObject({
      formulaVersion: 'peak-local-maximum-v1',
      memberItemIds: ['a', 'b'],
      missingMemberItemIds: ['deleted-note'],
      labelEvidence: {
        source: 'dominant-tag',
        label: 'linear',
        supportingItemIds: ['a', 'b'],
        tagCount: 2,
      },
      localDensity: {
        formulaVersion: PEAK_DENSITY_FORMULA_VERSION,
        basis: 'stored-peak-membership',
      },
      activeHeight: {
        profileId: 'mastery',
        elevation: 'mastery',
        formulaVersion: 'mastery-density-v1',
        inputs: [
          expect.objectContaining({ itemId: 'a', value: 0.8, confidence: 0.7, missing: false }),
          expect.objectContaining({ itemId: 'b', value: null, confidence: null, missing: true }),
        ],
      },
    })
    expect(evidence?.localDensity.contributions.map((entry) => entry.itemId)).toEqual(['a', 'b'])
  })

  it('attaches an evaluation timestamp and activity provenance when activity drives peak height', () => {
    const project = projectFixture()
    project.activeTerrainProfileId = 'activity'
    const evidence = buildPeakEvidence(project, 'peak-1', { evaluatedAt })

    expect(evidence).toMatchObject({
      evaluatedAt,
      activeHeight: {
        formulaVersion: ACTIVITY_ELEVATION_FORMULA_VERSION,
        inputs: expect.arrayContaining([
          expect.objectContaining({
            itemId: 'a',
            missing: false,
            provenance: ['raw-event'],
            supportingIds: ['opened-a'],
          }),
        ]),
      },
    })
  })

  it('traces collisions only to concrete WikiLinks while keeping projection and tags separate', () => {
    const project = projectFixture()
    project.notes[1] = { ...project.notes[1], area: 'Physics', areas: ['Physics'] }
    const collision = buildPlateCollisions(project.notes)[0]
    const evidence = buildCollisionEvidence(collision, evaluatedAt)

    expect(evidence).toMatchObject({
      formulaVersion: COLLISION_EVIDENCE_FORMULA_VERSION,
      collisionId: collision.id,
      provenance: ['declared-taxonomy', 'explicit-wikilink', 'umap-projection'],
      summary: {
        relationCount: 1,
        mode: 'lines',
      },
      wikiLinks: [expect.objectContaining({ bridgeId: 'bridge-a-b', fromItemId: 'a', toItemId: 'b' })],
      projection: [expect.objectContaining({ bridgeId: 'bridge-a-b', approximate: true })],
      tags: [{ bridgeId: 'bridge-a-b', sharedTags: ['linear'] }],
    })
    expect(evidence.wikiLinks[0]).not.toHaveProperty('distance')
  })

  it('traces a gap to its selected reference boundary and supporting items', () => {
    const report = buildReferenceGapReport({
      id: 'atlas-math',
      label: 'Math reference',
      taxonomyVersion: 1,
      nodes: [{ id: 'taxonomy-math', label: 'Math' }],
    }, [{
      itemId: 'a',
      taxonomyNodeIds: ['taxonomy-math'],
      lastActivityAt: '2026-01-01T00:00:00.000Z',
    }], { evaluatedAt })

    const evidence = buildGapEvidence(report, 'taxonomy-math')

    expect(evidence).toMatchObject({
      formulaVersion: REFERENCE_GAP_FORMULA_VERSION,
      evaluatedAt,
      enabled: true,
      referenceAtlasId: 'atlas-math',
      provenance: ['reference-atlas', 'declared-taxonomy', 'activity-history'],
      node: {
        id: 'taxonomy-math',
        state: 'stale',
        supportingItemIds: ['a'],
      },
      relativeToSelectedReference: true,
      limitation: expect.stringContaining('不代表用户能力'),
    })
    expect(evidence.supportingIds).toEqual(['a', 'atlas-math', 'taxonomy-math'])
    expect(buildGapEvidence(buildReferenceGapReport(undefined, [], { evaluatedAt }), 'missing')).toMatchObject({
      enabled: false,
      reason: 'no-reference-atlas',
      supportingIds: [],
    })
  })

  it('is deterministic and JSON-serializable for identical inputs', () => {
    const project = projectFixture()
    const first = buildNoteNeighborEvidence(project, 'a', 'b', { embeddingScore: 0.5, evaluatedAt })
    const second = buildNoteNeighborEvidence(project, 'a', 'b', { embeddingScore: 0.5, evaluatedAt })

    expect(second).toEqual(first)
    expect(JSON.parse(JSON.stringify(first))).toEqual(first)
  })
})

function note(id: string, title: string, patch: Partial<TerrainNote> = {}): TerrainNote {
  return {
    id,
    fingerprint: id,
    title,
    content: title,
    createdAt: '2026-08-01T00:00:00.000Z',
    createdAtMs: Date.parse('2026-08-01T00:00:00.000Z'),
    tags: ['linear'],
    weight: 1,
    area: 'Math',
    areas: ['Math'],
    links: [],
    x: 0,
    y: 0,
    ...patch,
  }
}

function projectFixture(): TerrainProject {
  const notes = [
    note('a', 'Alpha', {
      links: ['Beta'],
      mastery: 0.8,
      confidence: 0.7,
      cognitiveStateProvenance: 'yaml',
    }),
    note('b', 'Beta', { x: 0.3, y: 0.4, mastery: undefined, confidence: undefined }),
  ]
  return {
    schemaVersion: 3,
    id: 'terrain-evidence-project',
    name: 'Terrain evidence',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: evaluatedAt,
    timeZone: 'UTC',
    modelId: 'semantic-model-v1',
    embeddingMode: 'semantic',
    sourceDigest: 'digest',
    gridSize: 64,
    notes,
    snapshots: [],
    peaks: [{
      id: 'peak-1',
      x: 0.1,
      y: 0.1,
      height: 0.82,
      label: 'linear',
      noteIds: ['a', 'b', 'deleted-note'],
    }],
    noteNeighbors: [['b'], ['a']],
    cognitiveStates: [{
      itemId: 'a',
      mastery: 0.8,
      confidence: 0.7,
      updatedAt: evaluatedAt,
      provenance: 'yaml',
    }],
    interactionEvents: [{
      id: 'opened-a',
      itemId: 'a',
      type: 'opened',
      occurredAt: '2026-08-17T07:00:00.000Z',
    }],
    terrainProfiles: [{
      id: 'mastery',
      label: 'Mastery',
      elevation: 'mastery',
      color: 'area',
      overlay: 'confidence',
      formulaVersion: 'mastery-density-v1',
    }, {
      id: 'activity',
      label: 'Activity',
      elevation: 'activity',
      color: 'area',
      overlay: 'temperature',
      formulaVersion: ACTIVITY_ELEVATION_FORMULA_VERSION,
    }],
    activeTerrainProfileId: 'mastery',
    taxonomyNodes: [{
      id: 'taxonomy-math',
      workspaceId: 'terrain-evidence-project',
      label: 'Mathematics',
      aliases: ['Math'],
      version: 1,
      status: 'active',
      createdAt: evaluatedAt,
      updatedAt: evaluatedAt,
    }],
    taxonomyVersion: 1,
    referenceAtlases: [{
      id: 'atlas-math',
      workspaceId: 'terrain-evidence-project',
      label: 'Math reference',
      taxonomyVersion: 1,
      taxonomyNodeIds: ['taxonomy-math'],
      createdAt: evaluatedAt,
      updatedAt: evaluatedAt,
    }],
    activeReferenceAtlasId: 'atlas-math',
  }
}
