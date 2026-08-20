import { ACTIVITY_MODEL } from './activity-temperature'
import type { InteractionEvent, InteractionEventType } from './types'
import { isFutureActivityTimestamp } from './future-activity'

const DAY_MS = 24 * 60 * 60 * 1000

export const ACTIVITY_HISTORY_POLICY_VERSION = 1 as const

export interface ActivityRetentionPolicy {
  version: typeof ACTIVITY_HISTORY_POLICY_VERSION
  rawRetentionDays: number
  rawRetentionDaysByType?: Partial<Record<InteractionEventType, number>>
  dailyRetentionDays: number
  weeklyRetentionDays: number
  maxRawEventsPerItem: number
}

export const DEFAULT_ACTIVITY_RETENTION_POLICY: Readonly<ActivityRetentionPolicy> = {
  version: ACTIVITY_HISTORY_POLICY_VERSION,
  rawRetentionDays: 30,
  rawRetentionDaysByType: { opened: 30, edited: 180, reviewed: 365 },
  dailyRetentionDays: 180,
  weeklyRetentionDays: 730,
  maxRawEventsPerItem: 500,
}

export type ActivityHistoryGranularity = 'day' | 'week'

/**
 * One bounded, mergeable history record. Heat is stored per event type because
 * each temperature-model event has a different half-life.
 */
export interface ActivityHistoryAggregate {
  id: string
  policyVersion: typeof ACTIVITY_HISTORY_POLICY_VERSION
  itemId: string
  type: InteractionEventType
  granularity: ActivityHistoryGranularity
  bucket: string
  timeZone: string
  count: number
  firstOccurredAt: string
  lastOccurredAt: string
  heatAtCompactedAt: number
  compactedAt: string
}

export interface ActivityHistoryState {
  policyVersion: typeof ACTIVITY_HISTORY_POLICY_VERSION
  timeZone: string
  rawEvents: InteractionEvent[]
  aggregates: ActivityHistoryAggregate[]
}

export interface CompactActivityHistoryOptions {
  timeZone: string
  now?: string | number | Date
  policy?: Readonly<ActivityRetentionPolicy>
  aggregates?: readonly ActivityHistoryAggregate[]
  /**
   * Reference time for deciding what counts as future-dated. Defaults to `now`.
   *
   * These are deliberately separate clocks. `now` also drives the retention
   * cutoffs, and callers such as project migration pass a stored `updatedAt`
   * there to keep migration deterministic. Reusing that stored value to detect
   * future events would discard genuine activity recorded after it, so callers
   * with a stale `now` pass the real clock here instead.
   */
  futureReference?: string | number | Date
  /**
   * Collects events dropped for being future-dated so callers can surface a
   * warning. Compaction stays silent by default because it also runs on load,
   * where there is no import to attach a warning to.
   */
  diagnostics?: ActivityCompactionDiagnostics
}

/** Mutable sink for compaction findings that callers may want to report. */
export interface ActivityCompactionDiagnostics {
  ignoredFutureEvents: InteractionEvent[]
  ignoredFutureAggregateIds: string[]
}

export function createActivityCompactionDiagnostics(): ActivityCompactionDiagnostics {
  return { ignoredFutureEvents: [], ignoredFutureAggregateIds: [] }
}

export interface ActivityCountBucket {
  granularity: ActivityHistoryGranularity
  bucket: string
  totalCount: number
  counts: Partial<Record<InteractionEventType, number>>
  firstOccurredAt: string
  lastOccurredAt: string
}

interface MutableAggregate {
  itemId: string
  type: InteractionEventType
  granularity: ActivityHistoryGranularity
  bucket: string
  timeZone: string
  count: number
  firstOccurredAt: string
  lastOccurredAt: string
  heatAtNow: number
}

/**
 * Compacts raw events and previously compacted aggregates into a bounded state.
 * Passing its output back with the same `now` is idempotent.
 */
export function compactActivityHistory(
  events: readonly InteractionEvent[],
  options: CompactActivityHistoryOptions,
): ActivityHistoryState {
  const policy = options.policy ?? DEFAULT_ACTIVITY_RETENTION_POLICY
  assertPolicy(policy)
  assertTimeZone(options.timeZone)
  const nowMs = parseNow(options.now)
  const futureReferenceMs = options.futureReference === undefined
    ? nowMs
    : parseDate(options.futureReference)
  const compactedAt = new Date(nowMs).toISOString()
  const dailyCutoff = nowMs - policy.dailyRetentionDays * DAY_MS
  const weeklyCutoff = nowMs - policy.weeklyRetentionDays * DAY_MS
  const dedupedEvents = [...new Map(events.map((event) => [event.id, event])).values()]
    .map((event) => ({ event, occurredAtMs: Date.parse(event.occurredAt) }))
    .filter((entry) => Number.isFinite(entry.occurredAtMs))
  // Future events are dropped here rather than clamped, so retention, heat, and
  // bucketing all see the same set and compaction stays idempotent.
  const validEvents = dedupedEvents.filter((entry) => {
    if (!isFutureActivityTimestamp(entry.occurredAtMs, futureReferenceMs)) return true
    options.diagnostics?.ignoredFutureEvents.push(entry.event)
    return false
  })

  const rawEvents: InteractionEvent[] = []
  const compactableEvents: Array<{ event: InteractionEvent; occurredAtMs: number }> = []
  const eventsByItem = new Map<string, Array<{ event: InteractionEvent; occurredAtMs: number }>>()
  for (const entry of validEvents) {
    const itemEvents = eventsByItem.get(entry.event.itemId) ?? []
    itemEvents.push(entry)
    eventsByItem.set(entry.event.itemId, itemEvents)
  }
  for (const itemEvents of eventsByItem.values()) {
    itemEvents.sort(compareEventEntriesNewestFirst)
    const rawCountByType = new Map<InteractionEventType, number>()
    for (const entry of itemEvents) {
      const rawRetentionDays = policy.rawRetentionDaysByType?.[entry.event.type] ?? policy.rawRetentionDays
      const rawCutoff = nowMs - rawRetentionDays * DAY_MS
      const rawCount = rawCountByType.get(entry.event.type) ?? 0
      if (entry.occurredAtMs >= rawCutoff && rawCount < policy.maxRawEventsPerItem) {
        rawEvents.push(entry.event)
        rawCountByType.set(entry.event.type, rawCount + 1)
      } else if (entry.occurredAtMs >= weeklyCutoff) {
        compactableEvents.push(entry)
      }
    }
  }
  rawEvents.sort(compareEventsChronologically)

  const merged = new Map<string, MutableAggregate>()
  for (const aggregate of options.aggregates ?? []) {
    if (!isUsableAggregate(aggregate, options.timeZone, weeklyCutoff)) continue
    if (hasFutureAggregateTimestamp(aggregate, futureReferenceMs)) {
      options.diagnostics?.ignoredFutureAggregateIds.push(aggregate.id)
      continue
    }
    const lastOccurredAtMs = Date.parse(aggregate.lastOccurredAt)
    const granularity = aggregate.granularity === 'week' || lastOccurredAtMs < dailyCutoff
      ? 'week'
      : 'day'
    const bucket = activityBucketKey(aggregate.lastOccurredAt, options.timeZone, granularity)
    const heatAtNow = decayStoredHeat(aggregate, nowMs)
    mergeAggregate(merged, {
      itemId: aggregate.itemId,
      type: aggregate.type,
      granularity,
      bucket,
      timeZone: options.timeZone,
      count: aggregate.count,
      firstOccurredAt: aggregate.firstOccurredAt,
      lastOccurredAt: aggregate.lastOccurredAt,
      heatAtNow,
    })
  }

  for (const { event, occurredAtMs } of compactableEvents) {
    const granularity: ActivityHistoryGranularity = occurredAtMs < dailyCutoff ? 'week' : 'day'
    const bucket = activityBucketKey(event.occurredAt, options.timeZone, granularity)
    mergeAggregate(merged, {
      itemId: event.itemId,
      type: event.type,
      granularity,
      bucket,
      timeZone: options.timeZone,
      count: 1,
      firstOccurredAt: event.occurredAt,
      lastOccurredAt: event.occurredAt,
      heatAtNow: eventHeatAt(event, nowMs),
    })
  }

  const aggregates = [...merged.values()]
    .map((aggregate): ActivityHistoryAggregate => ({
      id: aggregateId(aggregate),
      policyVersion: ACTIVITY_HISTORY_POLICY_VERSION,
      itemId: aggregate.itemId,
      type: aggregate.type,
      granularity: aggregate.granularity,
      bucket: aggregate.bucket,
      timeZone: aggregate.timeZone,
      count: aggregate.count,
      firstOccurredAt: aggregate.firstOccurredAt,
      lastOccurredAt: aggregate.lastOccurredAt,
      heatAtCompactedAt: aggregate.heatAtNow,
      compactedAt,
    }))
    .sort(compareAggregates)

  return {
    policyVersion: ACTIVITY_HISTORY_POLICY_VERSION,
    timeZone: options.timeZone,
    rawEvents,
    aggregates,
  }
}

/** Returns a deterministic local-calendar bucket without relying on host TZ. */
export function activityBucketKey(
  occurredAt: string | number | Date,
  timeZone: string,
  granularity: ActivityHistoryGranularity,
): string {
  assertTimeZone(timeZone)
  const occurredAtMs = parseDate(occurredAt)
  const localDate = localDateParts(occurredAtMs, timeZone)
  if (granularity === 'day') return formatDateKey(localDate.year, localDate.month, localDate.day)

  const utcDate = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day))
  const daysSinceMonday = (utcDate.getUTCDay() + 6) % 7
  utcDate.setUTCDate(utcDate.getUTCDate() - daysSinceMonday)
  return formatDateKey(utcDate.getUTCFullYear(), utcDate.getUTCMonth() + 1, utcDate.getUTCDate())
}

/** Groups raw events for daily/weekly history UI; invalid timestamps are ignored. */
export function aggregateActivityCounts(
  events: readonly InteractionEvent[],
  timeZone: string,
  granularity: ActivityHistoryGranularity,
  now: string | number | Date = Date.now(),
): ActivityCountBucket[] {
  assertTimeZone(timeZone)
  const nowMs = parseDate(now)
  const buckets = new Map<string, ActivityCountBucket>()
  for (const event of events) {
    if (!heatModelFor(event.type)) continue
    const occurredAtMs = Date.parse(event.occurredAt)
    if (!Number.isFinite(occurredAtMs)) continue
    if (isFutureActivityTimestamp(occurredAtMs, nowMs)) continue
    const bucket = activityBucketKey(occurredAtMs, timeZone, granularity)
    const current = buckets.get(bucket)
    if (!current) {
      buckets.set(bucket, {
        granularity,
        bucket,
        totalCount: 1,
        counts: { [event.type]: 1 },
        firstOccurredAt: event.occurredAt,
        lastOccurredAt: event.occurredAt,
      })
      continue
    }
    current.totalCount += 1
    current.counts[event.type] = (current.counts[event.type] ?? 0) + 1
    current.firstOccurredAt = earlierTimestamp(current.firstOccurredAt, event.occurredAt)
    current.lastOccurredAt = laterTimestamp(current.lastOccurredAt, event.occurredAt)
  }
  return [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket))
}

/** Combines retained raw events and compacted records for a deterministic history view. */
export function aggregateActivityHistoryCounts(
  state: Pick<ActivityHistoryState, 'rawEvents' | 'aggregates' | 'timeZone'>,
  granularity: ActivityHistoryGranularity,
  now: string | number | Date = Date.now(),
): ActivityCountBucket[] {
  const nowMs = parseDate(now)
  const buckets = new Map(
    aggregateActivityCounts(state.rawEvents, state.timeZone, granularity, nowMs)
      .map((bucket) => [bucket.bucket, bucket] as const),
  )
  for (const aggregate of state.aggregates) {
    if (!heatModelFor(aggregate.type)) continue
    if (granularity === 'day' && aggregate.granularity !== 'day') continue
    if (hasFutureAggregateTimestamp(aggregate, nowMs)) continue
    const bucket = granularity === aggregate.granularity
      ? aggregate.bucket
      : activityBucketKey(`${aggregate.bucket}T12:00:00.000Z`, state.timeZone, 'week')
    const current = buckets.get(bucket)
    if (!current) {
      buckets.set(bucket, {
        granularity,
        bucket,
        totalCount: aggregate.count,
        counts: { [aggregate.type]: aggregate.count },
        firstOccurredAt: aggregate.firstOccurredAt,
        lastOccurredAt: aggregate.lastOccurredAt,
      })
      continue
    }
    current.totalCount += aggregate.count
    current.counts[aggregate.type] = (current.counts[aggregate.type] ?? 0) + aggregate.count
    current.firstOccurredAt = earlierTimestamp(current.firstOccurredAt, aggregate.firstOccurredAt)
    current.lastOccurredAt = laterTimestamp(current.lastOccurredAt, aggregate.lastOccurredAt)
  }
  return [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket))
}

/** Computes raw temperature heat from raw and compacted history without loss. */
export function activityRawHeat(
  rawEvents: readonly InteractionEvent[],
  aggregates: readonly ActivityHistoryAggregate[],
  itemId: string,
  now: string | number | Date = Date.now(),
): number {
  const nowMs = parseDate(now)
  let heat = 0
  for (const event of rawEvents) {
    if (event.itemId !== itemId) continue
    const occurredAtMs = Date.parse(event.occurredAt)
    if (!Number.isFinite(occurredAtMs)) continue
    heat += eventHeatAt(event, nowMs)
  }
  for (const aggregate of aggregates) {
    if (aggregate.itemId !== itemId || aggregate.policyVersion !== ACTIVITY_HISTORY_POLICY_VERSION) continue
    if (hasFutureAggregateTimestamp(aggregate, nowMs)) continue
    heat += decayStoredHeat(aggregate, nowMs)
  }
  return heat
}

export function activityScoreFromRawHeat(rawHeat: number): number {
  return Math.max(0, Math.min(1, 1 - Math.exp(-Math.max(0, rawHeat) / 3)))
}

function eventHeatAt(event: InteractionEvent, nowMs: number): number {
  const model = heatModelFor(event.type)
  const occurredAtMs = Date.parse(event.occurredAt)
  if (!model || !Number.isFinite(occurredAtMs)) return 0
  if (isFutureActivityTimestamp(occurredAtMs, nowMs)) return 0
  const ageDays = Math.max(0, nowMs - occurredAtMs) / DAY_MS
  return model.weight * Math.pow(0.5, ageDays / model.halfLifeDays)
}

function decayStoredHeat(aggregate: ActivityHistoryAggregate, nowMs: number): number {
  const model = heatModelFor(aggregate.type)
  if (!model || aggregate.heatAtCompactedAt <= 0) return 0
  const compactedAtMs = Date.parse(aggregate.compactedAt)
  if (!Number.isFinite(compactedAtMs)) return 0
  if (isFutureActivityTimestamp(compactedAtMs, nowMs)) return 0
  const ageDays = Math.max(0, nowMs - compactedAtMs) / DAY_MS
  return aggregate.heatAtCompactedAt * Math.pow(0.5, ageDays / model.halfLifeDays)
}

function heatModelFor(type: InteractionEventType) {
  if (type === 'opened') return ACTIVITY_MODEL.opened
  if (type === 'edited') return ACTIVITY_MODEL.edited
  if (type === 'reviewed') return ACTIVITY_MODEL.reviewed
  return undefined
}

function mergeAggregate(target: Map<string, MutableAggregate>, incoming: MutableAggregate): void {
  const key = aggregateId(incoming)
  const current = target.get(key)
  if (!current) {
    target.set(key, { ...incoming })
    return
  }
  current.count += incoming.count
  current.heatAtNow += incoming.heatAtNow
  current.firstOccurredAt = earlierTimestamp(current.firstOccurredAt, incoming.firstOccurredAt)
  current.lastOccurredAt = laterTimestamp(current.lastOccurredAt, incoming.lastOccurredAt)
}

function aggregateId(aggregate: Pick<
  ActivityHistoryAggregate,
  'itemId' | 'type' | 'granularity' | 'bucket' | 'timeZone'
>): string {
  return [
    `activity-v${ACTIVITY_HISTORY_POLICY_VERSION}`,
    encodeURIComponent(aggregate.itemId),
    aggregate.type,
    aggregate.granularity,
    aggregate.bucket,
    encodeURIComponent(aggregate.timeZone),
  ].join(':')
}

/**
 * True when any of an aggregate's timestamps sits in the future.
 *
 * `compactedAt` drives decay and `lastOccurredAt` drives "recent activity", so a
 * future value in either one is enough to distort the result; the aggregate is
 * dropped as a whole rather than partially trusted.
 */
function hasFutureAggregateTimestamp(aggregate: ActivityHistoryAggregate, nowMs: number): boolean {
  return isFutureActivityTimestamp(Date.parse(aggregate.compactedAt), nowMs)
    || isFutureActivityTimestamp(Date.parse(aggregate.lastOccurredAt), nowMs)
    || isFutureActivityTimestamp(Date.parse(aggregate.firstOccurredAt), nowMs)
}

function isUsableAggregate(
  aggregate: ActivityHistoryAggregate,
  timeZone: string,
  weeklyCutoff: number,
): boolean {
  if (aggregate.policyVersion !== ACTIVITY_HISTORY_POLICY_VERSION || aggregate.timeZone !== timeZone) return false
  if (!Number.isInteger(aggregate.count) || aggregate.count <= 0) return false
  if (!Number.isFinite(aggregate.heatAtCompactedAt) || aggregate.heatAtCompactedAt < 0) return false
  const first = Date.parse(aggregate.firstOccurredAt)
  const last = Date.parse(aggregate.lastOccurredAt)
  const compacted = Date.parse(aggregate.compactedAt)
  return Number.isFinite(first)
    && Number.isFinite(last)
    && Number.isFinite(compacted)
    && first <= last
    && last >= weeklyCutoff
}

function assertPolicy(policy: Readonly<ActivityRetentionPolicy>): void {
  if (policy.version !== ACTIVITY_HISTORY_POLICY_VERSION) {
    throw new RangeError(`Unsupported activity retention policy version: ${policy.version}`)
  }
  const durations = [
    policy.rawRetentionDays,
    policy.dailyRetentionDays,
    policy.weeklyRetentionDays,
    ...Object.values(policy.rawRetentionDaysByType ?? {}),
  ]
  if (durations.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError('Activity retention durations must be finite non-negative numbers')
  }
  if (policy.rawRetentionDays > policy.dailyRetentionDays || policy.dailyRetentionDays > policy.weeklyRetentionDays) {
    throw new RangeError('Activity retention windows must be ordered raw <= daily <= weekly')
  }
  if (Object.values(policy.rawRetentionDaysByType ?? {}).some((value) => value !== undefined && value > policy.weeklyRetentionDays)) {
    throw new RangeError('Per-type raw retention windows cannot exceed weekly retention')
  }
  if (!Number.isInteger(policy.maxRawEventsPerItem) || policy.maxRawEventsPerItem < 0) {
    throw new RangeError('maxRawEventsPerItem must be a non-negative integer')
  }
}

function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0)
  } catch {
    throw new RangeError(`Invalid time zone: ${timeZone}`)
  }
}

function parseNow(value: string | number | Date | undefined): number {
  return value === undefined ? Date.now() : parseDate(value)
}

function parseDate(value: string | number | Date): number {
  const parsed = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(parsed)) throw new RangeError(`Invalid date: ${String(value)}`)
  return parsed
}

function localDateParts(occurredAtMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(occurredAtMs)
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value)
  return { year: part('year'), month: part('month'), day: part('day') }
}

function formatDateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function earlierTimestamp(a: string, b: string): string {
  return Date.parse(a) <= Date.parse(b) ? a : b
}

function laterTimestamp(a: string, b: string): string {
  return Date.parse(a) >= Date.parse(b) ? a : b
}

function compareEventEntriesNewestFirst(
  a: { event: InteractionEvent; occurredAtMs: number },
  b: { event: InteractionEvent; occurredAtMs: number },
): number {
  return b.occurredAtMs - a.occurredAtMs || a.event.id.localeCompare(b.event.id)
}

function compareEventsChronologically(a: InteractionEvent, b: InteractionEvent): number {
  return Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.id.localeCompare(b.id)
}

function compareAggregates(a: ActivityHistoryAggregate, b: ActivityHistoryAggregate): number {
  return a.itemId.localeCompare(b.itemId)
    || a.bucket.localeCompare(b.bucket)
    || a.type.localeCompare(b.type)
    || a.granularity.localeCompare(b.granularity)
}