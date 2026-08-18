import { migrateTerrainProjectToV3, type SchemaV3Bundle } from '../domain/schema-v3'
import type { ProjectBackup, TerrainProject } from '../domain/types'
import {
  getDatabase,
  migrateProject,
  PROJECT_TRANSACTION_STORE_NAMES,
  type replaceProjectMaterialization,
} from './db'

const MAX_BACKUPS_PER_PROJECT = 8

export async function saveVaultSyncProject(previous: TerrainProject, next: TerrainProject): Promise<void> {
  return saveVaultProject(previous, next, 'vault sync', 'before-vault-sync')
}

export async function saveVaultWritebackProject(previous: TerrainProject, next: TerrainProject): Promise<void> {
  return saveVaultProject(previous, next, 'vault write-back', 'before-vault-writeback')
}

async function saveVaultProject(
  previous: TerrainProject,
  next: TerrainProject,
  operation: string,
  backupReason: Extract<ProjectBackup['reason'], 'before-vault-sync' | 'before-vault-writeback'>,
): Promise<void> {
  if (previous.id !== next.id) throw new Error(`${operation} cannot change the project id`)
  if (!next.vaultSync) throw new Error(`${operation} state is required`)

  const database = await getDatabase()
  const transaction = database.transaction(PROJECT_TRANSACTION_STORE_NAMES, 'readwrite')
  try {
    const projects = transaction.objectStore('projects')
    const stored = await projects.get(next.id)
    if (stored && stored.updatedAt !== previous.updatedAt) {
      throw new Error(`${operation} preview is stale; refresh before applying changes`)
    }
    const base = stored ? migrateProject(stored) : migrateProject(previous)
    const normalized = migrateProject(next)
    const previousBundle = migrateTerrainProjectToV3(base, { sourceSchemaVersion: base.schemaVersion }).bundle
    const nextBundle = migrateTerrainProjectToV3(normalized, { sourceSchemaVersion: next.schemaVersion }).bundle

    await transaction.objectStore('backups').put(makeBackup(base, backupReason))
    await applyProjectMaterializationDiff(transaction, previousBundle, nextBundle)
    await projects.put(normalized)
    await transaction.done
  } catch (error) {
    await abortTransaction(transaction, error)
  }
  await pruneProjectBackups(next.id)
}

export async function saveVaultBinding(workspaceId: string, vaultId: string, handle: unknown): Promise<void> {
  if (!workspaceId.trim() || !vaultId.trim()) throw new Error('vault binding requires workspace and vault ids')
  const database = await getDatabase()
  await database.put('vaultBindings', { workspaceId, vaultId, handle })
}

export async function getVaultBinding(workspaceId: string, vaultId: string): Promise<unknown | undefined> {
  const database = await getDatabase()
  return (await database.get('vaultBindings', [workspaceId, vaultId]))?.handle
}

export async function deleteVaultBinding(workspaceId: string, vaultId: string): Promise<void> {
  const database = await getDatabase()
  await database.delete('vaultBindings', [workspaceId, vaultId])
}

function makeBackup(project: TerrainProject, reason: ProjectBackup['reason']): ProjectBackup {
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

async function pruneProjectBackups(projectId: string): Promise<void> {
  const database = await getDatabase()
  const transaction = database.transaction('backups', 'readwrite')
  const store = transaction.objectStore('backups')
  const backups = await store.index('by-project').getAll(projectId)
  backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  await Promise.all(backups.slice(MAX_BACKUPS_PER_PROJECT).map((backup) => store.delete(backup.id)))
  await transaction.done
}

async function applyProjectMaterializationDiff(
  transaction: Parameters<typeof replaceProjectMaterialization>[0],
  previous: SchemaV3Bundle,
  next: SchemaV3Bundle,
): Promise<void> {
  if (!sameRecord(previous.workspace, next.workspace)) {
    await transaction.objectStore('workspaces').put(next.workspace)
  }

  await applyRecordDiff(
    previous.items,
    next.items,
    (item) => [item.workspaceId, item.id] as [string, string],
    (item) => transaction.objectStore('items').put(item),
    (key) => transaction.objectStore('items').delete(key),
    true,
    sameItemRecord,
  )
  await applyRecordDiff(
    previous.sources,
    next.sources,
    (source) => [source.workspaceId, source.id] as [string, string],
    (source) => transaction.objectStore('sources').put(source),
    (key) => transaction.objectStore('sources').delete(key),
    true,
    sameSourceRecord,
  )
  await applyRecordDiff(
    previous.relations,
    next.relations,
    (relation) => [relation.workspaceId, relation.id] as [string, string],
    (relation) => transaction.objectStore('relations').put(relation),
    (key) => transaction.objectStore('relations').delete(key),
  )
  await applyRecordDiff(
    storedCognitiveStates(previous),
    storedCognitiveStates(next),
    (state) => [state.workspaceId, state.itemId] as [string, string],
    (state) => transaction.objectStore('cognitiveStates').put(state),
    (key) => transaction.objectStore('cognitiveStates').delete(key),
  )
  await applyRecordDiff(
    storedInteractionEvents(previous),
    storedInteractionEvents(next),
    (event) => [event.workspaceId, event.id] as [string, string],
    (event) => transaction.objectStore('interactionEvents').put(event),
    (key) => transaction.objectStore('interactionEvents').delete(key),
  )
  await applyRecordDiff(
    storedPlateMemberships(previous),
    storedPlateMemberships(next),
    (membership) => [membership.workspaceId, membership.itemId, membership.taxonomyNodeId] as [string, string, string],
    (membership) => transaction.objectStore('plateMemberships').put(membership),
    (key) => transaction.objectStore('plateMemberships').delete(key),
  )
  await applyRecordDiff(
    previous.taxonomyNodes,
    next.taxonomyNodes,
    (node) => [node.workspaceId, node.id] as [string, string],
    (node) => transaction.objectStore('taxonomyNodes').put(node),
    (key) => transaction.objectStore('taxonomyNodes').delete(key),
  )
  await applyRecordDiff(
    previous.referenceAtlases,
    next.referenceAtlases,
    (manifest) => [manifest.workspaceId, manifest.id] as [string, string],
    (manifest) => transaction.objectStore('referenceAtlases').put(manifest),
    (key) => transaction.objectStore('referenceAtlases').delete(key),
  )
  await applyRecordDiff(
    storedLayouts(previous),
    storedLayouts(next),
    (layout) => [layout.workspaceId, layout.layoutId, layout.itemId] as [string, string, string],
    (layout) => transaction.objectStore('layouts').put(layout),
    (key) => transaction.objectStore('layouts').delete(key),
  )
  await applyRecordDiff(
    storedTerrainProfiles(previous),
    storedTerrainProfiles(next),
    (profile) => [profile.workspaceId, profile.id] as [string, string],
    (profile) => transaction.objectStore('terrainProfiles').put(profile),
    (key) => transaction.objectStore('terrainProfiles').delete(key),
  )
  await applyRecordDiff(
    previous.citations,
    next.citations,
    (citation) => [citation.workspaceId, citation.id] as [string, string],
    (citation) => transaction.objectStore('citations').put(citation),
    (key) => transaction.objectStore('citations').delete(key),
  )
  await applyRecordDiff(
    previous.revisions,
    next.revisions,
    (revision) => [revision.workspaceId, revision.id] as [string, string],
    (revision) => transaction.objectStore('revisions').put(revision),
    (key) => transaction.objectStore('revisions').delete(key),
    false,
    sameRevisionRecord,
  )
}

async function applyRecordDiff<T, Key>(
  previous: readonly T[],
  next: readonly T[],
  keyFor: (value: T) => Key,
  put: (value: T) => Promise<unknown>,
  remove: (key: Key) => Promise<unknown>,
  deleteMissing = true,
  equal: (first: T | undefined, second: T) => boolean = sameRecord,
): Promise<void> {
  const previousByKey = new Map(previous.map((value) => [JSON.stringify(keyFor(value)), value]))
  const nextByKey = new Map(next.map((value) => [JSON.stringify(keyFor(value)), value]))
  const writes: Promise<unknown>[] = []
  for (const [key, value] of nextByKey) {
    if (!equal(previousByKey.get(key), value)) writes.push(put(value))
  }
  if (deleteMissing) {
    for (const [key, value] of previousByKey) {
      if (!nextByKey.has(key)) writes.push(remove(keyFor(value)))
    }
  }
  await Promise.all(writes)
}

function storedCognitiveStates(bundle: SchemaV3Bundle) {
  return bundle.cognitiveStates.map((state) => ({ ...state, workspaceId: bundle.workspace.id }))
}

function storedInteractionEvents(bundle: SchemaV3Bundle) {
  return bundle.interactionEvents.map((event) => ({ ...event, workspaceId: bundle.workspace.id }))
}

function storedPlateMemberships(bundle: SchemaV3Bundle) {
  return bundle.plateMemberships.map((membership) => ({ ...membership, workspaceId: bundle.workspace.id }))
}

function storedLayouts(bundle: SchemaV3Bundle) {
  return bundle.layouts.map((layout) => ({ ...layout, workspaceId: bundle.workspace.id }))
}

function storedTerrainProfiles(bundle: SchemaV3Bundle) {
  return bundle.terrainProfiles.map((profile) => ({ ...profile, workspaceId: bundle.workspace.id }))
}

function sameRecord(first: unknown, second: unknown): boolean {
  return JSON.stringify(first) === JSON.stringify(second)
}

function sameItemRecord(
  first: SchemaV3Bundle['items'][number] | undefined,
  second: SchemaV3Bundle['items'][number],
): boolean {
  if (!first) return false
  const { updatedAt: _firstUpdatedAt, ...firstStable } = first
  const { updatedAt: _secondUpdatedAt, ...secondStable } = second
  return sameRecord(firstStable, secondStable)
}

function sameSourceRecord(
  first: SchemaV3Bundle['sources'][number] | undefined,
  second: SchemaV3Bundle['sources'][number],
): boolean {
  if (!first) return false
  const { retrievedAt: _firstRetrievedAt, ...firstStable } = first
  const { retrievedAt: _secondRetrievedAt, ...secondStable } = second
  return sameRecord(firstStable, secondStable)
}

function sameRevisionRecord(
  first: SchemaV3Bundle['revisions'][number] | undefined,
  second: SchemaV3Bundle['revisions'][number],
): boolean {
  if (!first) return false
  if (first.patch.kind !== 'migration-baseline' || second.patch.kind !== 'migration-baseline') {
    return sameRecord(first, second)
  }
  const { createdAt: _firstCreatedAt, ...firstStable } = first
  const { createdAt: _secondCreatedAt, ...secondStable } = second
  return sameRecord(firstStable, secondStable)
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
