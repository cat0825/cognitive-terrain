import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_ELEVATION_FORMULA_VERSION,
  calculateActivityElevation,
} from '../../src/domain/activity-elevation'
import { DEFAULT_TERRAIN_PROFILES } from '../../src/domain/terrain-profile'
import type { ActivityHistoryAggregate } from '../../src/domain/activity-history'
import type { InteractionEvent } from '../../src/domain/types'

const evaluatedAt = '2026-08-15T00:00:00.000Z'

describe('activity elevation', () => {
  it('is deterministic and reports formula/timestamp/evidence', () => {
    const events = [event('opened', '2026-08-14T00:00:00.000Z'), event('reviewed', '2026-08-13T00:00:00.000Z')]
    const first = calculateActivityElevation({ itemId: 'note-a', events, evaluatedAt })
    const second = calculateActivityElevation({ itemId: 'note-a', events, evaluatedAt })

    expect(second).toEqual(first)
    expect(first).toMatchObject({ formulaVersion: ACTIVITY_ELEVATION_FORMULA_VERSION, evaluatedAt, historyState: 'sparse' })
    expect(first.evidence.map((entry) => entry.type)).toEqual(['opened', 'reviewed'])
    expect(DEFAULT_TERRAIN_PROFILES.find((profile) => profile.id === 'activity')?.formulaVersion).toBe(ACTIVITY_ELEVATION_FORMULA_VERSION)
  })

  it('applies the documented weights and half-lives for each raw event type', () => {
    const result = calculateActivityElevation({
      itemId: 'note-a',
      events: [
        event('opened', evaluatedAt),
        event('edited', '2026-07-16T00:00:00.000Z'),
        event('reviewed', '2026-08-01T00:00:00.000Z'),
      ],
      evaluatedAt,
    })

    expect(result.rawHeat).toBeCloseTo(1 + 1.5 + 1.25, 12)
    expect(result.historyState).toBe('active')
  })

  it('uses aggregate-only history for recency, heat and provenance', () => {
    const result = calculateActivityElevation({
      itemId: 'note-a',
      events: [],
      aggregates: [aggregate()],
      evaluatedAt,
    })

    expect(result).toMatchObject({
      historyState: 'active',
      validEventCount: 0,
      validAggregateCount: 1,
      aggregateEventCount: 4,
      recentEventCount: 4,
      recentAggregateEventCount: 4,
      latestActivityAt: '2026-08-14T12:00:00.000Z',
    })
    expect(result.rawHeat).toBeCloseTo(1.5, 12)
    expect(result.evidence).toEqual([
      expect.objectContaining({
        type: 'edited',
        count: 4,
        rawEventCount: 0,
        aggregateEventCount: 4,
        aggregateRecordCount: 1,
        aggregateHeat: 1.5,
        provenance: ['retained-aggregate'],
      }),
    ])
  })

  it('suppresses duplicate ids and opened events inside the one-minute window', () => {
    const opened = event('opened', '2026-08-14T23:58:00.000Z', 'open-1')
    const result = calculateActivityElevation({
      itemId: 'note-a',
      events: [
        opened,
        { ...opened },
        event('opened', '2026-08-14T23:58:30.000Z', 'open-2'),
      ],
      aggregates: [aggregate(), { ...aggregate() }],
      evaluatedAt,
    })

    expect(result).toMatchObject({
      validEventCount: 1,
      validAggregateCount: 1,
      suppressedDuplicateEventCount: 2,
      suppressedDuplicateAggregateCount: 1,
    })
    expect(result.evidence.find((entry) => entry.type === 'opened')).toMatchObject({ count: 1, rawEventCount: 1 })
  })

  it.each([
    ['missing', []],
    ['stale', [event('opened', '2026-01-01T00:00:00.000Z')]],
  ] as const)('classifies %s history explicitly', (historyState, events) => {
    expect(calculateActivityElevation({ itemId: 'note-a', events, evaluatedAt }).historyState).toBe(historyState)
  })

  it('ignores invalid event timestamps and rejects invalid evaluation timestamps', () => {
    expect(calculateActivityElevation({ itemId: 'note-a', events: [event('edited', 'invalid')], evaluatedAt }).historyState).toBe('missing')
    expect(() => calculateActivityElevation({ itemId: 'note-a', events: [], evaluatedAt: 'invalid' })).toThrow(/Invalid timestamp/)
  })

  it('ignores future, unsupported and malformed raw or aggregate inputs', () => {
    const malformed = aggregate({
      id: 'bad-aggregate',
      firstOccurredAt: 'invalid',
      lastOccurredAt: 'invalid',
      compactedAt: 'invalid',
    })
    const future = aggregate({
      id: 'future-aggregate',
      firstOccurredAt: '2026-08-16T00:00:00.000Z',
      lastOccurredAt: '2026-08-16T00:00:00.000Z',
      compactedAt: '2026-08-16T00:00:00.000Z',
    })
    const result = calculateActivityElevation({
      itemId: 'note-a',
      events: [
        event('edited', 'invalid'),
        event('reviewed', '2026-08-16T00:00:00.000Z'),
        event('created', '2026-08-14T00:00:00.000Z'),
      ],
      aggregates: [malformed, future],
      evaluatedAt,
    })

    expect(result).toMatchObject({
      historyState: 'missing',
      rawHeat: 0,
      validEventCount: 0,
      validAggregateCount: 0,
      recentEventCount: 0,
    })
    expect(result.latestActivityAt).toBeUndefined()
    expect(result.evidence).toEqual([])
  })
})

function event(type: InteractionEvent['type'], occurredAt: string, id = `${type}-${occurredAt}`): InteractionEvent {
  return { id, itemId: 'note-a', type, occurredAt }
}

function aggregate(overrides: Partial<ActivityHistoryAggregate> = {}): ActivityHistoryAggregate {
  return {
    id: 'aggregate-1',
    policyVersion: 1,
    itemId: 'note-a',
    type: 'edited',
    granularity: 'day',
    bucket: '2026-08-14',
    timeZone: 'UTC',
    count: 4,
    firstOccurredAt: '2026-08-14T10:00:00.000Z',
    lastOccurredAt: '2026-08-14T12:00:00.000Z',
    heatAtCompactedAt: 1.5,
    compactedAt: evaluatedAt,
    ...overrides,
  }
}
