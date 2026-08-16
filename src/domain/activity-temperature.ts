import type { InteractionEvent, TerrainNote } from './types'
import type { ActivityHistoryAggregate } from './activity-history'

export interface NoteActivitySummary {
  itemId: string
  score: number
  rawHeat: number
  totalCount: number
  openedCount: number
  editedCount: number
  reviewedCount: number
  lastActivityAt?: string
}

export const ACTIVITY_MODEL = {
  opened: { weight: 1, halfLifeDays: 7 },
  edited: { weight: 3, halfLifeDays: 30 },
  reviewed: { weight: 2.5, halfLifeDays: 14 },
} as const

export const TEMPERATURE_COLORS = {
  cold: '#5d6971',
  warm: '#d7c27e',
  hot: '#e46f51',
} as const

const DAY_MS = 24 * 60 * 60 * 1000
const OPEN_DEDUPLICATION_MS = 60 * 1000

export function buildActivitySummaries(
  notes: readonly Pick<TerrainNote, 'id'>[],
  events: readonly InteractionEvent[],
  nowMs = Date.now(),
  aggregates: readonly ActivityHistoryAggregate[] = [],
): Map<string, NoteActivitySummary> {
  const summaries = new Map(notes.map((note) => [note.id, emptySummary(note.id)]))

  for (const event of events) {
    const model = activityModelFor(event)
    const summary = summaries.get(event.itemId)
    const occurredAtMs = Date.parse(event.occurredAt)
    if (!model || !summary || !Number.isFinite(occurredAtMs)) continue

    const ageDays = Math.max(0, nowMs - occurredAtMs) / DAY_MS
    summary.rawHeat += model.weight * Math.pow(0.5, ageDays / model.halfLifeDays)
    summary.totalCount += 1
    if (event.type === 'opened') summary.openedCount += 1
    if (event.type === 'edited') summary.editedCount += 1
    if (event.type === 'reviewed') summary.reviewedCount += 1
    if (!summary.lastActivityAt || occurredAtMs > Date.parse(summary.lastActivityAt)) {
      summary.lastActivityAt = event.occurredAt
    }
  }

  for (const aggregate of aggregates) {
    const model = activityModelForType(aggregate.type)
    const summary = summaries.get(aggregate.itemId)
    const compactedAtMs = Date.parse(aggregate.compactedAt)
    if (!model || !summary || !Number.isFinite(compactedAtMs)) continue
    const ageDays = Math.max(0, nowMs - compactedAtMs) / DAY_MS
    summary.rawHeat += aggregate.heatAtCompactedAt * Math.pow(0.5, ageDays / model.halfLifeDays)
    summary.totalCount += aggregate.count
    if (aggregate.type === 'opened') summary.openedCount += aggregate.count
    if (aggregate.type === 'edited') summary.editedCount += aggregate.count
    if (aggregate.type === 'reviewed') summary.reviewedCount += aggregate.count
    const lastOccurredAtMs = Date.parse(aggregate.lastOccurredAt)
    if (!summary.lastActivityAt || (Number.isFinite(lastOccurredAtMs) && lastOccurredAtMs > Date.parse(summary.lastActivityAt))) {
      summary.lastActivityAt = aggregate.lastOccurredAt
    }
  }

  for (const summary of summaries.values()) {
    summary.score = clamp01(1 - Math.exp(-summary.rawHeat / 3))
  }
  return summaries
}

export function shouldRecordOpenedEvent(
  events: readonly InteractionEvent[],
  itemId: string,
  occurredAt: string,
  minimumIntervalMs = OPEN_DEDUPLICATION_MS,
): boolean {
  const occurredAtMs = Date.parse(occurredAt)
  if (!Number.isFinite(occurredAtMs)) return false

  let latestOpenedAt = Number.NEGATIVE_INFINITY
  for (const event of events) {
    if (event.itemId !== itemId || event.type !== 'opened') continue
    const eventAt = Date.parse(event.occurredAt)
    if (Number.isFinite(eventAt)) latestOpenedAt = Math.max(latestOpenedAt, eventAt)
  }
  return occurredAtMs - latestOpenedAt >= minimumIntervalMs
}

export function temperatureColor(score: number): string {
  const value = clamp01(score)
  if (value <= 0.5) return mixHex(TEMPERATURE_COLORS.cold, TEMPERATURE_COLORS.warm, value * 2)
  return mixHex(TEMPERATURE_COLORS.warm, TEMPERATURE_COLORS.hot, (value - 0.5) * 2)
}

function emptySummary(itemId: string): NoteActivitySummary {
  return {
    itemId,
    score: 0,
    rawHeat: 0,
    totalCount: 0,
    openedCount: 0,
    editedCount: 0,
    reviewedCount: 0,
  }
}

function activityModelFor(event: InteractionEvent) {
  return activityModelForType(event.type)
}

function activityModelForType(type: InteractionEvent['type']) {
  if (type === 'opened') return ACTIVITY_MODEL.opened
  if (type === 'edited') return ACTIVITY_MODEL.edited
  if (type === 'reviewed') return ACTIVITY_MODEL.reviewed
  return undefined
}

function mixHex(from: string, to: string, amount: number): string {
  const a = hexRgb(from)
  const b = hexRgb(to)
  const t = clamp01(amount)
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`
}

function hexRgb(value: string): [number, number, number] {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ]
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}