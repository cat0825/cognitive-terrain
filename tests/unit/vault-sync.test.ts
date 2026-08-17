import { describe, expect, it } from 'vitest'
import { createProjectFromNotes } from '../../src/domain/demo'
import { materializePrerequisites } from '../../src/domain/prerequisite-topology'
import {
  applyVaultSync,
  buildVaultSyncPreview,
  entityHash,
  invalidFieldsForIssues,
  snapshotFromTerrainNote,
  type VaultScanResult,
} from '../../src/domain/vault-sync'
import type { NoteInput, TerrainNote, TerrainProject } from '../../src/domain/types'

const firstScanAt = '2026-08-17T08:00:00.000Z'
const secondScanAt = '2026-08-18T08:00:00.000Z'

describe('incremental vault sync', () => {
  it('keeps an unchanged rescan idempotent', () => {
    const project = linkedProject()
    const before = JSON.stringify(project)
    const preview = buildVaultSyncPreview(project, scan({ scannedAt: secondScanAt }))
    const applied = applyVaultSync(project, preview, [])

    expect(preview.changes).toEqual([])
    expect(preview.unchangedCount).toBe(1)
    expect(applied.events).toEqual([])
    expect(applied.state.revisions).toEqual([])
    expect(JSON.stringify(project)).toBe(before)
  })

  it('preserves item and source identity for a unique content-hash rename', () => {
    const project = linkedProject()
    const source = project.vaultSync!.sources[0]
    const preview = buildVaultSyncPreview(project, scan({
      scannedAt: secondScanAt,
      path: 'Math/Renamed.md',
    }))
    const applied = applyVaultSync(project, preview, [])

    expect(preview.changes).toMatchObject([{
      kind: 'renamed',
      previousPath: 'Math/Note.md',
      path: 'Math/Renamed.md',
      itemId: source.itemId,
      sourceId: source.sourceId,
    }])
    expect(applied.inputs.find((note) => note.id === source.itemId)).toMatchObject({
      id: source.itemId,
      sourceId: source.sourceId,
      sourcePath: 'Math/Renamed.md',
    })
    expect(applied.state.revisions[0]).toMatchObject({
      operation: 'rename',
      sourceId: source.sourceId,
      itemId: source.itemId,
    })
    expect(applied.events).toEqual([])
  })

  it('blocks normalized path collisions until the vault is corrected', () => {
    const project = linkedProject()
    const collisionScan = scan({ scannedAt: secondScanAt })
    collisionScan.files.push({
      ...collisionScan.files[0],
      path: 'math/note.md',
      rawContentHash: 'sha256:path-collision',
      note: {
        ...collisionScan.files[0].note!,
        content: 'different file at the same normalized path',
      },
    })
    const before = JSON.stringify(project)
    const preview = buildVaultSyncPreview(project, collisionScan)
    const conflict = preview.conflicts.find((item) => item.kind === 'path-collision')

    expect(conflict?.detail).toContain('修正 vault')
    expect(() => applyVaultSync(project, preview, [{
      conflictId: conflict!.id,
      choice: 'source',
    }])).toThrow('身份或路径冲突')
    expect(JSON.stringify(project)).toBe(before)
  })

  it('blocks an ambiguous rename instead of creating a duplicate source', () => {
    const linked = linkedProject()
    const firstSource = linked.vaultSync!.sources[0]
    const secondNote = {
      ...linked.notes[0],
      id: 'note-second-candidate',
      sourceId: 'source-second-candidate',
      sourcePath: 'Physics/Note.md',
    }
    const project: TerrainProject = {
      ...linked,
      notes: [...linked.notes, secondNote],
      vaultSync: {
        ...linked.vaultSync!,
        sources: [
          firstSource,
          {
            ...firstSource,
            sourceId: secondNote.sourceId,
            itemId: secondNote.id,
            relativePath: secondNote.sourcePath,
          },
        ],
      },
    }
    const moved = scan({ scannedAt: secondScanAt, path: 'Moved/Note.md' })
    const before = JSON.stringify(project)
    const preview = buildVaultSyncPreview(project, moved)
    const conflict = preview.conflicts.find((item) => item.kind === 'ambiguous-rename')

    expect(conflict?.detail).toContain('修正 vault')
    expect(() => applyVaultSync(project, preview, [{
      conflictId: conflict!.id,
      choice: 'app',
    }])).toThrow('身份或路径冲突')
    expect(JSON.stringify(project)).toBe(before)
  })

  it('requires field resolution when the first vault baseline differs from the current item', () => {
    const project = baseProject()
    const preview = buildVaultSyncPreview(project, scan({
      scannedAt: firstScanAt,
      hash: 'sha256:bootstrap-vault-edit',
      content: 'vault content before the first sync',
    }))
    const conflict = preview.conflicts.find((item) => item.field === 'content')

    expect(preview.bootstrap).toBe(true)
    expect(preview.unchangedCount).toBe(0)
    expect(preview.changes).toMatchObject([{ kind: 'modified', fields: ['content'] }])
    expect(conflict).toMatchObject({ kind: 'field', field: 'content' })
    expect(() => applyVaultSync(project, preview, [])).toThrow('同步冲突未处理')

    const keepApp = applyVaultSync(project, preview, [{ conflictId: conflict!.id, choice: 'app' }])
    const useSource = applyVaultSync(project, preview, [{ conflictId: conflict!.id, choice: 'source' }])
    expect(keepApp.inputs.find((note) => note.id === project.notes[0].id)?.content).toBe('base content')
    expect(useSource.inputs.find((note) => note.id === project.notes[0].id)?.content)
      .toBe('vault content before the first sync')
  })

  it('keeps raw declared area provenance unchanged while comparing normalized areas', () => {
    const project = baseProject()
    project.notes[0].area = 'AI 工程'
    project.notes[0].areas = ['AI 工程']
    project.notes[0].declaredAreas = [' ＡＩ   工程 ', 'AI 工程']
    const firstScan = scan({ scannedAt: firstScanAt })
    firstScan.files[0].note = {
      ...firstScan.files[0].note!,
      area: 'AI 工程',
      areas: ['AI 工程'],
      declaredAreas: [' ＡＩ   工程 ', 'AI 工程'],
    }

    const preview = buildVaultSyncPreview(project, firstScan)

    expect(preview.bootstrap).toBe(true)
    expect(preview.unchangedCount).toBe(1)
    expect(preview.changes).toEqual([])
    expect(preview.conflicts).toEqual([])
  })

  it('preserves prerequisite provenance through baseline and incremental sync', () => {
    const project = baseProject()
    const prerequisites = [{
      target: 'Algebra',
      provenance: 'app-confirmed',
      sourceField: 'app',
    }] as const
    project.notes[0].prerequisites = materializePrerequisites(project.notes[0].id, prerequisites)
    const first = scan({ scannedAt: firstScanAt })
    first.files[0].note!.prerequisites = [...prerequisites]

    const preview = buildVaultSyncPreview(project, first)
    const applied = applyVaultSync(project, preview, [])

    expect(preview.unchangedCount).toBe(1)
    expect(applied.inputs[0]?.prerequisites).toEqual(project.notes[0].prerequisites)
    expect(applied.state.sources[0]?.acceptedNote.prerequisites).toEqual(project.notes[0].prerequisites)
  })

  it('preserves the accepted prerequisite baseline when buildsOn is malformed', () => {
    expect(invalidFieldsForIssues([{
      file: 'Math/Note.md',
      field: 'buildsOn',
      message: '必须是非空文本或非空文本数组',
    }])).toEqual(['prerequisites'])
  })

  it('requires field-level resolution for divergent app and vault edits', () => {
    const baseline = linkedProject()
    const project = {
      ...baseline,
      notes: baseline.notes.map((note) => ({ ...note, content: 'app edit' })),
    }
    const preview = buildVaultSyncPreview(project, scan({
      scannedAt: secondScanAt,
      hash: 'sha256:vault-edit',
      content: 'vault edit',
    }))

    expect(preview.conflicts).toMatchObject([{
      kind: 'field',
      field: 'content',
      path: 'Math/Note.md',
    }])
    expect(() => applyVaultSync(project, preview, [])).toThrow('同步冲突未处理')

    const resolved = applyVaultSync(project, preview, [{
      conflictId: preview.conflicts[0].id,
      choice: 'source',
    }])
    expect(resolved.inputs.find((note) => note.id === project.notes[0].id)?.content).toBe('vault edit')
  })

  it('does not infer removals from a partial scan', () => {
    const project = linkedProject()
    const preview = buildVaultSyncPreview(project, {
      ...scan({ scannedAt: secondScanAt }),
      complete: false,
      files: [],
      issues: [{ file: 'Math/Note.md', message: '文件读取失败：permission denied' }],
    })

    expect(preview.changes).toEqual([])
    expect(preview.issues).toHaveLength(1)
  })

  it('does not double-count a matching app edit as vault activity', () => {
    const baseline = linkedProject()
    const project = {
      ...baseline,
      notes: baseline.notes.map((note) => ({ ...note, content: 'same final content' })),
    }
    const preview = buildVaultSyncPreview(project, scan({
      scannedAt: secondScanAt,
      hash: 'sha256:matching-edit',
      content: 'same final content',
    }))
    const applied = applyVaultSync(project, preview, [])

    expect(preview.conflicts).toEqual([])
    expect(applied.events).toEqual([])
    expect(applied.state.revisions).toHaveLength(1)
    expect(applied.state.revisions[0].entityHash).toBe(entityHash(snapshotFromTerrainNote(project.notes[0])))
  })

  it('rejects a stale preview and marks invalid file time fallback explicitly', () => {
    const project = linkedProject()
    const preview = buildVaultSyncPreview(project, scan({
      scannedAt: secondScanAt,
      hash: 'sha256:new-content',
      content: 'new content',
      lastModifiedMs: Date.parse('2026-08-19T08:00:00.000Z'),
    }))
    const applied = applyVaultSync(project, preview, [])
    expect(applied.state.revisions[0]).toMatchObject({
      occurredAt: secondScanAt,
      timestampSource: 'accepted-at',
      provenance: 'vault-sync',
    })
    expect(() => applyVaultSync({ ...project, updatedAt: '2026-08-17T09:00:00.000Z' }, preview, []))
      .toThrow('同步预览已过期')
  })
})

function linkedProject(): TerrainProject {
  const project = baseProject()
  const preview = buildVaultSyncPreview(project, scan({ scannedAt: firstScanAt }))
  const applied = applyVaultSync(project, preview, [])
  const source = applied.state.sources[0]
  return {
    ...project,
    notes: project.notes.map((note) => ({ ...note, sourceId: source.sourceId })),
    vaultSync: applied.state,
  }
}

function baseProject(): TerrainProject {
  const note: TerrainNote = {
    id: 'note-stable',
    fingerprint: 'stable',
    title: 'Note',
    content: 'base content',
    createdAt: '2026-08-01T08:00:00.000Z',
    createdAtMs: Date.parse('2026-08-01T08:00:00.000Z'),
    tags: ['math'],
    source: 'Note.md',
    sourcePath: 'Math/Note.md',
    vault: 'AtlasVault',
    weight: 1,
    links: [],
    x: 0,
    y: 0,
  }
  return {
    ...createProjectFromNotes('Vault sync', [note], 'deterministic-local-fallback'),
    id: 'project-vault-sync',
    createdAt: firstScanAt,
    updatedAt: firstScanAt,
    timeZone: 'UTC',
  }
}

function scan(options: {
  scannedAt: string
  path?: string
  hash?: string
  content?: string
  lastModifiedMs?: number
}): VaultScanResult {
  const note: NoteInput = {
    title: 'Note',
    content: options.content ?? 'base content',
    createdAt: '2026-08-01T08:00:00.000Z',
    tags: ['math'],
    source: options.path?.split('/').at(-1) ?? 'Note.md',
    sourcePath: options.path ?? 'Math/Note.md',
    vault: 'AtlasVault',
    weight: 1,
    links: [],
  }
  return {
    vaultId: 'vault-atlas',
    vaultName: 'AtlasVault',
    accessMode: 'reselect-files',
    scannedAt: options.scannedAt,
    complete: true,
    files: [{
      path: options.path ?? 'Math/Note.md',
      rawContentHash: options.hash ?? 'sha256:base',
      lastModifiedMs: options.lastModifiedMs ?? Date.parse('2026-08-01T08:00:00.000Z'),
      size: 42,
      note,
      invalidFields: [],
      issues: [],
    }],
    issues: [],
  }
}
