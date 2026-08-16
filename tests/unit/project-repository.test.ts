import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { beforeEach, describe, expect, it } from 'vitest'
import type { TerrainProject } from '../../src/domain/types'
import { createDemoProject } from '../../src/domain/demo'
import {
  appendProjectInteractionEvent,
  createProjectBackup,
  deleteProject,
  getProject,
  getProjectObjectBundle,
  listProjectBackups,
  listProjectSummaries,
  renameProject,
  restoreProjectBackup,
  saveProject,
} from '../../src/storage/project-repository'
import { createInteractionEvent } from '../../src/domain/cognitive-state'
import { closeDatabase, DATABASE_NAME, DATABASE_VERSION, getDatabase } from '../../src/storage/db'

const repositoryDemoFixture = createDemoProject()

function oldV1Project(id: string, name: string): TerrainProject {
  const {
    cognitiveStates: _cognitiveStates,
    interactionEvents: _interactionEvents,
    terrainProfiles: _terrainProfiles,
    activeTerrainProfileId: _activeTerrainProfileId,
    ...legacy
  } = repositoryDemoFixture
  return {
    ...legacy,
    schemaVersion: 1 as never,
    id,
    name,
    notes: legacy.notes.slice(0, 2),
    snapshots: [],
    peaks: [],
  } as TerrainProject
}

function smallProject(id: string, name: string): TerrainProject {
  const project = repositoryDemoFixture
  return {
    ...project,
    id,
    name,
    notes: project.notes.slice(0, 2),
    snapshots: [],
    peaks: [],
    noteNeighbors: project.noteNeighbors.slice(0, 2),
    cognitiveStates: project.cognitiveStates.slice(0, 2),
  }
}

beforeEach(async () => {
  await closeDatabase()
  const keys = (await indexedDB.databases()) ?? []
  await Promise.all(keys.map((key) => key.name ? indexedDB.deleteDatabase(key.name) : undefined))
})

describe('project repository', () => {
  it('persists v1 to v3 migrations during the IndexedDB upgrade', async () => {
    const legacy = oldV1Project('legacy-1', '旧项目')
    legacy.notes[0] = { ...legacy.notes[0], reviewedAt: '2025-08-15T00:00:00.000Z' }
    const versionOne = await openDB('cognitive-terrain', 1, {
      upgrade(database) {
        const store = database.createObjectStore('projects', { keyPath: 'id' })
        store.createIndex('by-updated-at', 'updatedAt')
      },
    })
    await versionOne.put('projects', legacy)
    versionOne.close()

    const upgraded = await getDatabase()
    const stored = await upgraded.get('projects', 'legacy-1')
    const bundle = await getProjectObjectBundle('legacy-1')
    expect(upgraded.version).toBe(DATABASE_VERSION)
    expect(upgraded.objectStoreNames.contains('backups')).toBe(true)
    expect(upgraded.objectStoreNames.contains('workspaces')).toBe(true)
    expect(stored?.schemaVersion).toBe(3)
    expect(stored?.embeddingMode).toBe('fallback')
    expect(stored?.noteNeighbors).toEqual([])
    expect(stored?.cognitiveStates).toHaveLength(2)
    expect(stored?.cognitiveStates[0]?.provenance).toBe('migration')
    expect(stored?.notes[0]?.reviewedAt).toBe('2025-08-15T00:00:00.000Z')
    expect(stored?.interactionEvents).toEqual([])
    expect(stored?.terrainProfiles.map((profile) => profile.id)).toEqual([
      'density',
      'mastery',
      'exploration',
      'activity',
      'structure',
    ])
    expect(bundle?.items).toHaveLength(2)
    expect(bundle?.layouts).toHaveLength(2)
    expect(bundle?.cognitiveStates).toHaveLength(2)
    expect(bundle?.citations).toEqual([])
    expect(bundle?.revisions).toHaveLength(2)
    expect(bundle?.revisions.every((revision) => revision.patch.sourceSchemaVersion === 1)).toBe(true)
  })

  it('preserves review timestamps when migrating a legacy note into cognitive state and materialization', async () => {
    const reviewedAt = '2026-07-31T23:45:00.000Z'
    const legacy = oldV1Project('legacy-reviewed-at', '带复习时间的旧项目')
    legacy.notes[0] = {
      ...legacy.notes[0],
      mastery: 0.8,
      reviewedAt,
    }

    const versionOne = await openDB(DATABASE_NAME, 1, {
      upgrade(database) {
        const store = database.createObjectStore('projects', { keyPath: 'id' })
        store.createIndex('by-updated-at', 'updatedAt')
      },
    })
    await versionOne.put('projects', legacy)
    versionOne.close()

    const upgraded = await getDatabase()
    const stored = await upgraded.get('projects', legacy.id)
    const bundle = await getProjectObjectBundle(legacy.id)
    expect(stored?.cognitiveStates).toEqual([
      expect.objectContaining({ itemId: legacy.notes[0].id, reviewedAt, provenance: 'migration' }),
      ...stored!.cognitiveStates.slice(1),
    ])
    expect(bundle?.cognitiveStates).toEqual([
      expect.objectContaining({ itemId: legacy.notes[0].id, reviewedAt, provenance: 'migration' }),
      ...bundle!.cognitiveStates.slice(1),
    ])
  })

  it('repairs an empty or missing active terrain profile during migration', async () => {
    const project = smallProject('profile-repair', '图层修复')
    project.terrainProfiles = []
    project.activeTerrainProfileId = 'missing-profile'

    await saveProject(project)

    const stored = await getProject(project.id)
    expect(stored?.terrainProfiles.map((profile) => profile.id)).toContain('density')
    expect(stored?.activeTerrainProfileId).toBe('density')
  })

  it('lists summaries sorted by updatedAt descending', async () => {
    const older = smallProject('p-older', '旧项目')
    older.updatedAt = '2026-08-01T00:00:00Z'
    const newer = smallProject('p-newer', '新项目')
    newer.updatedAt = '2026-08-02T00:00:00Z'
    await saveProject(older)
    await saveProject(newer)

    const summaries = await listProjectSummaries()
    expect(summaries.map((summary) => summary.id)).toEqual(['p-newer', 'p-older'])
    expect(summaries[0]).toMatchObject({ name: '新项目', noteCount: newer.notes.length })
  })

  it('appends an interaction event without creating a backup or rebuilding unrelated records', async () => {
    const project = smallProject('p-activity', '活动记录')
    await saveProject(project)
    const event = createInteractionEvent(project.notes[0].id, 'opened', '2026-08-15T00:00:00.000Z')

    expect(await appendProjectInteractionEvent(project.id, event)).toBe(true)

    expect((await getProject(project.id))?.interactionEvents).toEqual([event])
    expect((await getProjectObjectBundle(project.id))?.interactionEvents).toEqual([event])
    expect(await listProjectBackups(project.id)).toEqual([])
  })

  it('compacts high-volume interaction events while preserving review timestamps', async () => {
    const project = smallProject('p-activity-retention', '活动压缩')
    const reviewedAt = '2025-08-15T00:00:00.000Z'
    project.notes = project.notes.map((note, index) => index === 0 ? { ...note, reviewedAt } : note)
    project.updatedAt = '2026-08-15T00:00:00.000Z'
    project.interactionEvents = Array.from({ length: 365 * 24 }, (_, index) => createInteractionEvent(
      project.notes[0].id,
      'opened',
      new Date(Date.parse(project.updatedAt) - index * 60 * 60 * 1000).toISOString(),
      { index },
    ))

    await saveProject(project)

    const stored = await getProject(project.id)
    expect(stored?.notes[0]?.reviewedAt).toBe(reviewedAt)
    expect(stored?.interactionEvents.length).toBeLessThanOrEqual(500)
    expect(stored?.activityHistory?.aggregates.length).toBeGreaterThan(0)
    const database = await getDatabase()
    expect(await database.countFromIndex('interactionEvents', 'by-workspace', project.id)).toBeLessThanOrEqual(500)
  })

  it('keeps appended review events identical in the compatibility record and materialized store', async () => {
    const project = smallProject('p-review-event', '复习事件')
    await saveProject(project)
    const event = createInteractionEvent(project.notes[0].id, 'reviewed', '2026-08-15T00:00:00.000Z', {
      reviewedAt: '2026-08-15T00:00:00.000Z',
    })

    expect(await appendProjectInteractionEvent(project.id, event)).toBe(true)

    const stored = await getProject(project.id)
    const bundle = await getProjectObjectBundle(project.id)
    expect(stored?.interactionEvents).toEqual([event])
    expect(bundle?.interactionEvents).toEqual([event])
    expect(bundle?.interactionEvents[0]?.payload).toEqual({ reviewedAt: event.occurredAt })
  })

  it('renames a project in place', async () => {
    const project = smallProject('p-rename', '原名')
    await saveProject(project)

    const renamed = await renameProject('p-rename', '新名称')
    expect(renamed?.name).toBe('新名称')
    expect((await getProject('p-rename'))?.name).toBe('新名称')
  })

  it('deletes a project', async () => {
    await saveProject(smallProject('p-delete-simple', '待删除'))
    await deleteProject('p-delete-simple')
    expect(await getProject('p-delete-simple')).toBeUndefined()
    expect(await getProjectObjectBundle('p-delete-simple')).toBeUndefined()
  })

  it('isolates identical item ids by workspace and only clears the selected project', async () => {
    const first = smallProject('workspace-a', '项目 A')
    const second = smallProject('workspace-b', '项目 B')
    await saveProject(first)
    await saveProject(second)

    const firstBundle = await getProjectObjectBundle(first.id)
    const secondBundle = await getProjectObjectBundle(second.id)
    expect(firstBundle?.items.map((item) => item.id)).toEqual(secondBundle?.items.map((item) => item.id))
    expect(firstBundle?.items.every((item) => item.workspaceId === first.id)).toBe(true)
    expect(secondBundle?.items.every((item) => item.workspaceId === second.id)).toBe(true)

    await deleteProject(first.id)
    expect(await getProjectObjectBundle(first.id)).toBeUndefined()
    expect((await getProjectObjectBundle(second.id))?.items).toHaveLength(2)
    const database = await getDatabase()
    expect(await database.countFromIndex('revisions', 'by-workspace', first.id)).toBe(0)
  })

  it('replaces current records but retains content-hash revision history', async () => {
    const original = smallProject('p-revisions', '版本历史')
    await saveProject(original)
    const changed = {
      ...original,
      notes: [{ ...original.notes[0], content: `${original.notes[0].content}\n新增内容` }],
      cognitiveStates: original.cognitiveStates.filter((state) => state.itemId === original.notes[0].id),
      updatedAt: '2026-08-14T09:00:00.000Z',
    }
    await saveProject(changed)

    const bundle = await getProjectObjectBundle(original.id)
    expect(bundle?.items).toHaveLength(1)
    expect(bundle?.layouts).toHaveLength(1)
    expect(bundle?.cognitiveStates).toHaveLength(1)
    expect(bundle?.revisions).toHaveLength(3)
    expect(JSON.stringify(bundle?.revisions)).not.toContain('新增内容')
  })

  it('rolls back compatibility and object stores when materialization fails', async () => {
    const original = smallProject('p-rollback', '原始项目')
    await saveProject(original)
    const invalid = {
      ...original,
      name: '不应保存',
      interactionEvents: [{
        id: undefined as never,
        itemId: original.notes[0].id,
        type: 'opened' as const,
        occurredAt: '2026-08-14T10:00:00.000Z',
      }],
    }

    await expect(saveProject(invalid)).rejects.toBeDefined()
    expect((await getProject(original.id))?.name).toBe('原始项目')
    expect((await getProjectObjectBundle(original.id))?.items).toHaveLength(2)
    expect(await listProjectBackups(original.id)).toEqual([])
  })

  it('aborts the v4 to v5 upgrade without replacing the old database on invalid data', async () => {
    const invalid = smallProject('invalid-upgrade', '损坏迁移样本')
    invalid.interactionEvents = [{
      id: undefined as never,
      itemId: invalid.notes[0].id,
      type: 'opened',
      occurredAt: '2026-08-14T10:00:00.000Z',
    }]
    const versionFour = await openDB(DATABASE_NAME, 4, {
      upgrade(database) {
        const projects = database.createObjectStore('projects', { keyPath: 'id' })
        projects.createIndex('by-updated-at', 'updatedAt')
        const backups = database.createObjectStore('backups', { keyPath: 'id' })
        backups.createIndex('by-project', 'projectId')
        backups.createIndex('by-created-at', 'createdAt')
      },
    })
    await versionFour.put('projects', invalid)
    versionFour.close()

    await expect(getDatabase()).rejects.toBeDefined()
    const unchanged = await openDB(DATABASE_NAME, 4)
    expect(unchanged.version).toBe(4)
    expect(unchanged.objectStoreNames.contains('workspaces')).toBe(false)
    expect((await unchanged.get('projects', invalid.id)).name).toBe('损坏迁移样本')
    unchanged.close()
  })

  it('backs up the previous version before save and restores it', async () => {
    const original = smallProject('p-backup', '初始版本')
    await saveProject(original)
    await saveProject({ ...original, name: '修改版本', updatedAt: '2026-08-14T08:00:00.000Z' })

    const [backup] = await listProjectBackups('p-backup')
    expect(backup).toMatchObject({ projectName: '初始版本', reason: 'before-save', noteCount: 2 })

    const restored = await restoreProjectBackup(backup.id)
    expect(restored?.name).toBe('初始版本')
    expect((await getProject('p-backup'))?.name).toBe('初始版本')
    expect((await listProjectBackups('p-backup')).some((item) => item.reason === 'before-restore')).toBe(true)
  })

  it('keeps a recoverable snapshot when deleting a project', async () => {
    const project = smallProject('p-delete', '待删除项目')
    await saveProject(project)
    await deleteProject(project.id)

    expect(await getProject(project.id)).toBeUndefined()
    const backup = (await listProjectBackups(project.id)).find((item) => item.reason === 'before-delete')
    expect(backup).toBeDefined()
    await restoreProjectBackup(backup!.id)
    expect((await getProject(project.id))?.name).toBe('待删除项目')
    expect((await getProjectObjectBundle(project.id))?.items).toHaveLength(2)
  })

  it('retains at most eight backups per project', async () => {
    const project = smallProject('p-retention', '保留策略')
    await Promise.all(Array.from({ length: 10 }, () => createProjectBackup(project)))
    expect(await listProjectBackups(project.id)).toHaveLength(8)
  })
})