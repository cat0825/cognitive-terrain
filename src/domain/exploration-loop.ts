import type {
  ExplorationLifecycleItem,
  ExplorationPreviousDecision,
  ExplorationReasonCode,
  ExplorationSuggestion,
  TerrainProject,
} from './types'
import { buildProjectReferenceGapReport } from './reference-gaps'

export type {
  ExplorationAction,
  ExplorationLifecycleEvent,
  ExplorationLifecycleItem,
  ExplorationPreviousDecision,
  ExplorationReasonCode,
  ExplorationSuggestion,
} from './types'

export const DEFAULT_EXPLORATION_SUGGESTION_LIMIT = 8
export const MAX_EXPLORATION_SUGGESTION_LIMIT = 24
export const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.5
export const DEFAULT_STALE_REVIEW_DAYS = 90

type TerminalExplorationDecision = ExplorationPreviousDecision & {
  status: 'completed' | 'dismissed' | 'rejected'
}

export interface ReferenceGapSignal {
  nodeId: string
  label: string
  state: 'missing' | 'sparse' | 'stale'
  gap: number
  expectedWeight?: number
  supportingItemIds?: readonly string[]
  expectedNodeIds?: readonly string[]
  lastSupportingAt?: string
}

export interface SelectedReferenceSignal {
  atlasId: string
  atlasLabel?: string
  taxonomyVersion?: string | number
  gaps: readonly ReferenceGapSignal[]
}

export interface StaleReviewedItemSignal {
  noteId: string
  title: string
  reviewedAt: string
  noteFingerprint?: string
}

export interface UnresolvedBridgeSignal {
  bridgeId: string
  fromItemId: string
  fromTitle: string
  toItemId?: string
  targetTitle?: string
  evidenceFingerprint?: string
}

export interface NoteAssessmentSignal {
  noteId: string
  title: string
  mastery?: number
  confidence?: number
  noteFingerprint?: string
}

export interface UserMarkedGoalSignal {
  goalId: string
  label: string
  noteId?: string
  priority?: number
  updatedAt?: string
  noteFingerprint?: string
  active?: boolean
}

/**
 * Deliberately excludes activity/temperature scores: attention is not evidence
 * of a gap, weak bridge, assessment need, or user goal.
 */
export interface ExplorationSignals {
  selectedReference?: SelectedReferenceSignal
  staleReviewedItems?: readonly StaleReviewedItemSignal[]
  unresolvedBridges?: readonly UnresolvedBridgeSignal[]
  noteAssessments?: readonly NoteAssessmentSignal[]
  userMarkedGoals?: readonly UserMarkedGoalSignal[]
}

export interface GenerateExplorationSuggestionsOptions {
  limit?: number
  lowConfidenceThreshold?: number
  previousItems?: readonly ExplorationLifecycleItem[]
}

/**
 * Generates a stable, bounded queue from explicit exploration signals only.
 * Terminal decisions are suppressed until their evidence fingerprint changes.
 */
export function generateExplorationSuggestions(
  signals: ExplorationSignals,
  options: GenerateExplorationSuggestionsOptions = {},
): ExplorationSuggestion[] {
  const limit = normalizedLimit(options.limit)
  if (limit === 0) return []
  const lowConfidenceThreshold = options.lowConfidenceThreshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD
  if (!Number.isFinite(lowConfidenceThreshold) || lowConfidenceThreshold < 0 || lowConfidenceThreshold > 1) {
    throw new RangeError('lowConfidenceThreshold must be between 0 and 1')
  }

  const candidates = [
    ...suggestionsFromReference(signals.selectedReference),
    ...suggestionsFromStaleReviews(signals.staleReviewedItems ?? []),
    ...suggestionsFromBridges(signals.unresolvedBridges ?? []),
    ...suggestionsFromAssessments(signals.noteAssessments ?? [], lowConfidenceThreshold),
    ...suggestionsFromGoals(signals.userMarkedGoals ?? []),
  ]
  const deduplicated = new Map<string, ExplorationSuggestion>()
  for (const candidate of candidates) {
    const current = deduplicated.get(candidate.id)
    if (!current || compareSuggestions(candidate, current) < 0) deduplicated.set(candidate.id, candidate)
  }

  return [...deduplicated.values()]
    .flatMap((candidate) => applyPreviousDecisions(candidate, options.previousItems ?? []))
    .sort(compareSuggestions)
    .slice(0, limit)
}

/** Derives only explicit Issue #8 signals from a project; activity score is never consulted. */
export function buildProjectExplorationSignals(
  project: TerrainProject,
  evaluatedAt: string | number | Date,
): ExplorationSignals {
  const evaluatedAtMs = timestampMs(evaluatedAt, 'evaluatedAt')
  const activeNotes = project.notes.filter((note) => note.status !== 'archived')
  const selectedReference = selectedReferenceForProject(project, evaluatedAt)
  const staleReviewedItems = activeNotes.flatMap((note): StaleReviewedItemSignal[] => {
    if (!note.reviewedAt) return []
    const reviewedAtMs = Date.parse(note.reviewedAt)
    if (!Number.isFinite(reviewedAtMs)
      || reviewedAtMs > evaluatedAtMs
      || evaluatedAtMs - reviewedAtMs < DEFAULT_STALE_REVIEW_DAYS * 86_400_000) return []
    return [{
      noteId: note.id,
      title: note.title,
      reviewedAt: new Date(reviewedAtMs).toISOString(),
      noteFingerprint: note.fingerprint,
    }]
  }).sort((left, right) => left.noteId.localeCompare(right.noteId))

  const resolvableTargets = new Set(project.notes.flatMap(noteRelationshipKeys))
  const unresolvedBridges = activeNotes.flatMap((note): UnresolvedBridgeSignal[] => {
    return [...new Set(note.links)]
      .filter((targetTitle) => !resolvableTargets.has(normalizeRelationshipTarget(targetTitle)))
      .map((targetTitle) => ({
      bridgeId: `unresolved-${stableHash(`${note.id}\n${normalizeRelationshipTarget(targetTitle)}`)}`,
      fromItemId: note.id,
      fromTitle: note.title,
      targetTitle,
      evidenceFingerprint: note.fingerprint,
      }))
  }).sort((left, right) => left.bridgeId.localeCompare(right.bridgeId))

  const noteAssessments = activeNotes.map((note): NoteAssessmentSignal => ({
    noteId: note.id,
    title: note.title,
    mastery: note.mastery,
    confidence: note.confidence,
    noteFingerprint: note.fingerprint,
  })).sort((left, right) => left.noteId.localeCompare(right.noteId))

  const cognitiveStateByItem = new Map(project.cognitiveStates.map((state) => [state.itemId, state]))
  const userMarkedGoals = activeNotes
    .filter((note) => note.status === 'gap')
    .map((note): UserMarkedGoalSignal => ({
      goalId: `note-gap-${note.id}`,
      label: `探索「${note.title}」`,
      noteId: note.id,
      priority: 0.75,
      updatedAt: cognitiveStateByItem.get(note.id)?.updatedAt,
      noteFingerprint: note.fingerprint,
    }))
    .sort((left, right) => left.goalId.localeCompare(right.goalId))

  return {
    selectedReference,
    staleReviewedItems,
    unresolvedBridges,
    noteAssessments,
    userMarkedGoals,
  }
}

export function generateProjectExplorationSuggestions(
  project: TerrainProject,
  evaluatedAt: string | number | Date,
  options: GenerateExplorationSuggestionsOptions = {},
): ExplorationSuggestion[] {
  return generateExplorationSuggestions(buildProjectExplorationSignals(project, evaluatedAt), {
    ...options,
    previousItems: options.previousItems ?? project.explorationItems,
  })
}

function suggestionsFromReference(reference: SelectedReferenceSignal | undefined): ExplorationSuggestion[] {
  const atlasId = normalizedId(reference?.atlasId)
  if (!reference || !atlasId) return []
  return reference.gaps.flatMap((gap) => {
    const nodeId = normalizedId(gap.nodeId)
    const label = normalizedText(gap.label)
    if (!nodeId || !label || !Number.isFinite(gap.gap) || gap.gap <= 0) return []
    const supportingItemIds = uniqueIds(gap.supportingItemIds ?? [])
    const evidenceFingerprint = fingerprint({
      kind: 'reference-gap',
      atlasId,
      taxonomyVersion: reference.taxonomyVersion ?? null,
      nodeId,
      state: gap.state,
      gap: clamp(gap.gap, 0, 1),
      expectedWeight: finiteOrNull(gap.expectedWeight),
      supportingItemIds,
      expectedNodeIds: uniqueIds(gap.expectedNodeIds ?? []),
      lastSupportingAt: gap.lastSupportingAt ?? null,
    })
    return [{
      id: suggestionId('reference-gap', `${atlasId}\n${nodeId}`),
      reason: { code: 'reference-gap', detail: `${label} 是相对所选参考图谱的${coverageLabel(gap.state)}` },
      supportingItemIds,
      sourceRoute: { kind: 'reference-node', atlasId, taxonomyNodeId: nodeId },
      evidenceFingerprint,
      priority: 500 + Math.round(clamp(gap.gap, 0, 1) * 60) + Math.round(clamp(gap.expectedWeight ?? 1, 0, 5)),
      action: { title: `检查「${label}」的参考缺口`, detail: '核对参考边界，再决定补充、关联或忽略。' },
      referenceBoundary: {
        atlasId,
        taxonomyNodeId: nodeId,
        label: normalizedOptionalText(reference.atlasLabel),
        taxonomyVersion: reference.taxonomyVersion,
      },
    } satisfies ExplorationSuggestion]
  })
}

function suggestionsFromStaleReviews(signals: readonly StaleReviewedItemSignal[]): ExplorationSuggestion[] {
  return signals.flatMap((signal) => {
    const noteId = normalizedId(signal.noteId)
    const title = normalizedText(signal.title)
    const reviewedAtMs = Date.parse(signal.reviewedAt)
    if (!noteId || !title || !Number.isFinite(reviewedAtMs)) return []
    return [{
      id: suggestionId('stale-reviewed-item', noteId),
      reason: { code: 'stale-reviewed-item', detail: `上次明确复习于 ${new Date(reviewedAtMs).toISOString()}` },
      supportingItemIds: [noteId],
      sourceRoute: { kind: 'note', noteId },
      evidenceFingerprint: fingerprint({
        kind: 'stale-reviewed-item',
        noteId,
        reviewedAt: new Date(reviewedAtMs).toISOString(),
        noteFingerprint: signal.noteFingerprint ?? null,
      }),
      priority: 280,
      action: { title: `复查「${title}」`, detail: '回到原笔记确认内容是否仍然成立。' },
    } satisfies ExplorationSuggestion]
  })
}

function suggestionsFromBridges(signals: readonly UnresolvedBridgeSignal[]): ExplorationSuggestion[] {
  return signals.flatMap((signal) => {
    const bridgeId = normalizedId(signal.bridgeId)
    const fromItemId = normalizedId(signal.fromItemId)
    const fromTitle = normalizedText(signal.fromTitle)
    const toItemId = normalizedId(signal.toItemId)
    const targetTitle = normalizedOptionalText(signal.targetTitle)
    if (!bridgeId || !fromItemId || !fromTitle || (!toItemId && !targetTitle)) return []
    const supportingItemIds = uniqueIds([fromItemId, ...(toItemId ? [toItemId] : [])])
    return [{
      id: suggestionId('unresolved-bridge', bridgeId),
      reason: { code: 'unresolved-bridge', detail: `显式关系尚未解析：${targetTitle ?? toItemId}` },
      supportingItemIds,
      sourceRoute: { kind: 'relationship', bridgeId, fromItemId, toItemId, targetTitle },
      evidenceFingerprint: fingerprint({
        kind: 'unresolved-bridge',
        bridgeId,
        fromItemId,
        toItemId: toItemId ?? null,
        targetTitle: targetTitle ?? null,
        evidenceFingerprint: signal.evidenceFingerprint ?? null,
      }),
      priority: 420,
      action: { title: `处理「${fromTitle}」的未解析关系`, detail: `确认 ${targetTitle ?? toItemId} 的目标或移除无效链接。` },
    } satisfies ExplorationSuggestion]
  })
}

function suggestionsFromAssessments(
  signals: readonly NoteAssessmentSignal[],
  lowConfidenceThreshold: number,
): ExplorationSuggestion[] {
  return signals.flatMap<ExplorationSuggestion>((signal): ExplorationSuggestion[] => {
    const noteId = normalizedId(signal.noteId)
    const title = normalizedText(signal.title)
    if (!noteId || !title) return []
    const mastery = boundedMetric(signal.mastery)
    const confidence = boundedMetric(signal.confidence)
    const commonEvidence = {
      noteId,
      mastery: mastery ?? null,
      confidence: confidence ?? null,
      noteFingerprint: signal.noteFingerprint ?? null,
    }
    if (mastery === undefined || confidence === undefined) {
      return [{
        id: suggestionId('unassessed-note', noteId),
        reason: { code: 'unassessed-note', detail: '缺少明确的 mastery 或 confidence 自评' },
        supportingItemIds: [noteId],
        sourceRoute: { kind: 'note', noteId },
        evidenceFingerprint: fingerprint({ kind: 'unassessed-note', ...commonEvidence }),
        priority: 360,
        action: { title: `评估「${title}」`, detail: '分别记录熟练度与自评置信度，不从活跃度推断。' },
      } satisfies ExplorationSuggestion]
    }
    if (confidence >= lowConfidenceThreshold) return []
    return [{
      id: suggestionId('low-confidence-note', noteId),
      reason: { code: 'low-confidence-note', detail: `自评置信度 ${Math.round(confidence * 100)}%，低于 ${Math.round(lowConfidenceThreshold * 100)}%` },
      supportingItemIds: [noteId],
      sourceRoute: { kind: 'note', noteId },
      evidenceFingerprint: fingerprint({ kind: 'low-confidence-note', threshold: lowConfidenceThreshold, ...commonEvidence }),
      priority: 320 + Math.round((lowConfidenceThreshold - confidence) * 50),
      action: { title: `核验「${title}」`, detail: '回到原笔记补充证据，或更新自评置信度。' },
    } satisfies ExplorationSuggestion]
  })
}

function suggestionsFromGoals(signals: readonly UserMarkedGoalSignal[]): ExplorationSuggestion[] {
  return signals.flatMap((signal) => {
    const goalId = normalizedId(signal.goalId)
    const label = normalizedText(signal.label)
    const noteId = normalizedId(signal.noteId)
    if (!goalId || !label || signal.active === false) return []
    const priority = clamp(Number.isFinite(signal.priority) ? signal.priority! : 0.5, 0, 1)
    return [{
      id: suggestionId('user-marked-goal', goalId),
      reason: { code: 'user-marked-goal', detail: '用户明确标记的探索目标' },
      supportingItemIds: noteId ? [noteId] : [],
      sourceRoute: { kind: 'goal', goalId, noteId },
      evidenceFingerprint: fingerprint({
        kind: 'user-marked-goal',
        goalId,
        label,
        noteId: noteId ?? null,
        priority,
        updatedAt: signal.updatedAt ?? null,
        noteFingerprint: signal.noteFingerprint ?? null,
      }),
      priority: 600 + Math.round(priority * 60),
      action: { title: label, detail: noteId ? '从关联笔记继续这个目标。' : '选择一个来源笔记开始这个目标。' },
    } satisfies ExplorationSuggestion]
  })
}

function selectedReferenceForProject(
  project: TerrainProject,
  evaluatedAt: string | number | Date,
): SelectedReferenceSignal | undefined {
  if (!project.activeReferenceAtlasId) return undefined
  const manifest = project.referenceAtlases?.find((atlas) => atlas.id === project.activeReferenceAtlasId)
  if (!manifest) return undefined
  const report = buildProjectReferenceGapReport(project, manifest.id, evaluatedAt)
  if (!report.enabled) return undefined
  return {
    atlasId: manifest.id,
    atlasLabel: manifest.label,
    taxonomyVersion: manifest.taxonomyVersion,
    gaps: report.gaps.flatMap((gap): ReferenceGapSignal[] => {
      if (gap.state === 'covered') return []
      return [{
        nodeId: gap.nodeId,
        label: gap.label,
        state: gap.state,
        gap: gap.gap,
        expectedWeight: gap.expectedWeight,
        supportingItemIds: gap.supportingItemIds,
        expectedNodeIds: gap.expectedNodeIds,
        lastSupportingAt: gap.lastSupportingAt,
      }]
    }),
  }
}

function applyPreviousDecisions(
  candidate: ExplorationSuggestion,
  previousItems: readonly ExplorationLifecycleItem[],
): ExplorationSuggestion[] {
  const decisions = terminalDecisions(previousItems.filter((item) => item.suggestion.id === candidate.id))
  if (decisions.some((decision) => decision.evidenceFingerprint === candidate.evidenceFingerprint)) return []
  const previousDecision = decisions.sort(compareDecisionsNewestFirst)[0]
  if (!previousDecision) return [candidate]
  return [{
    ...candidate,
    previousDecision,
    reopenReason: {
      code: previousDecision.status === 'completed'
        ? 'fresh-evidence-after-completed'
        : previousDecision.status === 'dismissed'
          ? 'fresh-evidence-after-dismissed'
          : 'fresh-evidence-after-rejected',
      previousEvidenceFingerprint: previousDecision.evidenceFingerprint,
      previousDecidedAt: previousDecision.decidedAt,
    },
  }]
}

function terminalDecisions(items: readonly ExplorationLifecycleItem[]): TerminalExplorationDecision[] {
  const decisions: TerminalExplorationDecision[] = []
  for (const item of items) {
    for (const event of item.history) {
      if (event.toStatus === 'completed' || event.toStatus === 'dismissed' || event.toStatus === 'rejected') {
        decisions.push({
          status: event.toStatus,
          decidedAt: event.occurredAt,
          evidenceFingerprint: event.evidenceFingerprint,
        })
      }
    }
    if ((item.status === 'completed' || item.status === 'dismissed' || item.status === 'rejected')
      && !decisions.some((decision) => decision.status === item.status
        && decision.decidedAt === item.updatedAt
        && decision.evidenceFingerprint === item.suggestion.evidenceFingerprint)) {
      decisions.push({
        status: item.status,
        decidedAt: item.updatedAt,
        evidenceFingerprint: item.suggestion.evidenceFingerprint,
      })
    }
  }
  return decisions
}

function compareSuggestions(left: ExplorationSuggestion, right: ExplorationSuggestion): number {
  return right.priority - left.priority
    || left.reason.code.localeCompare(right.reason.code)
    || left.id.localeCompare(right.id)
    || left.evidenceFingerprint.localeCompare(right.evidenceFingerprint)
}

function compareDecisionsNewestFirst(left: ExplorationPreviousDecision, right: ExplorationPreviousDecision): number {
  const leftMs = Date.parse(left.decidedAt)
  const rightMs = Date.parse(right.decidedAt)
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) return rightMs - leftMs
  return right.decidedAt.localeCompare(left.decidedAt)
}

function normalizedLimit(limit: number | undefined): number {
  const value = limit ?? DEFAULT_EXPLORATION_SUGGESTION_LIMIT
  if (!Number.isInteger(value) || value < 0) throw new RangeError('limit must be a non-negative integer')
  return Math.min(value, MAX_EXPLORATION_SUGGESTION_LIMIT)
}

function normalizeRelationshipTarget(value: string): string {
  return normalizedText(value)
    .replace(/\\/gu, '/')
    .replace(/\.md$/iu, '')
    .replace(/^\.\//u, '')
    .toLocaleLowerCase()
}

function noteRelationshipKeys(note: TerrainProject['notes'][number]): string[] {
  const keys = [normalizeRelationshipTarget(note.title)]
  if (note.sourcePath) {
    keys.push(normalizeRelationshipTarget(note.sourcePath))
    keys.push(normalizeRelationshipTarget(note.sourcePath.split('/').at(-1) ?? note.sourcePath))
  }
  return [...new Set(keys.filter(Boolean))]
}

function coverageLabel(state: ReferenceGapSignal['state']): string {
  if (state === 'missing') return '缺失项'
  if (state === 'sparse') return '稀疏项'
  return '陈旧项'
}

function suggestionId(code: ExplorationReasonCode, subject: string): string {
  return `exploration-${code}-${stableHash(subject)}`
}

function fingerprint(value: unknown): string {
  return `evidence-${stableHash(canonicalJson(value))}`
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function stableHash(value: string): string {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(16).padStart(8, '0')
}

function normalizedId(value: string | undefined): string | undefined {
  return normalizedOptionalText(value)
}

function normalizedText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

function normalizedOptionalText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  return normalizedText(value) || undefined
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values.flatMap((value) => {
    const normalized = normalizedId(value)
    return normalized ? [normalized] : []
  }))].sort()
}

function boundedMetric(value: number | undefined): number | undefined {
  return Number.isFinite(value) && value! >= 0 && value! <= 1 ? value : undefined
}

function finiteOrNull(value: number | undefined): number | null {
  return Number.isFinite(value) ? value! : null
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function timestampMs(value: string | number | Date, field: string): number {
  const parsed = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(parsed)) throw new RangeError(`${field} must be a valid timestamp`)
  return parsed
}
