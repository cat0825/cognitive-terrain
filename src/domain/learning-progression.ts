import type {
  CognitiveObservation,
  CognitiveObservationProvenance,
  CognitiveState,
  LearningProgressionProfileVersion,
  TerrainProject,
} from './types'

export const DEFAULT_LEARNING_PROGRESSION_PROFILE_VERSION = 'learning-progression-v1' as const
export const LEARNING_PROGRESSION_OBSERVATION_SCHEMA_VERSION = 1 as const
export const MAX_COGNITIVE_OBSERVATIONS_PER_ITEM_FIELD = 256

export type LearningProgressionField = 'mastery' | 'confidence' | 'exploration'
export type LearningProgressionHistoryState = 'missing' | 'snapshot-only' | 'sparse' | 'observed' | 'stale' | 'conflicting'

export interface LearningProgressionInput {
  itemId: string
  field?: LearningProgressionField
  observations: readonly CognitiveObservation[]
  snapshot?: CognitiveState
  evaluatedAt: string | number | Date
  profileVersion?: LearningProgressionProfileVersion
}

export interface LearningProgressionResult {
  itemId: string
  field: LearningProgressionField
  profileVersion: LearningProgressionProfileVersion
  evaluatedAt: string
  elevation: number
  value?: number
  uncertainty: number
  historyState: LearningProgressionHistoryState
  observationCount: number
  latestObservationAt?: string
  evidence: CognitiveObservation[]
}

type WithoutObservationVersion<T> = T extends CognitiveObservation ? Omit<T, 'schemaVersion'> : never
export type CognitiveObservationInput = WithoutObservationVersion<CognitiveObservation>

interface ProgressionProfile {
  neutralElevation: number
  staleAfterDays: number
  decay: { kind: 'none' } | { kind: 'linear'; ratePerDay: number; floor: number }
}

const PROFILES: Record<LearningProgressionProfileVersion, ProgressionProfile> = {
  'learning-progression-v1': {
    neutralElevation: 0.5,
    staleAfterDays: 180,
    decay: { kind: 'none' },
  },
  'learning-progression-linear-decay-v1': {
    neutralElevation: 0.5,
    staleAfterDays: 180,
    decay: { kind: 'linear', ratePerDay: 0.001, floor: 0.1 },
  },
}

const EXPLICIT_TIME_ZONE_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/i
const COGNITIVE_OBSERVATION_PROVENANCES: readonly CognitiveObservationProvenance[] = [
  'self-assessment',
  'yaml-import',
  'review-outcome',
  'migration',
]
const COGNITIVE_OBSERVATION_STATUSES = ['seed', 'growing', 'stable', 'gap', 'archived'] as const

/**
 * Replays only explicit cognitive observations. Activity events are deliberately
 * absent from this API, so opening or editing a note cannot become learning evidence.
 * The result contains elevation only; semantic x/y coordinates are never read or changed.
 */
export function calculateLearningProgression(input: LearningProgressionInput): LearningProgressionResult {
  const field = input.field ?? 'mastery'
  const profileVersion = input.profileVersion ?? DEFAULT_LEARNING_PROGRESSION_PROFILE_VERSION
  const profile = PROFILES[profileVersion]
  if (!profile) throw new RangeError(`Unsupported learning progression profile: ${String(profileVersion)}`)
  const evaluatedAtMs = parseTimestamp(input.evaluatedAt)
  const evaluatedAt = new Date(evaluatedAtMs).toISOString()
  const evidence = numericEvidence(input.observations, input.itemId, field, evaluatedAtMs)

  if (evidence.length === 0) {
    const snapshotValue = snapshotValueAt(input.snapshot, input.itemId, field, evaluatedAtMs)
    return {
      itemId: input.itemId,
      field,
      profileVersion,
      evaluatedAt,
      elevation: snapshotValue ?? profile.neutralElevation,
      value: snapshotValue,
      uncertainty: 1,
      historyState: snapshotValue === undefined ? 'missing' : 'snapshot-only',
      observationCount: 0,
      evidence: [],
    }
  }

  const latest = evidence.at(-1)!
  const latestAtMs = Date.parse(latest.observedAt)
  const ageDays = Math.max(0, (evaluatedAtMs - latestAtMs) / 86_400_000)
  const value = applyDecay(latest.value as number, ageDays, profile.decay)
  const conflict = evidence.some((observation, index) => {
    if (index === 0) return false
    const previous = evidence[index - 1]
    return previous.observedAt === observation.observedAt && previous.value !== observation.value
  })
  const historyState: LearningProgressionHistoryState = conflict
    ? 'conflicting'
    : ageDays > profile.staleAfterDays
      ? 'stale'
      : evidence.length < 2
        ? 'sparse'
        : 'observed'

  return {
    itemId: input.itemId,
    field,
    profileVersion,
    evaluatedAt,
    elevation: value,
    value,
    uncertainty: uncertaintyFor(latest.provenance, ageDays, profile.staleAfterDays, conflict),
    historyState,
    observationCount: evidence.length,
    latestObservationAt: latest.observedAt,
    evidence,
  }
}

/**
 * Project-level entry point that deliberately reads cognitive observations and
 * snapshots only. Interaction history is not part of learning progression.
 */
export function calculateProjectLearningProgression(
  project: Pick<
    TerrainProject,
    'cognitiveObservations' | 'cognitiveStates' | 'learningProgressionProfileVersion'
  >,
  itemId: string,
  evaluatedAt: LearningProgressionInput['evaluatedAt'],
  field: LearningProgressionField = 'mastery',
): LearningProgressionResult {
  return calculateLearningProgression({
    itemId,
    field,
    observations: project.cognitiveObservations ?? [],
    snapshot: project.cognitiveStates.find((state) => state.itemId === itemId),
    evaluatedAt,
    profileVersion: project.learningProgressionProfileVersion,
  })
}

export function normalizeCognitiveObservations(
  observations: readonly CognitiveObservation[] | undefined,
): CognitiveObservation[] {
  if (!observations?.length) return []
  const ids = new Set<string>()
  const grouped = new Map<string, CognitiveObservation[]>()
  for (const observation of observations) {
    const normalized = normalizeObservation(observation)
    if (ids.has(observation.id)) throw new Error(`duplicate cognitive observation id: ${observation.id}`)
    ids.add(observation.id)
    const key = `${observation.itemId}\u0000${observation.field}`
    const entries = grouped.get(key) ?? []
    entries.push(normalized)
    grouped.set(key, entries)
  }
  return [...grouped.values()]
    .flatMap((entries) => entries
      .sort(compareObservations)
      .slice(-MAX_COGNITIVE_OBSERVATIONS_PER_ITEM_FIELD))
    .sort(compareObservations)
}

export function createCognitiveObservation(
  observation: CognitiveObservationInput,
): CognitiveObservation {
  const result = {
    ...observation,
    schemaVersion: LEARNING_PROGRESSION_OBSERVATION_SCHEMA_VERSION,
  } as CognitiveObservation
  return normalizeObservation(result)
}

function numericEvidence(
  observations: readonly CognitiveObservation[],
  itemId: string,
  field: LearningProgressionField,
  evaluatedAtMs: number,
): CognitiveObservation[] {
  const seenIds = new Set<string>()
  return observations
    .filter((observation) => observation.itemId === itemId && observation.field === field)
    .filter((observation) => {
      const observedAtMs = parseExplicitTimestampOrUndefined(observation.observedAt)
      const valid = observation.schemaVersion === LEARNING_PROGRESSION_OBSERVATION_SCHEMA_VERSION
        && observedAtMs !== undefined
        && observedAtMs <= evaluatedAtMs
        && typeof observation.value === 'number'
        && Number.isFinite(observation.value)
        && observation.value >= 0
        && observation.value <= 1
        && Boolean(observation.reason.trim())
        && !seenIds.has(observation.id)
      if (valid) seenIds.add(observation.id)
      return valid
    })
    .map((observation) => ({
      ...observation,
      observedAt: new Date(parseExplicitTimestampOrUndefined(observation.observedAt)!).toISOString(),
    }))
    .sort(compareObservations)
}

function snapshotValueAt(
  snapshot: CognitiveState | undefined,
  itemId: string,
  field: LearningProgressionField,
  evaluatedAtMs: number,
): number | undefined {
  const updatedAtMs = snapshot ? Date.parse(snapshot.updatedAt) : Number.NaN
  if (!snapshot || snapshot.itemId !== itemId || !Number.isFinite(updatedAtMs) || updatedAtMs > evaluatedAtMs) {
    return undefined
  }
  const value = snapshot[field]
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value) : undefined
}

function normalizeObservation(observation: CognitiveObservation): CognitiveObservation {
  validateObservation(observation)
  return {
    ...observation,
    observedAt: new Date(parseTimestamp(observation.observedAt)).toISOString(),
    ...(observation.field === 'reviewedAt'
      ? { value: new Date(parseTimestamp(observation.value)).toISOString() }
      : {}),
  } as CognitiveObservation
}

function validateObservation(observation: CognitiveObservation): void {
  if (observation.schemaVersion !== LEARNING_PROGRESSION_OBSERVATION_SCHEMA_VERSION) {
    throw new RangeError(`Unsupported cognitive observation schema: ${String(observation.schemaVersion)}`)
  }
  if (!observation.id.trim() || !observation.itemId.trim()) throw new Error('cognitive observation requires id and itemId')
  parseTimestamp(observation.observedAt)
  if (!observation.reason.trim()) throw new Error(`cognitive observation ${observation.id} requires a reason`)
  if (!COGNITIVE_OBSERVATION_PROVENANCES.includes(observation.provenance)) {
    throw new RangeError(`Unsupported cognitive observation provenance: ${String(observation.provenance)}`)
  }
  if (observation.field === 'mastery' || observation.field === 'confidence' || observation.field === 'exploration') {
    if (!Number.isFinite(observation.value) || observation.value < 0 || observation.value > 1) {
      throw new RangeError(`cognitive observation ${observation.id} requires a value between 0 and 1`)
    }
  } else if (observation.field === 'status') {
    if (!COGNITIVE_OBSERVATION_STATUSES.includes(observation.value)) {
      throw new RangeError(`Unsupported cognitive observation status: ${String(observation.value)}`)
    }
  } else if (observation.field === 'reviewedAt') {
    parseTimestamp(observation.value)
  } else {
    throw new RangeError(`Unsupported cognitive observation field: ${String((observation as { field: unknown }).field)}`)
  }
}

function compareObservations(a: CognitiveObservation, b: CognitiveObservation): number {
  return Date.parse(a.observedAt) - Date.parse(b.observedAt)
    || compareStrings(a.id, b.id)
    || compareStrings(a.field, b.field)
}

function applyDecay(value: number, ageDays: number, decay: ProgressionProfile['decay']): number {
  if (decay.kind === 'none') return clamp(value)
  return clamp(Math.max(decay.floor, value - ageDays * decay.ratePerDay))
}

function uncertaintyFor(
  provenance: CognitiveObservationProvenance,
  ageDays: number,
  staleAfterDays: number,
  conflicting: boolean,
): number {
  const base = provenance === 'review-outcome'
    ? 0.15
    : provenance === 'yaml-import'
      ? 0.35
      : provenance === 'self-assessment'
        ? 0.55
        : 0.8
  const stalePenalty = Math.min(0.25, (ageDays / staleAfterDays) * 0.25)
  return clamp(base + stalePenalty + (conflicting ? 0.2 : 0))
}

function parseTimestamp(value: string | number | Date): number {
  if (typeof value === 'string' && !EXPLICIT_TIME_ZONE_PATTERN.test(value)) {
    throw new RangeError(`Timestamp must include an explicit time zone: ${value}`)
  }
  const parsed = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(parsed)) throw new RangeError(`Invalid timestamp: ${String(value)}`)
  return parsed
}

function parseExplicitTimestampOrUndefined(value: string): number | undefined {
  if (!EXPLICIT_TIME_ZONE_PATTERN.test(value)) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}
