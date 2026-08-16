import type {
  CognitiveState,
  CognitiveStateProvenance,
  InteractionEvent,
  InteractionEventType,
  TerrainNote,
  TerrainProject,
} from './types'

export function cognitiveStateFromNote(
  note: TerrainNote,
  provenance: CognitiveStateProvenance,
  updatedAt: string,
): CognitiveState | undefined {
  if (
    note.mastery === undefined
    && note.confidence === undefined
    && note.exploration === undefined
    && note.status === undefined
    && note.reviewedAt === undefined
  ) return undefined

  return {
    itemId: note.id,
    mastery: note.mastery,
    confidence: note.confidence,
    exploration: note.exploration,
    status: note.status,
    reviewedAt: note.reviewedAt,
    updatedAt,
    provenance,
  }
}

export function createInteractionEvent(
  itemId: string,
  type: InteractionEventType,
  occurredAt = new Date().toISOString(),
  payload?: Record<string, unknown>,
): InteractionEvent {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return {
    id: `event:${itemId}:${occurredAt}:${suffix}`,
    itemId,
    type,
    occurredAt,
    payload,
  }
}

export function eventTypeForNoteUpdate(changedFields: readonly string[]): InteractionEventType {
  return changedFields.length === 1 && (changedFields[0] === 'area' || changedFields[0] === 'areas')
    ? 'classified'
    : 'edited'
}

export function commitAnalyzedProject(
  analyzedProject: TerrainProject,
  baseProject: TerrainProject,
  events: InteractionEvent[] = [],
): TerrainProject {
  const updatedAt = events.at(-1)?.occurredAt ?? new Date().toISOString()
  return {
    ...analyzedProject,
    id: baseProject.id,
    createdAt: baseProject.createdAt,
    updatedAt,
    interactionEvents: [...baseProject.interactionEvents, ...events],
    activityHistory: baseProject.activityHistory,
    terrainProfiles: baseProject.terrainProfiles,
    activeTerrainProfileId: baseProject.activeTerrainProfileId,
  }
}