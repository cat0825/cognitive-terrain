import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase, migrateProject } from '../../src/storage/db'
import { getProject, saveProject } from '../../src/storage/project-repository'
import { saveVaultSyncProject } from '../../src/storage/vault-sync-repository'
import { createProjectFromNotes } from '../../src/domain/demo'
import { snapshotFromTerrainNote } from '../../src/domain/vault-sync'
import type { TerrainNote, TerrainProject, VaultSourceState } from '../../src/domain/types'

const createdAt = '2026-08-18T08:00:00.000Z'
const scannedAt = '2026-08-19T08:00:00.000Z'

beforeEach(async () => {
  await closeDatabase()
  const databases = (await indexedDB.databases()) ?? []
  await Promise.all(databases.map((database) => (
    database.name ? indexedDB.deleteDatabase(database.name) : undefined
  )))
})

describe('vault sync commit transaction boundary', () => {
  it('persists the whole project in one transaction and creates a recovery point', async () => {
    const base = await seedProject()
    const next = renamedProject(base, 'Renamed by vault sync')

    await saveVaultSyncProject(base, next)

    const reloaded = await getProject(base.id)
    expect(reloaded?.name).toBe('Renamed by vault sync')
    expect(reloaded?.updatedAt).toBe(scannedAt)

    // The pre-sync state must be recoverable, or an unwanted sync would be
    // unrecoverable rather than merely unwelcome.
    const database = await getDatabase()
    const backups = await database.getAllFromIndex('backups', 'by-project', base.id)
    expect(backups.some((backup) => backup.reason === 'before-vault-sync')).toBe(true)
  })

  it('rolls the store back to the pre-sync state when a write inside the transaction fails', async () => {
    const base = await seedProject()

    // A note carrying a duplicate item id makes materialization reject part-way
    // through the transaction. Anything less than a full rollback would leave the
    // projects record disagreeing with the materialized stores.
    const conflicting = migrateProject({
      ...base,
      name: 'Should not survive',
      updatedAt: scannedAt,
      notes: [...base.notes, { ...base.notes[0] }],
    })

    await expect(saveVaultSyncProject(base, conflicting)).rejects.toThrow()

    const reloaded = await getProject(base.id)
    expect(reloaded?.name).toBe(base.name)
    expect(reloaded?.updatedAt).toBe(createdAt)
    expect(reloaded?.notes).toHaveLength(base.notes.length)
  })

  it('rejects a stale preview instead of overwriting a project that moved on', async () => {
    const base = await seedProject()
    // Another commit landed after the preview was generated.
    await saveProject(migrateProject({ ...base, name: 'Changed elsewhere', updatedAt: scannedAt }))

    await expect(saveVaultSyncProject(base, renamedProject(base, 'Stale write')))
      .rejects.toThrow(/stale/i)

    const reloaded = await getProject(base.id)
    expect(reloaded?.name).toBe('Changed elsewhere')
  })

  it('refuses to change the project id, which would orphan the stored workspace', async () => {
    const base = await seedProject()
    const next = { ...renamedProject(base, 'Different project'), id: 'project-other' }

    await expect(saveVaultSyncProject(base, next)).rejects.toThrow(/cannot change the project id/)
  })

  it('requires vault sync state so a plain save cannot use the vault path', async () => {
    const base = await seedProject()
    const next = { ...renamedProject(base, 'No vault state'), vaultSync: undefined }

    await expect(saveVaultSyncProject(base, next)).rejects.toThrow(/state is required/)
  })
})

async function seedProject(): Promise<TerrainProject> {
  const project = fixture()
  await saveProject(project)
  return project
}

function renamedProject(base: TerrainProject, name: string): TerrainProject {
  return migrateProject({
    ...base,
    name,
    updatedAt: scannedAt,
    vaultSync: {
      ...base.vaultSync!,
      vaults: base.vaultSync!.vaults.map((vault) => ({ ...vault, lastScannedAt: scannedAt })),
    },
  })
}

function fixture(): TerrainProject {
  const first = note('note-a', 'source-a', 'Topics/A.md')
  const second = note('note-b', 'source-b', 'Topics/B.md')
  const base = createProjectFromNotes('Vault sync transaction', [first, second], 'deterministic-local-fallback')
  return migrateProject({
    ...base,
    id: 'project-vault-sync-transaction',
    createdAt,
    updatedAt: createdAt,
    timeZone: 'UTC',
    vaultSync: {
      version: 1,
      vaults: [{
        vaultId: 'vault-atlas',
        displayName: 'Atlas',
        accessMode: 'directory-handle',
        lastScannedAt: createdAt,
      }],
      sources: [sourceState(first), sourceState(second)],
      revisions: [],
    },
  })
}

function sourceState(target: TerrainNote): VaultSourceState {
  return {
    sourceId: target.sourceId!,
    itemId: target.id,
    vaultId: 'vault-atlas',
    path: target.sourcePath!,
    rawContentHash: `sha256:${target.id}`,
    entityHash: `entity:${target.id}`,
    acceptedNote: snapshotFromTerrainNote(target),
    lastSeenAt: createdAt,
  }
}

function note(id: string, sourceId: string, sourcePath: string): TerrainNote {
  return {
    id,
    fingerprint: id,
    title: id,
    content: `Content for ${id}`,
    createdAt,
    createdAtMs: Date.parse(createdAt),
    tags: [],
    weight: 1,
    links: [],
    x: 0,
    y: 0,
    sourceId,
    sourcePath,
    declaredAreas: ['Mathematics'],
    areas: ['Mathematics'],
  } as unknown as TerrainNote
}
