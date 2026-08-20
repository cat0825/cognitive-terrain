import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_CLOCK_SKEW_TOLERANCE_MS,
  isFutureActivityTimestamp,
} from '../../src/domain/future-activity'
import {
  activityRawHeat,
  activityScoreFromRawHeat,
  aggregateActivityHistoryCounts,
  compactActivityHistory,
  createActivityCompactionDiagnostics,
  type ActivityHistoryAggregate,
} from '../../src/domain/activity-history'
import { buildActivitySummaries } from '../../src/domain/activity-temperature'
import type { InteractionEvent } from '../../src/domain/types'

const now = '2026-08-15T12:00:00.000Z'
const nowMs = Date.parse(now)

describe('future activity boundary', () => {
  it('treats now and the tolerance edge as present, and only beyond it as future', () => {
    expect(isFutureActivityTimestamp(nowMs, nowMs)).toBe(false)
    expect(isFutureActivityTimestamp(nowMs + ACTIVITY_CLOCK_SKEW_TOLERANCE_MS, nowMs)).toBe(false)
    expect(isFutureActivityTimestamp(nowMs + ACTIVITY_CLOCK_SKEW_TOLERANCE_MS + 1, nowMs)).toBe(true)
    expect(isFutureActivityTimestamp(nowMs - 1, nowMs)).toBe(false)
  })

  it('does not classify unparsable timestamps as future', () => {
    // Invalid input is rejected separately; conflating the two would hide bad
    // data behind a future-event warning.
    expect(isFutureActivityTimestamp(Number.NaN, nowMs)).toBe(false)
  })
})

describe('future-dated raw events', () => {
  it('cannot raise heat, score, or last activity', () => {
    const future = event('edited', '2030-01-01T00:00:00.000Z')
    const summary = buildActivitySummaries([{ id: 'note-a' }], [future], nowMs).get('note-a')!

    expect(summary.rawHeat).toBe(0)
    expect(summary.score).toBe(0)
    expect(summary.totalCount).toBe(0)
    expect(summary.lastActivityAt).toBeUndefined()
  })

  it('does not let a future event outrank a real past event', () => {
    const past = event('reviewed', '2026-08-14T12:00:00.000Z')
    const future = event('reviewed', '2030-01-01T00:00:00.000Z')

    const withFuture = buildActivitySummaries([{ id: 'note-a' }], [past, future], nowMs).get('note-a')!
    const withoutFuture = buildActivitySummaries([{ id: 'note-a' }], [past], nowMs).get('note-a')!

    expect(withFuture.lastActivityAt).toBe(past.occurredAt)
    expect(withFuture.rawHeat).toBeCloseTo(withoutFuture.rawHeat, 12)
    expect(withFuture.score).toBeCloseTo(withoutFuture.score, 12)
  })

  it('keeps a future event out of compaction, heat, and history buckets', () => {
    const diagnostics = createActivityCompactionDiagnostics()
    const future = event('edited', '2030-01-01T00:00:00.000Z')
    const state = compactActivityHistory([future], { timeZone: 'UTC', now, diagnostics })

    expect(state.rawEvents).toHaveLength(0)
    expect(state.aggregates).toHaveLength(0)
    expect(diagnostics.ignoredFutureEvents).toEqual([future])
    expect(activityRawHeat(state.rawEvents, state.aggregates, 'note-a', now)).toBe(0)
    expect(aggregateActivityHistoryCounts(state, 'day', now)).toEqual([])
  })

  it('accepts activity inside the clock-skew window so ordinary drift is not discarded', () => {
    const skewed = event('edited', new Date(nowMs + ACTIVITY_CLOCK_SKEW_TOLERANCE_MS - 1_000).toISOString())
    const summary = buildActivitySummaries([{ id: 'note-a' }], [skewed], nowMs).get('note-a')!

    expect(summary.totalCount).toBe(1)
    expect(summary.rawHeat).toBeGreaterThan(0)
    expect(summary.lastActivityAt).toBe(skewed.occurredAt)
  })
})

describe('future-dated aggregates', () => {
  it('contribute no heat and cannot become the latest activity', () => {
    const aggregate = futureAggregate()
    const summary = buildActivitySummaries([{ id: 'note-a' }], [], nowMs, [aggregate]).get('note-a')!

    expect(summary.rawHeat).toBe(0)
    expect(summary.score).toBe(0)
    expect(summary.lastActivityAt).toBeUndefined()
    expect(activityRawHeat([], [aggregate], 'note-a', now)).toBe(0)
  })

  it('are dropped by compaction with a diagnostic instead of being merged', () => {
    const diagnostics = createActivityCompactionDiagnostics()
    const aggregate = futureAggregate()
    const state = compactActivityHistory([], {
      timeZone: 'UTC',
      now,
      aggregates: [aggregate],
      diagnostics,
    })

    expect(state.aggregates).toHaveLength(0)
    expect(diagnostics.ignoredFutureAggregateIds).toEqual([aggregate.id])
  })

  it('drops an aggregate whose lastOccurredAt is future even when compactedAt is past', () => {
    // lastOccurredAt drives "recent activity", so a future value there is enough
    // to distort the result on its own.
    const aggregate: ActivityHistoryAggregate = {
      ...futureAggregate(),
      compactedAt: '2026-08-14T12:00:00.000Z',
      firstOccurredAt: '2026-08-14T00:00:00.000Z',
      lastOccurredAt: '2030-01-01T00:00:00.000Z',
    }
    const summary = buildActivitySummaries([{ id: 'note-a' }], [], nowMs, [aggregate]).get('note-a')!

    expect(summary.lastActivityAt).toBeUndefined()
    expect(activityRawHeat([], [aggregate], 'note-a', now)).toBe(0)
  })

  it('leaves past activity fully intact', () => {
    // Old enough to be compacted into an aggregate rather than retained raw:
    // `opened` keeps only 30 days of raw events.
    const state = compactActivityHistory([event('opened', '2026-06-01T00:00:00.000Z')], {
      timeZone: 'UTC',
      now,
    })
    const heat = activityRawHeat(state.rawEvents, state.aggregates, 'note-a', now)

    expect(state.rawEvents).toHaveLength(0)
    expect(state.aggregates).toHaveLength(1)
    expect(heat).toBeGreaterThan(0)
    expect(activityScoreFromRawHeat(heat)).toBeGreaterThan(0)
  })
})

function event(type: InteractionEvent['type'], occurredAt: string, id = `${type}-${occurredAt}`): InteractionEvent {
  return { id, itemId: 'note-a', type, occurredAt }
}

function futureAggregate(): ActivityHistoryAggregate {
  return {
    id: 'activity-v1:note-a:edited:day:2030-01-01:UTC',
    policyVersion: 1,
    itemId: 'note-a',
    type: 'edited',
    granularity: 'day',
    bucket: '2030-01-01',
    timeZone: 'UTC',
    count: 5,
    firstOccurredAt: '2030-01-01T00:00:00.000Z',
    lastOccurredAt: '2030-01-01T00:00:00.000Z',
    heatAtCompactedAt: 12,
    compactedAt: '2030-01-01T00:00:00.000Z',
  }
}
