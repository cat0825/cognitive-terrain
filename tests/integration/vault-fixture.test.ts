import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildPlateBridges, buildPlateCollisions, summarizeKnowledgePlates } from '../../src/domain/knowledge-plates'
import { resolveNoteRelations } from '../../src/domain/knowledge-maintenance'
import type { InteractionEvent, TerrainProject } from '../../src/domain/types'
import { parseProjectBundle, serializeProjectBundle } from '../../src/export/project-files'
import { analyzeNotes } from '../../src/pipeline/run-pipeline'
import { closeDatabase } from '../../src/storage/db'
import {
  createProjectBackup,
  getProject,
  getProjectObjectBundle,
  restoreProjectBackup,
  saveProject,
} from '../../src/storage/project-repository'
import { parseVaultFixture, readVaultFixtureManifest } from '../fixtures/obsidian-vault'

const manifest = readVaultFixtureManifest()
const fixedTime = '2026-08-15T08:00:00.000Z'

beforeEach(async () => {
  await closeDatabase()
  const databases = (await indexedDB.databases()) ?? []
  await Promise.all(databases.map((database) => database.name ? indexedDB.deleteDatabase(database.name) : undefined))
})

describe('anonymized Obsidian vault regression fixture', () => {
  it('reports invalid fields while retaining valid content and stable nested paths', async () => {
    const parsed = await parseVaultFixture()

    expect(parsed.notes).toHaveLength(manifest.noteCount)
    expect(parsed.issues).toHaveLength(manifest.issueCount)
    expect(parsed.issues.map((issue) => issue.field)).toEqual(['areas', 'mastery', 'status', 'reviewedAt'])
    expect(parsed.notes.every((note) => note.vault === manifest.vault)).toBe(true)
    expect(parsed.notes.map((note) => note.sourcePath)).toContain('Systems/Recovery Protocol.md')
    expect(parsed.notes.filter((note) => note.title === '共享标题')).toHaveLength(2)
    expect(parsed.notes.find((note) => note.title === '恢复协议')).toMatchObject({
      content: expect.stringContaining('有效正文仍需保留'),
      confidence: 0.62,
      areas: ['系统工程', '研究方法'],
      mastery: undefined,
      status: undefined,
    })
    expect(parsed.notes.find((note) => note.title === 'Unicode 领域')?.areas).toEqual(['AI 工程'])
    expect(parsed.notes.find((note) => note.title === '贝叶斯更新')?.links).toEqual([
      'Design/Experiment Design',
      'Archive/Shared Map',
    ])
  })

  it('keeps relation, plate, and layout results deterministic across repeated analysis', async () => {
    const parsed = await parseVaultFixture()
    const first = await analyzeFixture(parsed.notes)
    const second = await analyzeFixture([...parsed.notes].reverse())
    const relationCounts = first.notes.reduce((counts, note) => {
      const relations = resolveNoteRelations(first.notes, note.id)
      return {
        resolved: counts.resolved + relations.outgoing.length,
        unresolved: counts.unresolved + relations.unresolved.length,
      }
    }, { resolved: 0, unresolved: 0 })
    const collisions = buildPlateCollisions(first.notes)

    expect(relationCounts).toEqual({
      resolved: manifest.resolvedWikiLinkCount,
      unresolved: manifest.unresolvedWikiLinkCount,
    })
    expect(summarizeKnowledgePlates(first.notes)).toHaveLength(manifest.plateCount)
    expect(buildPlateBridges(first.notes)).toHaveLength(manifest.bridgeCount)
    expect(collisions).toHaveLength(manifest.collisionCount)
    expect(collisions.filter((collision) => collision.mode === 'band')).toHaveLength(manifest.collisionBandCount)
    expect(projectLayout(second)).toEqual(projectLayout(first))
  })

  it('preserves IDs, memberships, events, and coordinates through save, reload, export, and restore', async () => {
    const parsed = await parseVaultFixture()
    const analyzed = await analyzeFixture(parsed.notes)
    const event: InteractionEvent = {
      id: 'event:fixture:reviewed:2026-08-15T08:00:00.000Z',
      itemId: analyzed.notes[0].id,
      type: 'reviewed',
      occurredAt: fixedTime,
      payload: { source: 'fixture' },
    }
    const project: TerrainProject = {
      ...analyzed,
      id: 'project-atlas-vault-fixture',
      createdAt: fixedTime,
      updatedAt: fixedTime,
      interactionEvents: [event],
    }

    await saveProject(project)
    const reloaded = await getProject(project.id)
    expect(reloaded).toBeDefined()
    const beforeBundle = await getProjectObjectBundle(project.id)
    const exported = serializeProjectBundle(reloaded!)
    const imported = await parseProjectBundle(new File([exported], 'atlas.terrain.json', {
      type: 'application/json',
    }))
    await saveProject(imported)
    const backup = await createProjectBackup(imported)
    const changed = {
      ...imported,
      updatedAt: '2026-08-16T08:00:00.000Z',
      notes: imported.notes.map((note, index) => index === 0 ? { ...note, x: note.x + 0.25 } : note),
      interactionEvents: [],
    }
    await saveProject(changed)
    const restored = await restoreProjectBackup(backup.id)
    const afterBundle = await getProjectObjectBundle(project.id)

    expect(restored).toBeDefined()
    expect(restored!.notes.map((note) => note.id)).toEqual(project.notes.map((note) => note.id))
    expect(restored!.notes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(
      project.notes.map(({ id, x, y }) => ({ id, x, y })),
    )
    expect(restored!.interactionEvents).toEqual([event])
    expect(afterBundle?.plateMemberships).toEqual(beforeBundle?.plateMemberships)
    expect(afterBundle?.interactionEvents).toEqual([event])
    expect(afterBundle?.layouts.map(({ itemId, x, y }) => ({ itemId, x, y }))).toEqual(
      beforeBundle?.layouts.map(({ itemId, x, y }) => ({ itemId, x, y })),
    )
  })
})

async function analyzeFixture(notes: Parameters<typeof analyzeNotes>[1]): Promise<TerrainProject> {
  return analyzeNotes('AtlasVault fixture', notes, {
    embeddingStrategy: 'deterministic',
    gridSize: 32,
    timeZone: 'UTC',
  })
}

function projectLayout(project: TerrainProject): Array<{ id: string; fingerprint: string; x: number; y: number }> {
  return project.notes.map(({ id, fingerprint, x, y }) => ({ id, fingerprint, x, y }))
}
