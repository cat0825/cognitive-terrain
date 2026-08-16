import type {
  InteractionEvent,
  ProjectBackup,
  ProjectBackupReason,
  ProjectBackupSummary,
  ProjectSummary,
  TerrainProject,
} from '../domain/types'
import { compactActivityHistory } from '../domain/activity-history'
import {
  clearProjectMaterialization,
  getDatabase,
  migrateProject,
  PROJECT_TRANSACTION_STORE_NAMES,
  readProjectMaterialization,
  replaceProjectMaterialization,
} from './db'

const MAX_BACKUPS_PER_PROJECT = 8

interface SaveProjectOptions {
  createBackup?: boolean
  backupReason?: ProjectBackupReason
}

export async function saveProject(project: TerrainProject, options: SaveProjectOptions = {}): Promise<void> {
  const database = await getDatabase()
  const transaction = database.transaction(PROJECT_TRANSACTION_STORE_NAMES, 'readwrite')
  let previous: TerrainProject | undefined
  try {
    const projects = transaction.objectStore('projects')
    previous = await projects.get(project.id)
    const normalized = migrateProject(project)
    if (previous && options.createBackup !== false) {
      await transaction.objectStore('backups').put(
        makeBackup(migrateProject(previous), options.backupReason ?? 'before-save'),
      )
    }
    await replaceProjectMaterialization(transaction, normalized, project.schemaVersion)
    await projects.put(normalized)
    await transaction.done
  } catch (error) {
    await abortTransaction(transaction, error)
  }
  if (previous && options.createBackup !== false) await pruneProjectBackups(project.id)
}

export async function appendProjectInteractionEvent(
  projectId: string,
  event: InteractionEvent,
): Promise<boolean> {
  const database = await getDatabase()
  const transaction = database.transaction(['projects', 'interactionEvents'], 'readwrite')
  try {
    const projects = transaction.objectStore('projects')
    const stored = await projects.get(projectId)
    if (!stored) {
      await transaction.done
      return false
    }

    const project = migrateProject(stored)
    if (!event.id || !Number.isFinite(Date.parse(event.occurredAt))) {
      throw new Error('invalid interaction event')
    }
    if (!project.notes.some((note) => note.id === event.itemId)) {
      throw new Error(`interaction event references missing item: ${event.itemId}`)
    }
    if (project.interactionEvents.some((existing) => existing.id === event.id)) {
      await transaction.done
      return true
    }

    const activityHistory = compactActivityHistory(
      [...project.interactionEvents, event],
      {
        timeZone: project.timeZone,
        now: event.occurredAt,
        aggregates: project.activityHistory?.aggregates,
      },
    )
    const eventStore = transaction.objectStore('interactionEvents')
    const existingKeys = await eventStore.index('by-workspace').getAllKeys(projectId)
    await Promise.all(existingKeys.map((key) => eventStore.delete(key)))
    await Promise.all(activityHistory.rawEvents.map((storedEvent) => eventStore.put({
      ...storedEvent,
      workspaceId: projectId,
    })))
    await projects.put({
      ...project,
      updatedAt: new Date(Math.max(Date.parse(project.updatedAt), Date.parse(event.occurredAt))).toISOString(),
      interactionEvents: activityHistory.rawEvents,
      activityHistory,
    })
    await transaction.done
    return true
  } catch (error) {
    return abortTransaction(transaction, error)
  }
}

export async function renameProject(id: string, name: string): Promise<TerrainProject | undefined> {
  const database = await getDatabase()
  const transaction = database.transaction(PROJECT_TRANSACTION_STORE_NAMES, 'readwrite')
  let renamed: TerrainProject | undefined
  try {
    const projects = transaction.objectStore('projects')
    const project = await projects.get(id)
    if (!project) {
      await transaction.done
      return undefined
    }
    const current = migrateProject(project)
    renamed = {
      ...current,
      name,
      updatedAt: new Date().toISOString(),
    }
    await transaction.objectStore('backups').put(makeBackup(current, 'before-save'))
    await replaceProjectMaterialization(transaction, renamed)
    await projects.put(renamed)
    await transaction.done
  } catch (error) {
    await abortTransaction(transaction, error)
  }
  await pruneProjectBackups(id)
  return renamed
}

export async function getProject(id: string): Promise<TerrainProject | undefined> {
  const database = await getDatabase()
  const project = await database.get('projects', id)
  return project ? migrateProject(project) : undefined
}

export async function deleteProject(id: string): Promise<void> {
  const database = await getDatabase()
  const transaction = database.transaction(PROJECT_TRANSACTION_STORE_NAMES, 'readwrite')
  let project: TerrainProject | undefined
  try {
    const projects = transaction.objectStore('projects')
    project = await projects.get(id)
    if (project) {
      await transaction.objectStore('backups').put(makeBackup(migrateProject(project), 'before-delete'))
    }
    await clearProjectMaterialization(transaction, id)
    await projects.delete(id)
    await transaction.done
  } catch (error) {
    await abortTransaction(transaction, error)
  }
  if (project) await pruneProjectBackups(id)
}

export async function listProjectSummaries(): Promise<ProjectSummary[]> {
  const database = await getDatabase()
  const projects = await database.getAllFromIndex('projects', 'by-updated-at')
  return projects
    .map(migrateProject)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((project) => ({
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
      noteCount: project.notes.length,
    }))
}

export async function createProjectBackup(project: TerrainProject): Promise<ProjectBackupSummary> {
  const database = await getDatabase()
  const backup = makeBackup(migrateProject(project), 'manual')
  await database.put('backups', backup)
  await pruneProjectBackups(project.id)
  return summarizeBackup(backup)
}

export async function listProjectBackups(projectId?: string): Promise<ProjectBackupSummary[]> {
  const database = await getDatabase()
  const backups = projectId
    ? await database.getAllFromIndex('backups', 'by-project', projectId)
    : await database.getAll('backups')
  return backups
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(summarizeBackup)
}

export async function restoreProjectBackup(id: string): Promise<TerrainProject | undefined> {
  const database = await getDatabase()
  const transaction = database.transaction(PROJECT_TRANSACTION_STORE_NAMES, 'readwrite')
  let restored: TerrainProject | undefined
  try {
    const backups = transaction.objectStore('backups')
    const backup = await backups.get(id)
    if (!backup) {
      await transaction.done
      return undefined
    }

    const projects = transaction.objectStore('projects')
    const current = await projects.get(backup.projectId)
    if (current) {
      await backups.put(makeBackup(migrateProject(current), 'before-restore'))
    }
    restored = {
      ...migrateProject(backup.project),
      updatedAt: new Date().toISOString(),
    }
    await replaceProjectMaterialization(transaction, restored)
    await projects.put(restored)
    await transaction.done
  } catch (error) {
    await abortTransaction(transaction, error)
  }
  if (!restored) return undefined
  await pruneProjectBackups(restored.id)
  return restored
}

export const getProjectObjectBundle = readProjectMaterialization

function makeBackup(project: TerrainProject, reason: ProjectBackupReason): ProjectBackup {
  const createdAt = new Date().toISOString()
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return {
    id: `${project.id}:${createdAt}:${suffix}`,
    projectId: project.id,
    projectName: project.name,
    createdAt,
    reason,
    project,
  }
}

function summarizeBackup(backup: ProjectBackup): ProjectBackupSummary {
  return {
    id: backup.id,
    projectId: backup.projectId,
    projectName: backup.projectName,
    createdAt: backup.createdAt,
    reason: backup.reason,
    noteCount: backup.project.notes.length,
  }
}

async function pruneProjectBackups(projectId: string): Promise<void> {
  const database = await getDatabase()
  const transaction = database.transaction('backups', 'readwrite')
  const store = transaction.objectStore('backups')
  const backups = await store.index('by-project').getAll(projectId)
  backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  await Promise.all(backups.slice(MAX_BACKUPS_PER_PROJECT).map((backup) => store.delete(backup.id)))
  await transaction.done
}

async function abortTransaction(
  transaction: { abort(): void; done: Promise<void> },
  error: unknown,
): Promise<never> {
  try {
    transaction.abort()
  } catch {
    // The request that failed may already have aborted the transaction.
  }
  try {
    await transaction.done
  } catch {
    // Preserve the domain or request error that triggered the rollback.
  }
  throw error
}