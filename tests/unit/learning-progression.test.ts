import { describe, expect, it } from 'vitest'
import { createDemoProject } from '../../src/domain/demo'
import {
  calculateLearningProgression,
  calculateProjectLearningProgression,
  createCognitiveObservation,
  MAX_COGNITIVE_OBSERVATIONS_PER_ITEM_FIELD,
  normalizeCognitiveObservations,
} from '../../src/domain/learning-progression'
import type { CognitiveObservation, CognitiveState } from '../../src/domain/types'
import { createInteractionEvent } from '../../src/domain/cognitive-state'
import { migrateProject } from '../../src/storage/db'

const evaluatedAt = '2026-08-17T08:00:00.000Z'

describe('learning progression', () => {
  it('replays the same observations deterministically and keeps provenance visible', () => {
    const observations = [
      observation('first', 0.35, '2026-08-01T08:00:00.000Z', 'self-assessment'),
      observation('second', 0.8, '2026-08-16T08:00:00.000Z', 'review-outcome'),
    ]
    const point = { x: -0.42, y: 0.73 }

    const first = calculateLearningProgression({ itemId: 'note-a', observations, evaluatedAt })
    const second = calculateLearningProgression({ itemId: 'note-a', observations: [...observations].reverse(), evaluatedAt })

    expect(second).toEqual(first)
    expect(first).toMatchObject({
      profileVersion: 'learning-progression-v1',
      elevation: 0.8,
      value: 0.8,
      historyState: 'observed',
      observationCount: 2,
    })
    expect(first.evidence.map((entry) => entry.provenance)).toEqual(['self-assessment', 'review-outcome'])
    expect(point).toEqual({ x: -0.42, y: 0.73 })

    const selfAssessment = calculateLearningProgression({
      itemId: 'note-a',
      observations: [observation('self', 0.8, '2026-08-16T08:00:00.000Z')],
      evaluatedAt,
    })
    expect(selfAssessment.uncertainty).toBeGreaterThan(first.uncertainty)

    const checkpoint = calculateLearningProgression({
      itemId: 'note-a',
      observations,
      evaluatedAt: '2026-08-02T08:00:00.000Z',
    })
    expect(checkpoint).toMatchObject({ elevation: 0.35, observationCount: 1, historyState: 'sparse' })
  })

  it('keeps snapshot-only migration neutral without inventing past observations', () => {
    const demo = createDemoProject()
    const legacy = {
      ...demo,
      updatedAt: '2026-08-17T08:00:00.000Z',
      cognitiveObservations: undefined,
      learningProgressionProfileVersion: undefined,
    }
    const migrated = migrateProject(legacy)
    const snapshot = migrated.cognitiveStates[0]

    expect(migrated.cognitiveObservations).toEqual([])
    expect(migrated.learningProgressionProfileVersion).toBe('learning-progression-v1')
    expect(migrated.cognitiveStates).toEqual(legacy.cognitiveStates)
    expect(calculateLearningProgression({
      itemId: snapshot.itemId,
      observations: migrated.cognitiveObservations ?? [],
      snapshot,
      evaluatedAt,
    })).toMatchObject({ historyState: 'snapshot-only', elevation: snapshot.mastery, observationCount: 0 })
    expect(calculateLearningProgression({
      itemId: snapshot.itemId,
      observations: migrated.cognitiveObservations ?? [],
      snapshot,
      evaluatedAt: new Date(Date.parse(snapshot.updatedAt) - 1),
    })).toMatchObject({ historyState: 'missing', elevation: 0.5, observationCount: 0 })
  })

  it('changes progression only through an explicit observation, not activity events', () => {
    const snapshot: CognitiveState = {
      itemId: 'note-a',
      mastery: 0.4,
      updatedAt: '2026-08-01T08:00:00.000Z',
      provenance: 'app',
    }
    const withoutReviewOutcome = calculateLearningProgression({
      itemId: 'note-a',
      observations: [],
      snapshot,
      evaluatedAt,
    })
    const withReviewOutcome = calculateLearningProgression({
      itemId: 'note-a',
      observations: [observation('review', 0.7, '2026-08-17T07:00:00.000Z', 'review-outcome')],
      snapshot,
      evaluatedAt,
    })

    expect(withoutReviewOutcome).toMatchObject({ elevation: 0.4, historyState: 'snapshot-only' })
    expect(withReviewOutcome).toMatchObject({ elevation: 0.7, historyState: 'sparse' })

    const demo = createDemoProject()
    const noteId = demo.notes[0].id
    const beforeActivity = calculateProjectLearningProgression(demo, noteId, evaluatedAt)
    const afterActivity = calculateProjectLearningProgression({
      ...demo,
      interactionEvents: [
        createInteractionEvent(noteId, 'opened', '2026-08-17T05:00:00.000Z'),
        createInteractionEvent(noteId, 'edited', '2026-08-17T06:00:00.000Z'),
        createInteractionEvent(noteId, 'reviewed', '2026-08-17T07:00:00.000Z'),
      ],
    }, noteId, evaluatedAt)
    expect(afterActivity).toEqual(beforeActivity)
  })

  it('keeps missing, conflicting, and stale evidence explicit and neutral', () => {
    const missing = calculateLearningProgression({ itemId: 'note-a', observations: [], evaluatedAt })
    const conflicting = calculateLearningProgression({
      itemId: 'note-a',
      observations: [
        observation('conflict-a', 0.25, '2026-08-16T08:00:00.000Z'),
        observation('conflict-b', 0.75, '2026-08-16T08:00:00.000Z', 'review-outcome'),
      ],
      evaluatedAt,
    })
    const stale = calculateLearningProgression({
      itemId: 'note-a',
      observations: [observation('stale', 0.6, '2025-08-16T08:00:00.000Z')],
      evaluatedAt,
    })

    expect(missing).toMatchObject({ elevation: 0.5, uncertainty: 1, historyState: 'missing' })
    expect(conflicting).toMatchObject({ elevation: 0.75, historyState: 'conflicting' })
    expect(stale).toMatchObject({ elevation: 0.6, historyState: 'stale' })
  })

  it('requires timezone-explicit observations and canonicalizes equivalent instants', () => {
    expect(() => observation('local-time', 0.5, '2026-08-17T08:00:00')).toThrow(/explicit time zone/)
    const normalized = observation('offset-time', 0.5, '2026-08-17T16:00:00+08:00')
    expect(normalized.observedAt).toBe(evaluatedAt)
  })

  it('does not apply a snapshot from another item', () => {
    const snapshot: CognitiveState = {
      itemId: 'note-b',
      mastery: 0.95,
      updatedAt: '2026-08-17T07:00:00.000Z',
      provenance: 'app',
    }
    expect(calculateLearningProgression({
      itemId: 'note-a',
      observations: [],
      snapshot,
      evaluatedAt,
    })).toMatchObject({ elevation: 0.5, historyState: 'missing' })
  })

  it('applies decay only when the explicit decay profile is selected', () => {
    const observations = [observation('baseline', 0.8, '2026-08-07T08:00:00.000Z', 'review-outcome')]

    expect(calculateLearningProgression({ itemId: 'note-a', observations, evaluatedAt }).elevation).toBe(0.8)
    expect(calculateLearningProgression({
      itemId: 'note-a',
      observations,
      evaluatedAt,
      profileVersion: 'learning-progression-linear-decay-v1',
    }).elevation).toBeCloseTo(0.79, 12)
  })

  it('bounds retained observations per item and field without losing the latest evidence', () => {
    const observations = Array.from({ length: MAX_COGNITIVE_OBSERVATIONS_PER_ITEM_FIELD + 4 }, (_, index) =>
      observation(`observation-${String(index).padStart(4, '0')}`, index / 300, new Date(Date.UTC(2025, 0, index + 1)).toISOString()),
    )

    const normalized = normalizeCognitiveObservations(observations)

    expect(normalized).toHaveLength(MAX_COGNITIVE_OBSERVATIONS_PER_ITEM_FIELD)
    expect(normalized.at(-1)?.id).toBe(`observation-${String(observations.length - 1).padStart(4, '0')}`)
  })
})

function observation(
  id: string,
  value: number,
  observedAt: string,
  provenance: CognitiveObservation['provenance'] = 'self-assessment',
): CognitiveObservation {
  return createCognitiveObservation({
    id,
    itemId: 'note-a',
    field: 'mastery',
    value,
    observedAt,
    provenance,
    reason: provenance === 'review-outcome' ? 'manual review result' : 'manual self assessment',
  })
}
