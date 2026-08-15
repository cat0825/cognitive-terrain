import { describe, expect, it } from 'vitest'
import { buildActivitySummaries, shouldRecordOpenedEvent, temperatureColor } from '../../src/domain/activity-temperature'
import { commitAnalyzedProject, createInteractionEvent, eventTypeForNoteUpdate } from '../../src/domain/cognitive-state'
import { createDemoProject } from '../../src/domain/demo'

describe('cognitive state events', () => {
  it('commits a reanalysis without changing project identity or losing event history', () => {
    const base = createDemoProject()
    base.id = 'stable-project-id'
    base.createdAt = '2026-01-01T00:00:00.000Z'
    base.activeTerrainProfileId = 'mastery'
    const previous = createInteractionEvent('note-a', 'opened', '2026-08-14T01:00:00.000Z')
    base.interactionEvents = [previous]
    const analyzed = createDemoProject()
    analyzed.id = 'new-analysis-id'
    const edited = createInteractionEvent('note-a', 'edited', '2026-08-14T02:00:00.000Z', {
      changedFields: ['content'],
    })

    const committed = commitAnalyzedProject(analyzed, base, [edited])

    expect(committed.id).toBe('stable-project-id')
    expect(committed.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(committed.updatedAt).toBe('2026-08-14T02:00:00.000Z')
    expect(committed.activeTerrainProfileId).toBe('mastery')
    expect(committed.interactionEvents).toEqual([previous, edited])
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
