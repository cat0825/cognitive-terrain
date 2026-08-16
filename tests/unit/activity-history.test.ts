import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_HISTORY_POLICY_VERSION,
  DEFAULT_ACTIVITY_RETENTION_POLICY,
  activityBucketKey,
  activityRawHeat,
  activityScoreFromRawHeat,
  compactActivityHistory,
} from '../../src/domain/activity-history'
import { buildActivitySummaries } from '../../src/domain/activity-temperature'
import type { InteractionEvent } from '../../src/domain/types'

const now = '2026-08-15T12:00:00.000Z'

describe('activity history retention and compaction', () => {
  it('uses the configured timezone for deterministic day and Monday-week buckets', () => {
    expect(activityBucketKey('2026-08-02T23:30:00.000Z', 'Asia/Shanghai', 'day')).toBe('2026-08-03')
    expect(activityBucketKey('2026-08-02T23:30:00.000Z', 'Asia/Shanghai', 'week')).toBe('2026-08-03')
    expect(activityBucketKey('2026-08-09T23:30:00.000Z', 'America/Los_Angeles', 'day')).toBe('2026-08-09')
  })

  it('ignores invalid timestamps and retains review/edit audit timestamps in aggregates', () => {
    const state = compactActivityHistory([
      event('reviewed', '2025-07-01T12:00:00.000Z'),
      event('edited', '2025-07-01T13:00:00.000Z'),
      event('reviewed', 'not-a-date'),
    ], { timeZone: 'UTC', now })

    expect(state.rawEvents).toHaveLength(0)
    expect(state.aggregates).toHaveLength(2)
    expect(state.aggregates.find((entry) => entry.type === 'reviewed')).toMatchObject({
      count: 1,
      firstOccurredAt: '2025-07-01T12:00:00.000Z',
      lastOccurredAt: '2025-07-01T12:00:00.000Z',
    })
    expect(state.aggregates.find((entry) => entry.type === 'edited')?.lastOccurredAt).toBe('2025-07-01T13:00:00.000Z')
  })

  it('applies explicit raw retention windows by event type', () => {
    const state = compactActivityHistory([
      event('opened', '2026-05-07T12:00:00.000Z', 'open-100d'),
      event('edited', '2026-05-07T12:00:00.000Z', 'edit-100d'),
      event('reviewed', '2025-10-19T12:00:00.000Z', 'review-300d'),
    ], { timeZone: 'UTC', now })

    expect(state.rawEvents.map((entry) => entry.id)).toEqual(['review-300d', 'edit-100d'])
    expect(state.aggregates).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'opened', count: 1 }),
    ]))
  })

  it('is idempotent when compacted twice at the same point in time', () => {
    const first = compactActivityHistory([
      event('opened', '2026-07-01T00:00:00.000Z'),
      event('opened', '2026-08-14T00:00:00.000Z'),
    ], { timeZone: 'UTC', now })
    const second = compactActivityHistory(first.rawEvents, {
      timeZone: first.timeZone,
      now,
      aggregates: first.aggregates,
    })

    expect(second).toEqual(first)
    expect(activityScoreFromRawHeat(
      activityRawHeat(first.rawEvents, first.aggregates, 'note-a', now),
    )).toBeCloseTo(activityScoreFromRawHeat(
      activityRawHeat(second.rawEvents, second.aggregates, 'note-a', now),
    ), 12)
  })

  it('bounds high-activity storage and promotes old day buckets to week buckets', () => {
    const policy = { ...DEFAULT_ACTIVITY_RETENTION_POLICY, maxRawEventsPerItem: 3 }
    const events = Array.from({ length: 365 * 24 }, (_, index) => event(
      'edited',
      new Date(Date.parse(now) - index * 60 * 60 * 1000).toISOString(),
      `e-${index}`,
    ))
    const state = compactActivityHistory(events, { timeZone: 'UTC', now, policy })

    expect(state.rawEvents).toHaveLength(3)
    expect(state.aggregates.length).toBeLessThanOrEqual(180 + 105)
    expect(state.aggregates.some((entry) => entry.granularity === 'week')).toBe(true)
    const before = buildActivitySummaries([{ id: 'note-a' }], events, Date.parse(now)).get('note-a')!.score
    const after = activityScoreFromRawHeat(activityRawHeat(state.rawEvents, state.aggregates, 'note-a', now))
    expect(after).toBeCloseTo(before, 12)
  })

  it('merges a legacy aggregate without changing its score beyond floating point tolerance', () => {
    const source = compactActivityHistory([event('reviewed', '2026-07-01T00:00:00.000Z')], {
      timeZone: 'UTC',
      now,
    })
    const compacted = compactActivityHistory(source.rawEvents, {
      timeZone: 'UTC',
      now,
      aggregates: source.aggregates,
    })
    const before = activityRawHeat(source.rawEvents, source.aggregates, 'note-a', now)
    const after = activityRawHeat(compacted.rawEvents, compacted.aggregates, 'note-a', now)
    expect(compacted.policyVersion).toBe(ACTIVITY_HISTORY_POLICY_VERSION)
    expect(after).toBeCloseTo(before, 12)
  })
})

function event(type: InteractionEvent['type'], occurredAt: string, id = `${type}-${occurredAt}`): InteractionEvent {
  return { id, itemId: 'note-a', type, occurredAt }
}