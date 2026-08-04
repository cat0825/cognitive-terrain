import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { TerrainProject } from '../../src/domain/types'
import { createDemoProject } from '../../src/domain/demo'
import {
  deleteProject,
  getProject,
  listProjectSummaries,
  renameProject,
  saveProject,
} from '../../src/storage/project-repository'
import { closeDatabase } from '../../src/storage/db'

function oldV1Project(id: string, name: string): TerrainProject {
  const base = createDemoProject()
  return {
    ...base,
    schemaVersion: 1 as never,
    id,
    name,
  }
}

beforeEach(async () => {
  await closeDatabase()
  const keys = (await indexedDB.databases()) ?? []
  await Promise.all(keys.map((key) => key.name ? indexedDB.deleteDatabase(key.name) : undefined))
})

describe('project repository', () => {
  it('migrates v1 projects to v2 on read', async () => {
    const legacy = oldV1Project('legacy-1', '旧项目')
    await saveProject(legacy)

    const loaded = await getProject('legacy-1')
    expect(loaded?.schemaVersion).toBe(2)
    expect(loaded?.embeddingMode).toBe('fallback')
    expect(loaded?.noteNeighbors).toEqual([])
  })

  it('lists summaries sorted by updatedAt descending', async () => {
    const older = createDemoProject()
    older.id = 'p-older'
    older.name = '旧项目'
    older.updatedAt = '2026-08-01T00:00:00Z'
    const newer = createDemoProject()
    newer.id = 'p-newer'
    newer.name = '新项目'
    newer.updatedAt = '2026-08-02T00:00:00Z'
    await saveProject(older)
    await saveProject(newer)

    const summaries = await listProjectSummaries()
    expect(summaries.map((summary) => summary.id)).toEqual(['p-newer', 'p-older'])
    expect(summaries[0]).toMatchObject({ name: '新项目', noteCount: newer.notes.length })
  })

  it('renames a project in place', async () => {
    const project = createDemoProject()
    project.id = 'p-rename'
    project.name = '原名'
    await saveProject(project)

    const renamed = await renameProject('p-rename', '新名称')
    expect(renamed?.name).toBe('新名称')
    expect((await getProject('p-rename'))?.name).toBe('新名称')
  })

  it('deletes a project', async () => {
    await saveProject(createDemoProject())
    await deleteProject('demo-ai-infra-terrain')
    expect(await getProject('demo-ai-infra-terrain')).toBeUndefined()
  })
})
