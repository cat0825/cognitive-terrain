import type {
  ExplorationAction,
  ExplorationLifecycleEvent,
  ExplorationLifecycleItem,
  ExplorationLifecycleStatus,
  ExplorationSuggestion,
} from './types'

export type ExplorationCommand =
  | { type: 'edit'; occurredAt: string; action?: Partial<ExplorationAction>; userNotes?: string; note?: string }
  | { type: 'accept'; occurredAt: string; note?: string }
  | { type: 'start'; occurredAt: string; note?: string }
  | { type: 'complete'; occurredAt: string; userNotes?: string; note?: string }
  | { type: 'snooze'; occurredAt: string; snoozedUntil: string; note?: string }
  | { type: 'dismiss'; occurredAt: string; note?: string }
  | { type: 'reject'; occurredAt: string; note?: string }

export function createExplorationItem(
  suggestion: ExplorationSuggestion,
  occurredAt: string,
): ExplorationLifecycleItem {
  const updatedAt = validTimestamp(occurredAt, 'occurredAt')
  return {
    id: suggestion.id,
    suggestion: cloneSuggestion(suggestion),
    status: 'proposed',
    action: { ...suggestion.action },
    updatedAt,
    history: [],
  }
}

/** Reopens terminal work only when the generator has attached fresh-evidence provenance. */
export function reopenExplorationItem(
  item: ExplorationLifecycleItem,
  suggestion: ExplorationSuggestion,
  occurredAt: string,
): ExplorationLifecycleItem {
  if (item.status !== 'completed' && item.status !== 'dismissed' && item.status !== 'rejected') {
    throw new Error(`Cannot reopen an exploration item in ${item.status} state`)
  }
  if (item.suggestion.id !== suggestion.id) throw new Error('Cannot reopen an exploration item with a different suggestion id')
  if (item.suggestion.evidenceFingerprint === suggestion.evidenceFingerprint) {
    throw new Error('Cannot reopen an exploration item from unchanged evidence')
  }
  if (!suggestion.reopenReason || !suggestion.previousDecision) {
    throw new Error('Cannot reopen an exploration item without fresh-evidence provenance')
  }
  const updatedAt = validTimestamp(occurredAt, 'occurredAt')
  if (Date.parse(updatedAt) < Date.parse(item.updatedAt)) {
    throw new RangeError('Reopen time cannot predate the current item state')
  }
  return {
    ...item,
    suggestion: cloneSuggestion(suggestion),
    status: 'proposed',
    action: { ...suggestion.action },
    snoozedUntil: undefined,
    updatedAt,
  }
}

/** Pure lifecycle reducer. Invalid state transitions throw instead of silently succeeding. */
export function reduceExplorationLifecycle(
  item: ExplorationLifecycleItem,
  command: ExplorationCommand,
): ExplorationLifecycleItem {
  const occurredAt = validTimestamp(command.occurredAt, 'occurredAt')
  if (Date.parse(occurredAt) < Date.parse(item.updatedAt)) {
    throw new RangeError('Exploration commands cannot predate the current item state')
  }
  if (command.type === 'edit') return editItem(item, command, occurredAt)

  const nextStatus = transitionStatus(item.status, command.type)
  let snoozedUntil: string | undefined
  if (command.type === 'snooze') {
    snoozedUntil = validTimestamp(command.snoozedUntil, 'snoozedUntil')
    if (Date.parse(snoozedUntil) <= Date.parse(occurredAt)) {
      throw new RangeError('snoozedUntil must be later than occurredAt')
    }
  }
  const userNotes = 'userNotes' in command && command.userNotes !== undefined
    ? normalizedOptionalText(command.userNotes)
    : item.userNotes
  const event = lifecycleEvent(item, command.type, nextStatus, occurredAt, {
    note: command.note,
    snoozedUntil,
  })
  return {
    ...item,
    status: nextStatus,
    updatedAt: occurredAt,
    userNotes,
    snoozedUntil,
    lastExploredAt: command.type === 'complete' ? occurredAt : item.lastExploredAt,
    history: [...item.history, event],
  }
}

function editItem(
  item: ExplorationLifecycleItem,
  command: Extract<ExplorationCommand, { type: 'edit' }>,
  occurredAt: string,
): ExplorationLifecycleItem {
  if (item.status === 'completed' || item.status === 'rejected') {
    throw new Error(`Cannot edit an exploration item in ${item.status} state`)
  }
  const title = command.action?.title === undefined ? item.action.title : normalizedText(command.action.title)
  if (!title) throw new RangeError('Exploration action title cannot be empty')
  const action = {
    title,
    detail: command.action?.detail === undefined
      ? item.action.detail
      : normalizedOptionalText(command.action.detail),
  }
  const userNotes = command.userNotes === undefined
    ? item.userNotes
    : normalizedOptionalText(command.userNotes)
  const event = lifecycleEvent(item, command.type, item.status, occurredAt, {
    note: command.note,
    action,
  })
  return {
    ...item,
    action,
    userNotes,
    updatedAt: occurredAt,
    history: [...item.history, event],
  }
}

function transitionStatus(
  status: ExplorationLifecycleStatus,
  command: Exclude<ExplorationCommand['type'], 'edit'>,
): ExplorationLifecycleStatus {
  const allowed: Record<Exclude<ExplorationCommand['type'], 'edit'>, readonly ExplorationLifecycleStatus[]> = {
    accept: ['proposed', 'snoozed', 'dismissed'],
    start: ['accepted'],
    complete: ['accepted', 'in-progress'],
    snooze: ['proposed', 'accepted', 'in-progress'],
    dismiss: ['proposed', 'accepted', 'in-progress', 'snoozed'],
    reject: ['proposed', 'accepted', 'in-progress', 'snoozed', 'dismissed'],
  }
  if (!allowed[command].includes(status)) throw new Error(`Cannot ${command} an exploration item in ${status} state`)
  return {
    accept: 'accepted',
    start: 'in-progress',
    complete: 'completed',
    snooze: 'snoozed',
    dismiss: 'dismissed',
    reject: 'rejected',
  }[command] as ExplorationLifecycleStatus
}

function lifecycleEvent(
  item: ExplorationLifecycleItem,
  type: ExplorationCommand['type'],
  toStatus: ExplorationLifecycleStatus,
  occurredAt: string,
  patch: Pick<ExplorationLifecycleEvent, 'note' | 'action' | 'snoozedUntil'>,
): ExplorationLifecycleEvent {
  const sequence = item.history.length + 1
  return {
    id: `exploration-event-${stableHash(`${item.id}\n${sequence}\n${type}\n${occurredAt}`)}`,
    type,
    occurredAt,
    fromStatus: item.status,
    toStatus,
    evidenceFingerprint: item.suggestion.evidenceFingerprint,
    note: normalizedOptionalText(patch.note),
    action: patch.action,
    snoozedUntil: patch.snoozedUntil,
  }
}

function cloneSuggestion(suggestion: ExplorationSuggestion): ExplorationSuggestion {
  return {
    ...suggestion,
    reason: { ...suggestion.reason },
    supportingItemIds: [...suggestion.supportingItemIds],
    sourceRoute: { ...suggestion.sourceRoute },
    action: { ...suggestion.action },
    referenceBoundary: suggestion.referenceBoundary ? { ...suggestion.referenceBoundary } : undefined,
    reopenReason: suggestion.reopenReason ? { ...suggestion.reopenReason } : undefined,
    previousDecision: suggestion.previousDecision ? { ...suggestion.previousDecision } : undefined,
  }
}

function normalizedText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

function normalizedOptionalText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  return normalizedText(value) || undefined
}

function validTimestamp(value: string, field: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new RangeError(`${field} must be a valid timestamp`)
  return new Date(parsed).toISOString()
}

function stableHash(value: string): string {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(16).padStart(8, '0')
}
