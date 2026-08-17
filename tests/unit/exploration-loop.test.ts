import { describe, expect, it } from 'vitest'
import {
  MAX_EXPLORATION_SUGGESTION_LIMIT,
  buildProjectExplorationSignals,
  generateExplorationSuggestions,
  generateProjectExplorationSuggestions,
  type ExplorationSignals,
} from '../../src/domain/exploration-loop'
import {
  createExplorationItem,
  reduceExplorationLifecycle,
  reopenExplorationItem,
} from '../../src/domain/exploration-lifecycle'
import type { TerrainNote, TerrainProject } from '../../src/domain/types'

const at = '2026-08-17T08:00:00.000Z'

describe('exploration suggestion generation', () => {
  it('is deterministic, bounded, traceable, and independent of input order', () => {
    const signals = allSignals()
    const reversed: ExplorationSignals = {
      ...signals,
      selectedReference: signals.selectedReference
        ? { ...signals.selectedReference, gaps: [...signals.selectedReference.gaps].reverse() }
        : undefined,
      staleReviewedItems: [...(signals.staleReviewedItems ?? [])].reverse(),
      unresolvedBridges: [...(signals.unresolvedBridges ?? [])].reverse(),
      noteAssessments: [...(signals.noteAssessments ?? [])].reverse(),
      userMarkedGoals: [...(signals.userMarkedGoals ?? [])].reverse(),
    }

    const first = generateExplorationSuggestions(signals, { limit: 99 })
    const second = generateExplorationSuggestions(reversed, { limit: 99 })

    expect(first).toEqual(second)
    expect(first).toHaveLength(7)
    expect(first.length).toBeLessThanOrEqual(MAX_EXPLORATION_SUGGESTION_LIMIT)
    expect(first.map((suggestion) => suggestion.reason.code)).toEqual([
      'user-marked-goal',
      'reference-gap',
      'reference-gap',
      'unresolved-bridge',
      'unassessed-note',
      'low-confidence-note',
      'stale-reviewed-item',
    ])
    for (const suggestion of first) {
      expect(suggestion.evidenceFingerprint).toMatch(/^evidence-[0-9a-f]{8}$/)
      expect(Array.isArray(suggestion.supportingItemIds)).toBe(true)
      expect(suggestion.sourceRoute.kind).toMatch(/^(note|relationship|reference-node|goal)$/)
    }
  })

  it('does not generate a suggestion from activity score alone', () => {
    const activityOnly = { activityScore: 1, temperature: 1 } as unknown as ExplorationSignals
    expect(generateExplorationSuggestions(activityOnly)).toEqual([])
    expect(generateExplorationSuggestions({})).toEqual([])
  })

  it('requires an explicitly selected reference before generating gap actions', () => {
    const { selectedReference: _, ...withoutReference } = allSignals()
    expect(generateExplorationSuggestions(withoutReference).some((item) => item.reason.code === 'reference-gap')).toBe(false)
  })

  it('deduplicates stable suggestion identities and enforces caller limits', () => {
    const note = { noteId: 'n-1', title: 'One' }
    const suggestions = generateExplorationSuggestions({ noteAssessments: [note, note] }, { limit: 1 })
    expect(suggestions).toHaveLength(1)
    expect(() => generateExplorationSuggestions({}, { limit: -1 })).toThrow(/limit/)
    expect(() => generateExplorationSuggestions({}, { lowConfidenceThreshold: 1.1 })).toThrow(/lowConfidenceThreshold/)
  })

  it('suppresses unchanged completed/rejected evidence and visibly reopens fresh evidence', () => {
    const originalSignals: ExplorationSignals = {
      noteAssessments: [{ noteId: 'n-1', title: 'One', mastery: 0.6, confidence: 0.2, noteFingerprint: 'v1' }],
    }
    const original = generateExplorationSuggestions(originalSignals)[0]!
    let completed = createExplorationItem(original, at)
    completed = reduceExplorationLifecycle(completed, { type: 'accept', occurredAt: '2026-08-17T08:01:00.000Z' })
    completed = reduceExplorationLifecycle(completed, { type: 'complete', occurredAt: '2026-08-17T08:02:00.000Z' })

    expect(generateExplorationSuggestions(originalSignals, { previousItems: [completed] })).toEqual([])

    const fresh = generateExplorationSuggestions({
      noteAssessments: [{ noteId: 'n-1', title: 'One', mastery: 0.6, confidence: 0.15, noteFingerprint: 'v2' }],
    }, { previousItems: [completed] })[0]!
    expect(fresh.id).toBe(original.id)
    expect(fresh.evidenceFingerprint).not.toBe(original.evidenceFingerprint)
    expect(fresh.reopenReason).toMatchObject({
      code: 'fresh-evidence-after-completed',
      previousEvidenceFingerprint: original.evidenceFingerprint,
    })
    expect(fresh.previousDecision).toMatchObject({ status: 'completed' })
    const reopened = reopenExplorationItem(completed, fresh, '2026-08-17T08:03:00.000Z')
    expect(reopened).toMatchObject({
      id: completed.id,
      status: 'proposed',
      updatedAt: '2026-08-17T08:03:00.000Z',
      lastExploredAt: completed.lastExploredAt,
      suggestion: { evidenceFingerprint: fresh.evidenceFingerprint },
    })
    expect(reopened.history).toEqual(completed.history)

    let rejected = createExplorationItem(original, at)
    rejected = reduceExplorationLifecycle(rejected, { type: 'reject', occurredAt: '2026-08-17T08:01:00.000Z' })
    expect(generateExplorationSuggestions(originalSignals, { previousItems: [rejected] })).toEqual([])
    expect(() => reopenExplorationItem(completed, original, '2026-08-17T08:03:00.000Z')).toThrow(/unchanged evidence/)
  })

  it('suppresses dismissed evidence until its evidence changes', () => {
    const originalSignals: ExplorationSignals = {
      userMarkedGoals: [{ goalId: 'goal-1', label: 'Read the source', updatedAt: '2026-08-17T08:00:00.000Z' }],
    }
    const original = generateExplorationSuggestions(originalSignals)[0]!
    const dismissed = reduceExplorationLifecycle(createExplorationItem(original, at), {
      type: 'dismiss',
      occurredAt: '2026-08-17T08:01:00.000Z',
    })
    expect(generateExplorationSuggestions(originalSignals, { previousItems: [dismissed] })).toEqual([])

    const fresh = generateExplorationSuggestions({
      userMarkedGoals: [{ goalId: 'goal-1', label: 'Read the revised source', updatedAt: '2026-08-18T08:00:00.000Z' }],
    }, { previousItems: [dismissed] })[0]!
    expect(fresh.reopenReason?.code).toBe('fresh-evidence-after-dismissed')
    expect(fresh.previousDecision?.status).toBe('dismissed')
  })

  it('derives deterministic project signals without turning activity or exploration into goals', () => {
    const project = projectFixture()
    const reversed = { ...project, notes: [...project.notes].reverse() }
    const signals = buildProjectExplorationSignals(project, at)

    expect(buildProjectExplorationSignals(reversed, at)).toEqual(signals)
    expect(signals.selectedReference).toMatchObject({ atlasId: 'atlas-1' })
    expect(signals.staleReviewedItems?.map((item) => item.noteId)).toEqual(['stale'])
    expect(signals.unresolvedBridges).toEqual([
      expect.objectContaining({ fromItemId: 'goal', targetTitle: 'Missing target' }),
    ])
    expect(signals.userMarkedGoals?.map((goal) => goal.noteId)).toEqual(['goal'])
    expect(signals.userMarkedGoals?.some((goal) => goal.noteId === 'exploration-only')).toBe(false)
    expect(generateProjectExplorationSuggestions(project, at).map((item) => item.reason.code)).toEqual([
      'user-marked-goal',
      'reference-gap',
      'reference-gap',
      'unresolved-bridge',
      'unassessed-note',
      'stale-reviewed-item',
    ])

    const noSignalsProject = {
      ...project,
      activeReferenceAtlasId: undefined,
      notes: [note('quiet', { mastery: 0.8, confidence: 0.8, exploration: 1, reviewedAt: at })],
      interactionEvents: [{ id: 'hot', itemId: 'quiet', type: 'opened' as const, occurredAt: at }],
    }
    expect(generateProjectExplorationSuggestions(noSignalsProject, at)).toEqual([])
  })
})

describe('exploration lifecycle reducer', () => {
  it('supports edit, accept, start, and complete without mutating prior states', () => {
    const suggestion = generateExplorationSuggestions({
      userMarkedGoals: [{ goalId: 'goal-1', label: 'Read the source' }],
    })[0]!
    const proposed = createExplorationItem(suggestion, at)
    const edited = reduceExplorationLifecycle(proposed, {
      type: 'edit',
      occurredAt: '2026-08-17T08:01:00.000Z',
      action: { title: 'Read chapter two', detail: 'Capture one unresolved question.' },
      userNotes: 'Start with the proof.',
    })
    const accepted = reduceExplorationLifecycle(edited, { type: 'accept', occurredAt: '2026-08-17T08:02:00.000Z' })
    const started = reduceExplorationLifecycle(accepted, { type: 'start', occurredAt: '2026-08-17T08:03:00.000Z' })
    const completed = reduceExplorationLifecycle(started, {
      type: 'complete',
      occurredAt: '2026-08-17T08:04:00.000Z',
      userNotes: 'The proof now checks out.',
    })

    expect(proposed).toMatchObject({ status: 'proposed', history: [] })
    expect(edited).toMatchObject({ status: 'proposed', action: { title: 'Read chapter two' }, userNotes: 'Start with the proof.' })
    expect(completed).toMatchObject({
      status: 'completed',
      lastExploredAt: '2026-08-17T08:04:00.000Z',
      userNotes: 'The proof now checks out.',
    })
    expect(completed.history.map((event) => event.type)).toEqual(['edit', 'accept', 'start', 'complete'])
    expect(new Set(completed.history.map((event) => event.id)).size).toBe(4)
  })

  it('supports snooze, dismiss, re-accept, and reject with strict transitions', () => {
    const suggestion = generateExplorationSuggestions({
      staleReviewedItems: [{ noteId: 'n-1', title: 'Old note', reviewedAt: '2026-01-01T00:00:00.000Z' }],
    })[0]!
    const proposed = createExplorationItem(suggestion, at)
    const snoozed = reduceExplorationLifecycle(proposed, {
      type: 'snooze',
      occurredAt: '2026-08-17T08:01:00.000Z',
      snoozedUntil: '2026-08-24T08:01:00.000Z',
    })
    const dismissed = reduceExplorationLifecycle(snoozed, { type: 'dismiss', occurredAt: '2026-08-17T08:02:00.000Z' })
    const accepted = reduceExplorationLifecycle(dismissed, { type: 'accept', occurredAt: '2026-08-17T08:03:00.000Z' })
    const rejected = reduceExplorationLifecycle(accepted, { type: 'reject', occurredAt: '2026-08-17T08:04:00.000Z' })

    expect(snoozed).toMatchObject({ status: 'snoozed', snoozedUntil: '2026-08-24T08:01:00.000Z' })
    expect(dismissed.snoozedUntil).toBeUndefined()
    expect(rejected.status).toBe('rejected')
    expect(() => reduceExplorationLifecycle(rejected, { type: 'accept', occurredAt: '2026-08-17T08:05:00.000Z' })).toThrow(/Cannot accept/)
    expect(() => reduceExplorationLifecycle(proposed, { type: 'start', occurredAt: '2026-08-17T08:01:00.000Z' })).toThrow(/Cannot start/)
    expect(() => reduceExplorationLifecycle(proposed, {
      type: 'snooze',
      occurredAt: '2026-08-17T08:01:00.000Z',
      snoozedUntil: '2026-08-17T08:00:00.000Z',
    })).toThrow(/snoozedUntil/)
  })
})

function allSignals(): ExplorationSignals {
  return {
    selectedReference: {
      atlasId: 'atlas-ai',
      atlasLabel: 'AI foundations',
      taxonomyVersion: 3,
      gaps: [
        { nodeId: 'systems', label: 'Systems', state: 'missing', gap: 1, expectedWeight: 2 },
        { nodeId: 'ml', label: 'ML', state: 'sparse', gap: 0.5, supportingItemIds: ['n-ml'] },
      ],
    },
    staleReviewedItems: [
      { noteId: 'n-old', title: 'Old note', reviewedAt: '2026-01-01T00:00:00.000Z' },
    ],
    unresolvedBridges: [
      { bridgeId: 'bridge-1', fromItemId: 'n-a', fromTitle: 'A', targetTitle: 'Missing B' },
    ],
    noteAssessments: [
      { noteId: 'n-unassessed', title: 'Unknown' },
      { noteId: 'n-low', title: 'Low confidence', mastery: 0.7, confidence: 0.2 },
      { noteId: 'n-confident', title: 'Confident', mastery: 0.8, confidence: 0.9 },
    ],
    userMarkedGoals: [
      { goalId: 'goal-1', label: 'Study proofs', noteId: 'n-ml', priority: 0.8, updatedAt: at },
      { goalId: 'goal-done', label: 'Done', active: false },
    ],
  }
}

function projectFixture(): TerrainProject {
  const notes = [
    note('goal', { status: 'gap', mastery: 0.8, confidence: 0.8, reviewedAt: at, links: ['Missing target'], declaredAreas: ['Covered'] }),
    note('stale', { mastery: 0.8, confidence: 0.8, reviewedAt: '2026-01-01T00:00:00.000Z' }),
    note('unassessed'),
    note('exploration-only', { mastery: 0.8, confidence: 0.8, exploration: 1, reviewedAt: at }),
  ]
  return {
    schemaVersion: 3,
    id: 'project-1',
    name: 'Project',
    createdAt: at,
    updatedAt: at,
    timeZone: 'UTC',
    modelId: 'test',
    embeddingMode: 'fallback',
    sourceDigest: 'digest',
    gridSize: 2,
    notes,
    snapshots: [],
    peaks: [],
    noteNeighbors: [],
    cognitiveStates: [{
      itemId: 'goal',
      status: 'gap',
      updatedAt: at,
      provenance: 'app',
    }],
    interactionEvents: [{ id: 'hot', itemId: 'exploration-only', type: 'opened', occurredAt: at }],
    terrainProfiles: [],
    activeTerrainProfileId: 'density',
    taxonomyVersion: 1,
    taxonomyNodes: [{
      id: 'covered',
      workspaceId: 'project-1',
      label: 'Covered',
      aliases: [],
      version: 1,
      status: 'active',
      createdAt: at,
      updatedAt: at,
    }, {
      id: 'missing',
      workspaceId: 'project-1',
      label: 'Missing',
      aliases: [],
      version: 1,
      status: 'active',
      createdAt: at,
      updatedAt: at,
    }],
    referenceAtlases: [{
      id: 'atlas-1',
      workspaceId: 'project-1',
      label: 'Atlas',
      taxonomyVersion: 1,
      taxonomyNodeIds: ['covered', 'missing'],
      createdAt: at,
      updatedAt: at,
    }],
    activeReferenceAtlasId: 'atlas-1',
  }
}

function note(id: string, patch: Partial<TerrainNote> = {}): TerrainNote {
  return {
    id,
    fingerprint: `${id}-v1`,
    title: id,
    content: id,
    createdAt: at,
    createdAtMs: Date.parse(at),
    tags: [],
    weight: 1,
    links: [],
    x: 0,
    y: 0,
    ...patch,
  }
}
