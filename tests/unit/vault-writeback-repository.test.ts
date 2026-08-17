import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, DATABASE_NAME, DATABASE_VERSION, getDatabase } from '../../src/storage/db'
import {
  getVaultWritebackRecoveryBatch,
  getVaultWritebackRecoveryFile,
  listVaultWritebackRecoveryBatches,
  listVaultWritebackRecoveryFiles,
  markVaultWritebackRecoveryBatchInProgress,
  prepareVaultWritebackRecoveryBatch,
  updateVaultWritebackRecoveryOutcome,
  updateVaultWritebackRecoveryOutcomes,
} from '../../src/storage/vault-writeback-repository'

const CREATED_AT = '2026-08-17T09:00:00.000Z'

beforeEach(async () => {
  await closeDatabase()
  const databases = (await indexedDB.databases()) ?? []
  await Promise.all(databases.map((database) => (
    database.name ? indexedDB.deleteDatabase(database.name) : undefined
  )))
})

describe('vault write-back recovery repository', () => {
  it('adds isolated recovery stores when upgrading schema v7 to v8', async () => {
    const versionSeven = await openDB(DATABASE_NAME, 7, {
      upgrade(database) {
        database.createObjectStore('sentinel')
      },
    })
    await versionSeven.put('sentinel', { preserved: true }, 'record')
    versionSeven.close()

    const upgraded = await getDatabase()

    expect(upgraded.version).toBe(DATABASE_VERSION)
    expect(upgraded.objectStoreNames.contains('vaultWritebackBatches')).toBe(true)
    expect(upgraded.objectStoreNames.contains('vaultWritebackRecoveryFiles')).toBe(true)
    expect(await upgraded.get('sentinel' as never, 'record')).toEqual({ preserved: true })
  })

  it('preserves exact Uint8Array view and Blob bytes outside batch metadata', async () => {
    const backing = new Uint8Array([99, 0, 255, 13, 10, 88])
    const view = backing.subarray(1, 5)
    const blobBytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x00, 0x62])
    const batch = await prepareVaultWritebackRecoveryBatch({
      id: 'batch-binary',
      workspaceId: 'workspace-a',
      vaultId: 'vault-a',
      previewId: 'preview-a',
      createdAt: CREATED_AT,
      entries: [
        {
          requestId: 'request-view',
          sourceId: 'source-view',
          path: 'Notes/View.md',
          beforeByteHash: 'sha256:view',
          originalBytes: view,
        },
        {
          requestId: 'request-blob',
          sourceId: 'source-blob',
          path: 'Notes/Blob.md',
          beforeByteHash: 'sha256:blob',
          originalBytes: new Blob([blobBytes]),
        },
      ],
    })
    backing.fill(7)
    blobBytes.fill(8)

    expect(batch).toMatchObject({
      id: 'batch-binary',
      status: 'prepared',
      outcomes: [
        { requestId: 'request-view', status: 'not-attempted', backupId: 'batch-binary' },
        { requestId: 'request-blob', status: 'not-attempted', backupId: 'batch-binary' },
      ],
    })
    expect(JSON.stringify(batch)).not.toContain('originalBytes')
    expect(JSON.stringify(batch)).not.toContain('handle')

    const files = await listVaultWritebackRecoveryFiles(batch.id)
    expect([...files.find((file) => file.sourceId === 'source-view')!.originalBytes]).toEqual([0, 255, 13, 10])
    expect([...files.find((file) => file.sourceId === 'source-blob')!.originalBytes]).toEqual([
      0xef, 0xbb, 0xbf, 0x61, 0x00, 0x62,
    ])

    files[0].originalBytes.fill(42)
    expect([...(await getVaultWritebackRecoveryFile(batch.id, files[0].sourceId))!.originalBytes])
      .not.toEqual([...files[0].originalBytes])
  })

  it('stores all files atomically and does not overwrite an existing recovery batch', async () => {
    await prepareVaultWritebackRecoveryBatch({
      id: 'batch-atomic',
      workspaceId: 'workspace-a',
      vaultId: 'vault-a',
      previewId: 'preview-original',
      createdAt: CREATED_AT,
      entries: [{
        requestId: 'request-original',
        sourceId: 'source-original',
        path: 'Original.md',
        beforeByteHash: 'sha256:original',
        originalBytes: new Uint8Array([1, 2, 3]),
      }],
    })

    await expect(prepareVaultWritebackRecoveryBatch({
      id: 'batch-atomic',
      workspaceId: 'workspace-a',
      vaultId: 'vault-a',
      previewId: 'preview-replacement',
      createdAt: '2026-08-17T09:01:00.000Z',
      entries: [{
        requestId: 'request-replacement',
        sourceId: 'source-replacement',
        path: 'Replacement.md',
        beforeByteHash: 'sha256:replacement',
        originalBytes: new Uint8Array([9, 9, 9]),
      }],
    })).rejects.toBeDefined()

    expect((await getVaultWritebackRecoveryBatch('batch-atomic'))?.previewId).toBe('preview-original')
    expect((await listVaultWritebackRecoveryFiles('batch-atomic')).map((file) => file.sourceId))
      .toEqual(['source-original'])
  })

  it('keeps exact partial outcomes and every recovery file after the first failure', async () => {
    const entries = ['a', 'b', 'c'].map((suffix, index) => ({
      requestId: `request-${suffix}`,
      sourceId: `source-${suffix}`,
      path: `${suffix.toUpperCase()}.md`,
      beforeByteHash: `sha256:${suffix}`,
      originalBytes: new Uint8Array([index, 0xff]),
    }))
    await prepareVaultWritebackRecoveryBatch({
      id: 'batch-partial',
      workspaceId: 'workspace-a',
      vaultId: 'vault-a',
      previewId: 'preview-partial',
      createdAt: CREATED_AT,
      entries,
    })
    expect((await markVaultWritebackRecoveryBatchInProgress(
      'batch-partial',
      '2026-08-17T09:01:00.000Z',
    )).status).toBe('in-progress')

    expect((await updateVaultWritebackRecoveryOutcome('batch-partial', {
      requestId: 'request-a',
      sourceId: 'source-a',
      path: 'A.md',
      status: 'succeeded',
    }, '2026-08-17T09:02:00.000Z')).status).toBe('in-progress')
    const failed = await updateVaultWritebackRecoveryOutcome('batch-partial', {
      requestId: 'request-b',
      sourceId: 'source-b',
      path: 'B.md',
      status: 'failed',
      error: 'permission revoked',
    }, '2026-08-17T09:03:00.000Z')

    expect(failed.status).toBe('failed')
    expect(failed.outcomes).toEqual([
      expect.objectContaining({ requestId: 'request-a', status: 'succeeded' }),
      expect.objectContaining({ requestId: 'request-b', status: 'failed', error: 'permission revoked' }),
      expect.objectContaining({ requestId: 'request-c', status: 'not-attempted' }),
    ])
    expect((await listVaultWritebackRecoveryFiles('batch-partial')).map((file) => [...file.originalBytes]))
      .toEqual([[0, 255], [1, 255], [2, 255]])
    await expect(updateVaultWritebackRecoveryOutcome('batch-partial', {
      requestId: 'request-c',
      sourceId: 'source-c',
      path: 'C.md',
      status: 'succeeded',
    })).rejects.toThrow(/already failed/)
  })

  it('deduplicates identical source bytes for multiple requests and completes after all outcomes succeed', async () => {
    const shared = new Uint8Array([10, 20, 30])
    await prepareVaultWritebackRecoveryBatch({
      id: 'batch-shared-source',
      workspaceId: 'workspace-a',
      vaultId: 'vault-a',
      previewId: 'preview-shared-source',
      createdAt: CREATED_AT,
      entries: [
        {
          requestId: 'request-mastery',
          sourceId: 'source-shared',
          path: 'Shared.md',
          beforeByteHash: 'sha256:shared',
          originalBytes: shared,
        },
        {
          requestId: 'request-confidence',
          sourceId: 'source-shared',
          path: 'Shared.md',
          beforeByteHash: 'sha256:shared',
          originalBytes: new Blob([shared]),
        },
      ],
    })

    const [file] = await listVaultWritebackRecoveryFiles('batch-shared-source')
    expect(file.requestIds).toEqual(['request-mastery', 'request-confidence'])
    const completed = await updateVaultWritebackRecoveryOutcomes('batch-shared-source', [
      {
        requestId: 'request-mastery',
        sourceId: 'source-shared',
        path: 'Shared.md',
        status: 'succeeded',
      },
      {
        requestId: 'request-confidence',
        sourceId: 'source-shared',
        path: 'Shared.md',
        status: 'succeeded',
      },
    ])

    expect(completed.status).toBe('completed')
    expect(await listVaultWritebackRecoveryBatches('workspace-a')).toEqual([
      expect.objectContaining({ id: 'batch-shared-source', status: 'completed' }),
    ])
  })

  it('rejects conflicting recovery material before creating a batch', async () => {
    await expect(prepareVaultWritebackRecoveryBatch({
      id: 'batch-conflict',
      workspaceId: 'workspace-a',
      vaultId: 'vault-a',
      previewId: 'preview-conflict',
      createdAt: CREATED_AT,
      entries: [
        {
          requestId: 'request-a',
          sourceId: 'source-shared',
          path: 'Shared.md',
          beforeByteHash: 'sha256:first',
          originalBytes: new Uint8Array([1]),
        },
        {
          requestId: 'request-b',
          sourceId: 'source-shared',
          path: 'Shared.md',
          beforeByteHash: 'sha256:second',
          originalBytes: new Uint8Array([2]),
        },
      ],
    })).rejects.toThrow(/conflicting recovery material/)
    expect(await getVaultWritebackRecoveryBatch('batch-conflict')).toBeUndefined()
  })
})
