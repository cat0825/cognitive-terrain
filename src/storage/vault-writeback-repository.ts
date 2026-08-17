import type {
  StoredVaultWritebackBatch,
  StoredVaultWritebackOutcome,
  StoredVaultWritebackRecoveryFile,
  VaultWritebackOutcomeStatus,
} from './db'
import { getDatabase } from './db'

export interface VaultWritebackRecoveryEntryInput {
  requestId: string
  sourceId: string
  path: string
  beforeByteHash: string
  originalBytes: Blob | Uint8Array
}

export interface PrepareVaultWritebackRecoveryBatchInput {
  id?: string
  workspaceId: string
  vaultId: string
  previewId: string
  createdAt?: string
  entries: readonly VaultWritebackRecoveryEntryInput[]
}

export type VaultWritebackRecoveryBatch = StoredVaultWritebackBatch
export type VaultWritebackRecoveryOutcome = StoredVaultWritebackOutcome

export interface VaultWritebackRecoveryFile extends Omit<StoredVaultWritebackRecoveryFile, 'originalBytes'> {
  originalBytes: Uint8Array
}

export interface VaultWritebackOutcomeUpdate {
  requestId: string
  sourceId: string
  path: string
  status: VaultWritebackOutcomeStatus
  error?: string
}

interface PreparedRecoveryFile {
  stored: StoredVaultWritebackRecoveryFile
  bytes: Uint8Array
}

export async function prepareVaultWritebackRecoveryBatch(
  input: PrepareVaultWritebackRecoveryBatchInput,
): Promise<VaultWritebackRecoveryBatch> {
  const workspaceId = requireIdentifier(input.workspaceId, 'workspace id')
  const vaultId = requireIdentifier(input.vaultId, 'vault id')
  const previewId = requireIdentifier(input.previewId, 'preview id')
  const id = input.id?.trim() || createBatchId(workspaceId)
  const createdAt = input.createdAt ?? new Date().toISOString()
  requireTimestamp(createdAt, 'createdAt')
  if (input.entries.length === 0) throw new Error('vault write-back recovery requires at least one entry')

  const requestIds = new Set<string>()
  const files = new Map<string, PreparedRecoveryFile>()
  const outcomes: StoredVaultWritebackOutcome[] = []

  for (const entry of input.entries) {
    const requestId = requireIdentifier(entry.requestId, 'request id')
    const sourceId = requireIdentifier(entry.sourceId, 'source id')
    const path = requireIdentifier(entry.path, 'vault path')
    const beforeByteHash = requireIdentifier(entry.beforeByteHash, 'source byte hash')
    if (requestIds.has(requestId)) throw new Error(`duplicate vault write-back request id: ${requestId}`)
    requestIds.add(requestId)

    const bytes = await exactBytes(entry.originalBytes)
    const existing = files.get(sourceId)
    if (existing) {
      if (
        existing.stored.path !== path
        || existing.stored.beforeByteHash !== beforeByteHash
        || !sameBytes(existing.bytes, bytes)
      ) {
        throw new Error(`conflicting recovery material for source: ${sourceId}`)
      }
      existing.stored.requestIds.push(requestId)
    } else {
      files.set(sourceId, {
        bytes,
        stored: {
          batchId: id,
          workspaceId,
          sourceId,
          requestIds: [requestId],
          path,
          beforeByteHash,
          byteLength: bytes.byteLength,
          originalBytes: exactArrayBuffer(bytes),
        },
      })
    }
    outcomes.push({
      requestId,
      sourceId,
      path,
      status: 'not-attempted',
      backupId: id,
    })
  }

  const batch: StoredVaultWritebackBatch = {
    id,
    workspaceId,
    vaultId,
    previewId,
    createdAt,
    updatedAt: createdAt,
    status: 'prepared',
    outcomes,
  }
  const database = await getDatabase()
  const transaction = database.transaction(
    ['vaultWritebackBatches', 'vaultWritebackRecoveryFiles'],
    'readwrite',
  )
  try {
    await transaction.objectStore('vaultWritebackBatches').add(batch)
    await Promise.all([...files.values()].map(({ stored }) => (
      transaction.objectStore('vaultWritebackRecoveryFiles').add(stored)
    )))
    await transaction.done
  } catch (error) {
    await abortTransaction(transaction, error)
  }
  return batch
}

export async function getVaultWritebackRecoveryBatch(
  batchId: string,
): Promise<VaultWritebackRecoveryBatch | undefined> {
  const database = await getDatabase()
  return database.get('vaultWritebackBatches', batchId)
}

export async function listVaultWritebackRecoveryBatches(
  workspaceId: string,
): Promise<VaultWritebackRecoveryBatch[]> {
  const database = await getDatabase()
  const batches = await database.getAllFromIndex('vaultWritebackBatches', 'by-workspace', workspaceId)
  return batches.sort((first, second) => second.createdAt.localeCompare(first.createdAt))
}

export async function getVaultWritebackRecoveryFile(
  batchId: string,
  sourceId: string,
): Promise<VaultWritebackRecoveryFile | undefined> {
  const database = await getDatabase()
  const stored = await database.get('vaultWritebackRecoveryFiles', [batchId, sourceId])
  return stored ? recoveryFileFromStored(stored) : undefined
}

export async function listVaultWritebackRecoveryFiles(
  batchId: string,
): Promise<VaultWritebackRecoveryFile[]> {
  const database = await getDatabase()
  const stored = await database.getAllFromIndex('vaultWritebackRecoveryFiles', 'by-batch', batchId)
  return stored
    .sort((first, second) => first.path.localeCompare(second.path))
    .map(recoveryFileFromStored)
}

export async function markVaultWritebackRecoveryBatchInProgress(
  batchId: string,
  updatedAt = new Date().toISOString(),
): Promise<VaultWritebackRecoveryBatch> {
  requireTimestamp(updatedAt, 'updatedAt')
  return updateBatch(batchId, (batch) => {
    if (batch.status === 'completed' || batch.status === 'failed') {
      throw new Error(`vault write-back recovery batch is already ${batch.status}`)
    }
    return { ...batch, status: 'in-progress', updatedAt }
  })
}

export async function updateVaultWritebackRecoveryOutcome(
  batchId: string,
  update: VaultWritebackOutcomeUpdate,
  updatedAt = new Date().toISOString(),
): Promise<VaultWritebackRecoveryBatch> {
  return updateVaultWritebackRecoveryOutcomes(batchId, [update], updatedAt)
}

export async function updateVaultWritebackRecoveryOutcomes(
  batchId: string,
  updates: readonly VaultWritebackOutcomeUpdate[],
  updatedAt = new Date().toISOString(),
): Promise<VaultWritebackRecoveryBatch> {
  requireTimestamp(updatedAt, 'updatedAt')
  if (updates.length === 0) throw new Error('vault write-back recovery outcome update is empty')
  return updateBatch(batchId, (batch) => {
    if (batch.status === 'completed' || batch.status === 'failed') {
      throw new Error(`vault write-back recovery batch is already ${batch.status}`)
    }
    const outcomes = [...batch.outcomes]
    const seen = new Set<string>()
    for (const update of updates) {
      if (seen.has(update.requestId)) throw new Error(`duplicate vault write-back outcome update: ${update.requestId}`)
      seen.add(update.requestId)
      const index = outcomes.findIndex((outcome) => outcome.requestId === update.requestId)
      if (index < 0) throw new Error(`vault write-back recovery request not found: ${update.requestId}`)
      const previous = outcomes[index]
      if (previous.sourceId !== update.sourceId || previous.path !== update.path) {
        throw new Error(`vault write-back recovery request identity changed: ${update.requestId}`)
      }
      if (previous.status !== 'not-attempted' && previous.status !== update.status) {
        throw new Error(`vault write-back recovery outcome is already ${previous.status}`)
      }
      if (update.status === 'failed' && !update.error?.trim()) {
        throw new Error('failed vault write-back recovery outcome requires an error')
      }
      outcomes[index] = {
        ...previous,
        status: update.status,
        ...(update.error?.trim() ? { error: update.error.trim() } : {}),
      }
    }
    return {
      ...batch,
      outcomes,
      status: statusForOutcomes(outcomes, batch.status),
      updatedAt,
    }
  })
}

function statusForOutcomes(
  outcomes: readonly StoredVaultWritebackOutcome[],
  current: StoredVaultWritebackBatch['status'],
): StoredVaultWritebackBatch['status'] {
  if (outcomes.some((outcome) => outcome.status === 'failed')) return 'failed'
  if (outcomes.every((outcome) => outcome.status === 'succeeded')) return 'completed'
  if (outcomes.some((outcome) => outcome.status === 'succeeded')) return 'in-progress'
  return current === 'in-progress' ? current : 'prepared'
}

async function updateBatch(
  batchId: string,
  apply: (batch: StoredVaultWritebackBatch) => StoredVaultWritebackBatch,
): Promise<StoredVaultWritebackBatch> {
  const database = await getDatabase()
  const transaction = database.transaction('vaultWritebackBatches', 'readwrite')
  try {
    const store = transaction.objectStore('vaultWritebackBatches')
    const current = await store.get(batchId)
    if (!current) throw new Error(`vault write-back recovery batch not found: ${batchId}`)
    const next = apply(current)
    await store.put(next)
    await transaction.done
    return next
  } catch (error) {
    return abortTransaction(transaction, error)
  }
}

function recoveryFileFromStored(stored: StoredVaultWritebackRecoveryFile): VaultWritebackRecoveryFile {
  const { originalBytes, ...metadata } = stored
  return { ...metadata, originalBytes: new Uint8Array(originalBytes.slice(0)) }
}

async function exactBytes(value: Blob | Uint8Array): Promise<Uint8Array> {
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer())
  return new Uint8Array(value)
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer
}

function sameBytes(first: Uint8Array, second: Uint8Array): boolean {
  if (first.byteLength !== second.byteLength) return false
  return first.every((value, index) => value === second[index])
}

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`vault write-back recovery requires ${label}`)
  return normalized
}

function requireTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`vault write-back recovery ${label} is invalid`)
}

function createBatchId(workspaceId: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${workspaceId}:vault-writeback:${suffix}`
}

async function abortTransaction<T>(transaction: { abort(): void; done: Promise<unknown> }, error: unknown): Promise<T> {
  try {
    transaction.abort()
  } catch {
    // The failed request may already have aborted the transaction.
  }
  await transaction.done.catch(() => undefined)
  throw error
}
