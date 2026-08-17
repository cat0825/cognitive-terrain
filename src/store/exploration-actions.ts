import {
  createExplorationItem,
  reduceExplorationLifecycle,
  reopenExplorationItem,
  type ExplorationCommand,
} from '../domain/exploration-lifecycle'
import type { ExplorationSuggestion, TerrainProject } from '../domain/types'
import { saveProject, updateProjectExplorationItems } from '../storage/project-repository'

export type ExplorationTransitionInput =
  | { type: 'accept' | 'start' | 'complete' | 'dismiss' | 'reject'; note?: string }
  | { type: 'snooze'; note?: string; snoozedUntil: string }

export interface ExplorationEditInput {
  actionTitle: string
  actionDetail?: string
  userNotes?: string
}

export async function transitionExplorationProject(
  current: TerrainProject,
  suggestion: ExplorationSuggestion,
  command: ExplorationTransitionInput,
): Promise<TerrainProject> {
  const occurredAt = explorationMutationTimestamp(current)
  const items = current.explorationItems ?? []
  const existing = items.find((item) => item.suggestion.id === suggestion.id)
  let item = existing ?? createExplorationItem(suggestion, occurredAt)
  if (existing && existing.suggestion.evidenceFingerprint !== suggestion.evidenceFingerprint) {
    item = reopenExplorationItem(existing, suggestion, occurredAt)
  }
  const nextItem = reduceExplorationLifecycle(item, { ...command, occurredAt } as ExplorationCommand)
  if ((nextItem.status === 'accepted' || nextItem.status === 'in-progress')
    && items.filter((candidate) => candidate.id !== nextItem.id
      && (candidate.status === 'accepted' || candidate.status === 'in-progress')).length >= 3) {
    throw new Error('当前工作集最多保留 3 项，请先完成或稍后处理一项')
  }
  const explorationItems = existing
    ? items.map((candidate) => candidate.id === nextItem.id ? nextItem : candidate)
    : [...items, nextItem]
  return persistExplorationItems(current, explorationItems, occurredAt)
}

export async function editExplorationProject(
  current: TerrainProject,
  suggestion: ExplorationSuggestion,
  patch: ExplorationEditInput,
): Promise<TerrainProject> {
  const existing = current.explorationItems?.find((item) => item.suggestion.id === suggestion.id)
  if (!existing) throw new Error('请先接受建议，再编辑下一步动作')
  const occurredAt = explorationMutationTimestamp(current)
  const nextItem = reduceExplorationLifecycle(existing, {
    type: 'edit',
    occurredAt,
    action: { title: patch.actionTitle, detail: patch.actionDetail },
    userNotes: patch.userNotes,
  })
  const explorationItems = (current.explorationItems ?? [])
    .map((candidate) => candidate.id === nextItem.id ? nextItem : candidate)
  return persistExplorationItems(current, explorationItems, occurredAt)
}

async function persistExplorationItems(
  current: TerrainProject,
  explorationItems: NonNullable<TerrainProject['explorationItems']>,
  updatedAt: string,
): Promise<TerrainProject> {
  const stored = await updateProjectExplorationItems(current.id, explorationItems, updatedAt)
  if (stored) return stored
  const project = { ...current, explorationItems, updatedAt }
  await saveProject(project, { createBackup: false })
  return project
}

function explorationMutationTimestamp(project: TerrainProject): string {
  const timestamps = [project.updatedAt, ...(project.explorationItems ?? []).map((item) => item.updatedAt)]
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)
  return new Date(Math.max(Date.now(), ...timestamps)).toISOString()
}
