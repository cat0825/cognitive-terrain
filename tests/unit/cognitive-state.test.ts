import { describe, expect, it } from 'vitest'
import { buildActivitySummaries, shouldRecordOpenedEvent, temperatureColor } from '../../src/domain/activity-temperature'
import { commitAnalyzedProject, createInteractionEvent, eventTypeForNoteUpdate } from '../../src/domain/cognitive-state'
import { createExplorationItem } from '../../src/domain/exploration-lifecycle'
import { generateExplorationSuggestions } from '../../src/domain/exploration-loop'
import type { TerrainProject } from '../../src/domain/types'

describe('cognitive state events', () => {
  it('commits a reanalysis without changing project identity or losing event history', () => {
    const base = createProjectFixture('stable-project-id')
    base.activeTerrainProfileId = 'mastery'
    const referenceAtlas = {
      id: 'atlas-engineering-v1',
      workspaceId: base.id,
      label: 'Engineering reference',
      taxonomyVersion: 1,
      taxonomyNodeIds: ['taxonomy:engineering'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    base.referenceAtlases = [referenceAtlas]
    base.activeReferenceAtlasId = referenceAtlas.id
    const previous = createInteractionEvent('note-a', 'opened', '2026-08-14T01:00:00.000Z')
    base.interactionEvents = [previous]
    base.explorationItems = [createExplorationItem(generateExplorationSuggestions({
      userMarkedGoals: [{ goalId: 'goal-a', label: 'Review the proof' }],
    })[0]!, '2026-08-14T01:30:00.000Z')]
    const analyzed = createProjectFixture('new-analysis-id')
    analyzed.noteNeighborEvidence = [[{
      sourceId: 'note-a',
      targetId: 'note-b',
      rank: 1,
      score: 0.91,
      modelId: 'test-model',
      embeddingMode: 'fallback',
      formulaVersion: 'embedding-cosine-neighbors-v1',
      provenance: 'embedding',
    }]]
    const edited = createInteractionEvent('note-a', 'edited', '2026-08-14T02:00:00.000Z', {
      changedFields: ['content'],
    })

    const committed = commitAnalyzedProject(analyzed, base, [edited])

    expect(committed.id).toBe('stable-project-id')
    expect(committed.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(committed.updatedAt).toBe('2026-08-14T02:00:00.000Z')
    expect(committed.activeTerrainProfileId).toBe('mastery')
    expect(committed.interactionEvents).toEqual([previous, edited])
    expect(committed.referenceAtlases).toEqual([referenceAtlas])
    expect(committed.activeReferenceAtlasId).toBe(referenceAtlas.id)
    expect(committed.explorationItems).toEqual(base.explorationItems)
    expect(committed.noteNeighborEvidence).toEqual(analyzed.noteNeighborEvidence)
  })

  it('clears a dangling active reference atlas during reanalysis', () => {
    const base = createProjectFixture('stable-project-id')
    base.referenceAtlases = [{
      id: 'atlas-engineering-v1',
      workspaceId: base.id,
      label: 'Engineering reference',
      taxonomyVersion: 1,
      taxonomyNodeIds: ['taxonomy:engineering'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }]
    base.activeReferenceAtlasId = 'atlas-missing'

    const committed = commitAnalyzedProject(createProjectFixture('new-analysis-id'), base)

    expect(committed.referenceAtlases).toEqual(base.referenceAtlases)
    expect(committed.activeReferenceAtlasId).toBeUndefined()
  })

  it('keeps cognitive-state evidence time stable unless the evidence changes', () => {
    const base = createProjectFixture('stable-project-id')
    base.cognitiveStates = [{
      itemId: 'unchanged',
      mastery: 0.4,
      status: 'gap',
      provenance: 'yaml',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }, {
      itemId: 'changed',
      confidence: 0.3,
      provenance: 'yaml',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }]
    const analyzed = createProjectFixture('new-analysis-id')
    analyzed.cognitiveStates = [{
      ...base.cognitiveStates[0],
      updatedAt: '2026-08-18T00:00:00.000Z',
    }, {
      ...base.cognitiveStates[1],
      confidence: 0.7,
      updatedAt: '2026-08-18T00:00:00.000Z',
    }]

    const committed = commitAnalyzedProject(analyzed, base)

    expect(committed.cognitiveStates).toEqual([
      base.cognitiveStates[0],
      analyzed.cognitiveStates[1],
    ])
  })

  it('derives temperature from weighted recent opens, edits, and reviews', () => {
    const now = Date.parse('2026-08-15T00:00:00.000Z')
    const notes = [{ id: 'hot' }, { id: 'cold' }]
    const events = [
      createInteractionEvent('hot', 'opened', '2026-08-15T00:00:00.000Z'),
      createInteractionEvent('hot', 'edited', '2026-08-14T00:00:00.000Z'),
      createInteractionEvent('cold', 'opened', '2026-07-18T00:00:00.000Z'),
      createInteractionEvent('cold', 'classified', '2026-08-15T00:00:00.000Z'),
    ]

    const summaries = buildActivitySummaries(notes, events, now)

    expect(summaries.get('hot')).toMatchObject({ totalCount: 2, openedCount: 1, editedCount: 1, reviewedCount: 0 })
    expect(summaries.get('hot')!.score).toBeGreaterThan(summaries.get('cold')!.score)
    expect(summaries.get('cold')).toMatchObject({ totalCount: 1, openedCount: 1 })
    expect(temperatureColor(0)).toBe('rgb(93,105,113)')
    expect(temperatureColor(1)).toBe('rgb(228,111,81)')
  })

  it('deduplicates repeated opens within one minute', () => {
    const previous = createInteractionEvent('note-a', 'opened', '2026-08-15T00:00:00.000Z')

    expect(shouldRecordOpenedEvent([previous], 'note-a', '2026-08-15T00:00:30.000Z')).toBe(false)
    expect(shouldRecordOpenedEvent([previous], 'note-a', '2026-08-15T00:01:00.000Z')).toBe(true)
    expect(shouldRecordOpenedEvent([previous], 'note-b', '2026-08-15T00:00:30.000Z')).toBe(true)
  })

  it('reserves reviewed events for the explicit review action', () => {
    expect(eventTypeForNoteUpdate(['mastery'])).toBe('edited')
    expect(eventTypeForNoteUpdate(['status', 'confidence'])).toBe('edited')
    expect(eventTypeForNoteUpdate(['areas'])).toBe('classified')
  })
})

function createProjectFixture(id: string): TerrainProject {
  return {
    schemaVersion: 3,
    id,
    name: 'Test project',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    timeZone: 'UTC',
    modelId: 'test-model',
    embeddingMode: 'fallback',
    sourceDigest: 'test-digest',
    gridSize: 2,
    notes: [],
    snapshots: [],
    peaks: [],
    noteNeighbors: [],
    cognitiveStates: [],
    interactionEvents: [],
    terrainProfiles: [
      {
        id: 'density',
        label: 'Density',
        elevation: 'density',
        color: 'area',
        formulaVersion: 'test-v1',
      },
      {
        id: 'mastery',
        label: 'Mastery',
        elevation: 'mastery',
        color: 'area',
        formulaVersion: 'test-v1',
      },
    ],
    activeTerrainProfileId: 'density',
  }
}
