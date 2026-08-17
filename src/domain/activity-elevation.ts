import { ACTIVITY_HISTORY_POLICY_VERSION, activityRawHeat, activityScoreFromRawHeat } from './activity-history'
import type { ActivityHistoryAggregate } from './activity-history'
import { ACTIVITY_MODEL } from './activity-temperature'
import type { InteractionEvent, InteractionEventType } from './types'

export const ACTIVITY_ELEVATION_FORMULA_VERSION = 'activity-elevation-v1' as const
export const ACTIVITY_ELEVATION_DEFAULT_WINDOW_DAYS = 30
export const ACTIVITY_ELEVATION_DEFAULT_SPARSE_EVENT_COUNT = 3
export const ACTIVITY_ELEVATION_OPEN_DEDUPLICATION_MS = 60_000

export type ActivityHistoryState = 'missing' | 'sparse' | 'stale' | 'active'

export interface ActivityElevationInput {
  itemId: string
  events: readonly InteractionEvent[]
  aggregates?: readonly ActivityHistoryAggregate[]
  /** Required so the same input and timestamp always produce the same result. */
  evaluatedAt: string | number | Date
  windowDays?: number
  sparseEventCount?: number
  formulaVersion?: typeof ACTIVITY_ELEVATION_FORMULA_VERSION
}

export interface ActivityElevationEvidence {
  type: InteractionEventType
  count: number
  rawEventCount: number
  aggregateEventCount: number
  aggregateRecordCount: number
  rawHeat: number
  rawEventHeat: number
  aggregateHeat: number
  lastOccurredAt?: string
  provenance: Array<'raw-event' | 'retained-aggregate'>
}

export interface ActivityElevationResult {
  itemId: string
  formulaVersion: typeof ACTIVITY_ELEVATION_FORMULA_VERSION
  evaluatedAt: string
  elevation: number
  score: number
  rawHeat: number
  historyState: ActivityHistoryState
  /** Deduplicated, supported raw-event inputs. */
  validEventCount: number
  validAggregateCount: number
  aggregateEventCount: number
  recentEventCount: number
  recentAggregateEventCount: number
  suppressedDuplicateEventCount: number
  suppressedDuplicateAggregateCount: number
  latestActivityAt?: string
  evidence: ActivityElevationEvidence[]
}

/**
 * Converts recent activity heat into a normalized terrain elevation. It has no
 * access to layout coordinates: callers can change height only and preserve x/y.
 */
export function calculateActivityElevation(input: ActivityElevationInput): ActivityElevationResult {
  if (input.formulaVersion && input.formulaVersion !== ACTIVITY_ELEVATION_FORMULA_VERSION) {
    throw new RangeError(`Unsupported activity elevation formula: ${input.formulaVersion}`)
  }
  const evaluatedAtMs = parseDate(input.evaluatedAt)
  const evaluatedAt = new Date(evaluatedAtMs).toISOString()
  const windowDays = input.windowDays ?? ACTIVITY_ELEVATION_DEFAULT_WINDOW_DAYS
  const sparseEventCount = input.sparseEventCount ?? ACTIVITY_ELEVATION_DEFAULT_SPARSE_EVENT_COUNT
  if (!Number.isFinite(windowDays) || windowDays <= 0) throw new RangeError('windowDays must be positive')
  if (!Number.isInteger(sparseEventCount) || sparseEventCount < 1) throw new RangeError('sparseEventCount must be positive')

  const cutoff = evaluatedAtMs - windowDays * 86_400_000
  const rawInputs = normalizeRawEvents(input.events, input.itemId, evaluatedAtMs)
  const aggregateInputs = normalizeAggregates(input.aggregates ?? [], input.itemId, evaluatedAtMs)
  const recent = rawInputs.entries.filter((entry) => entry.occurredAtMs >= cutoff)
  const recentAggregates = aggregateInputs.entries.filter((entry) => entry.lastOccurredAtMs >= cutoff)
  const aggregateEventCount = sumCounts(aggregateInputs.entries)
  const recentAggregateEventCount = sumCounts(recentAggregates)
  const latestActivityAt = latestTimestamp([
    ...rawInputs.entries.map(({ event }) => event.occurredAt),
    ...aggregateInputs.entries.map(({ aggregate }) => aggregate.lastOccurredAt),
  ])
  const rawEvents = rawInputs.entries.map(({ event }) => event)
  const aggregates = aggregateInputs.entries.map(({ aggregate }) => aggregate)
  const rawHeat = activityRawHeat(rawEvents, aggregates, input.itemId, evaluatedAtMs)
  const score = activityScoreFromRawHeat(rawHeat)
  const recentEventCount = recent.length + recentAggregateEventCount
  const historyState: ActivityHistoryState = rawEvents.length === 0 && aggregates.length === 0
    ? 'missing'
    : recentEventCount === 0
      ? 'stale'
      : recentEventCount < sparseEventCount
        ? 'sparse'
        : 'active'
  return {
    itemId: input.itemId,
    formulaVersion: ACTIVITY_ELEVATION_FORMULA_VERSION,
    evaluatedAt,
    elevation: score,
    score,
    rawHeat,
    historyState,
    validEventCount: rawEvents.length,
    validAggregateCount: aggregates.length,
    aggregateEventCount,
    recentEventCount,
    recentAggregateEventCount,
    suppressedDuplicateEventCount: rawInputs.suppressedDuplicateCount,
    suppressedDuplicateAggregateCount: aggregateInputs.suppressedDuplicateCount,
    latestActivityAt,
    evidence: buildEvidence(rawInputs.entries, aggregateInputs.entries, evaluatedAtMs),
  }
}

function buildEvidence(
  rawEntries: Array<{ event: InteractionEvent; occurredAtMs: number }>,
  aggregateEntries: Array<{ aggregate: ActivityHistoryAggregate; lastOccurredAtMs: number }>,
  nowMs: number,
): ActivityElevationEvidence[] {
  const evidence = new Map<InteractionEventType, ActivityElevationEvidence>()
  for (const { event, occurredAtMs } of rawEntries) {
    const current = evidence.get(event.type) ?? emptyEvidence(event.type)
    const heat = activityRawHeat([event], [], event.itemId, nowMs)
    current.count += 1
    current.rawEventCount += 1
    current.rawHeat += heat
    current.rawEventHeat += heat
    if (!current.lastOccurredAt || occurredAtMs > Date.parse(current.lastOccurredAt)) current.lastOccurredAt = event.occurredAt
    if (!current.provenance.includes('raw-event')) current.provenance.push('raw-event')
    evidence.set(event.type, current)
  }
  for (const { aggregate, lastOccurredAtMs } of aggregateEntries) {
    const current = evidence.get(aggregate.type) ?? emptyEvidence(aggregate.type)
    const heat = activityRawHeat([], [aggregate], aggregate.itemId, nowMs)
    current.count += aggregate.count
    current.aggregateEventCount += aggregate.count
    current.aggregateRecordCount += 1
    current.rawHeat += heat
    current.aggregateHeat += heat
    if (!current.lastOccurredAt || lastOccurredAtMs > Date.parse(current.lastOccurredAt)) current.lastOccurredAt = aggregate.lastOccurredAt
    if (!current.provenance.includes('retained-aggregate')) current.provenance.push('retained-aggregate')
    evidence.set(aggregate.type, current)
  }
  return [...evidence.values()].sort((a, b) => a.type.localeCompare(b.type))
}

function emptyEvidence(type: InteractionEventType): ActivityElevationEvidence {
  return {
    type,
    count: 0,
    rawEventCount: 0,
    aggregateEventCount: 0,
    aggregateRecordCount: 0,
    rawHeat: 0,
    rawEventHeat: 0,
    aggregateHeat: 0,
    provenance: [],
  }
}

function normalizeRawEvents(
  events: readonly InteractionEvent[],
  itemId: string,
  evaluatedAtMs: number,
): {
  entries: Array<{ event: InteractionEvent; occurredAtMs: number }>
  suppressedDuplicateCount: number
} {
  const candidates = events
    .map((event) => ({ event, occurredAtMs: Date.parse(event.occurredAt) }))
    .filter((entry) => entry.event.itemId === itemId
      && Boolean(modelFor(entry.event.type))
      && Number.isFinite(entry.occurredAtMs)
      && entry.occurredAtMs <= evaluatedAtMs)
    .sort(compareRawEntries)
  const seenIds = new Set<string>()
  const unique: typeof candidates = []
  let suppressedDuplicateCount = 0
  for (const candidate of candidates) {
    if (seenIds.has(candidate.event.id)) {
      suppressedDuplicateCount += 1
      continue
    }
    seenIds.add(candidate.event.id)
    unique.push(candidate)
  }

  const entries: typeof candidates = []
  let latestRetainedOpenedAt = Number.NEGATIVE_INFINITY
  for (const entry of unique) {
    if (entry.event.type === 'opened') {
      if (entry.occurredAtMs - latestRetainedOpenedAt < ACTIVITY_ELEVATION_OPEN_DEDUPLICATION_MS) {
        suppressedDuplicateCount += 1
        continue
      }
      latestRetainedOpenedAt = entry.occurredAtMs
    }
    entries.push(entry)
  }
  return { entries, suppressedDuplicateCount }
}

function normalizeAggregates(
  aggregates: readonly ActivityHistoryAggregate[],
  itemId: string,
  evaluatedAtMs: number,
): {
  entries: Array<{ aggregate: ActivityHistoryAggregate; lastOccurredAtMs: number }>
  suppressedDuplicateCount: number
} {
  const candidates = aggregates
    .map((aggregate) => ({
      aggregate,
      firstOccurredAtMs: Date.parse(aggregate.firstOccurredAt),
      lastOccurredAtMs: Date.parse(aggregate.lastOccurredAt),
      compactedAtMs: Date.parse(aggregate.compactedAt),
    }))
    .filter((entry) => entry.aggregate.itemId === itemId
      && entry.aggregate.policyVersion === ACTIVITY_HISTORY_POLICY_VERSION
      && Boolean(modelFor(entry.aggregate.type))
      && Number.isInteger(entry.aggregate.count)
      && entry.aggregate.count > 0
      && Number.isFinite(entry.aggregate.heatAtCompactedAt)
      && entry.aggregate.heatAtCompactedAt >= 0
      && Number.isFinite(entry.firstOccurredAtMs)
      && Number.isFinite(entry.lastOccurredAtMs)
      && Number.isFinite(entry.compactedAtMs)
      && entry.firstOccurredAtMs <= entry.lastOccurredAtMs
      && entry.lastOccurredAtMs <= entry.compactedAtMs
      && entry.lastOccurredAtMs <= evaluatedAtMs
      && entry.compactedAtMs <= evaluatedAtMs)
    .sort((a, b) => a.aggregate.id.localeCompare(b.aggregate.id))
  const seenIds = new Set<string>()
  const entries: Array<{ aggregate: ActivityHistoryAggregate; lastOccurredAtMs: number }> = []
  let suppressedDuplicateCount = 0
  for (const candidate of candidates) {
    if (seenIds.has(candidate.aggregate.id)) {
      suppressedDuplicateCount += 1
      continue
    }
    seenIds.add(candidate.aggregate.id)
    entries.push({ aggregate: candidate.aggregate, lastOccurredAtMs: candidate.lastOccurredAtMs })
  }
  return { entries, suppressedDuplicateCount }
}

function compareRawEntries(
  a: { event: InteractionEvent; occurredAtMs: number },
  b: { event: InteractionEvent; occurredAtMs: number },
): number {
  return a.occurredAtMs - b.occurredAtMs
    || a.event.id.localeCompare(b.event.id)
    || a.event.type.localeCompare(b.event.type)
}

function sumCounts(entries: Array<{ aggregate: ActivityHistoryAggregate }>): number {
  return entries.reduce((total, { aggregate }) => total + aggregate.count, 0)
}

function modelFor(type: InteractionEventType) {
  if (type === 'opened') return ACTIVITY_MODEL.opened
  if (type === 'edited') return ACTIVITY_MODEL.edited
  if (type === 'reviewed') return ACTIVITY_MODEL.reviewed
  return undefined
}

function latestTimestamp(values: string[]): string | undefined {
  return values.filter((value) => Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(b) - Date.parse(a))[0]
}

function parseDate(value: string | number | Date): number {
  const parsed = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(parsed)) throw new RangeError(`Invalid timestamp: ${String(value)}`)
  return parsed
}
