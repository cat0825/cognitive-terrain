import { describe, expect, it } from 'vitest'
import { createProjectFromNotes } from '../../src/domain/demo'
import { applyVaultSync } from '../../src/domain/vault-sync'
import type { TerrainNote, TerrainProject } from '../../src/domain/types'
import { scanVaultFiles } from '../../src/import/vault-sync'

const firstScanAt = '2026-08-17T08:00:00.000Z'
const secondScanAt = '2026-08-18T08:00:00.000Z'

describe('vault file scanner', () => {
  it('hashes every file but does not reparse unchanged Markdown', async () => {
    const project = baseProject()
    const file = vaultFile('base content')
    const bootstrap = await scanVaultFiles([file], project, firstScanAt)
    const applied = applyVaultSync(project, bootstrap, [])
    const source = applied.state.sources[0]
    const linked: TerrainProject = {
      ...project,
      notes: project.notes.map((note) => ({ ...note, sourceId: source.sourceId })),
      vaultSync: applied.state,
    }

    expect(bootstrap.scanFiles[0].note).toBeDefined()
    const repeated = await scanVaultFiles([file], linked, secondScanAt)
    expect(repeated.scanFiles[0].note).toBeUndefined()
    expect(repeated.changes).toEqual([])
    expect(repeated.unchangedCount).toBe(1)
  })

  it('does not infer a deletion when one file cannot be read', async () => {
    const project = baseProject()
    const file = vaultFile('base content')
    const bootstrap = await scanVaultFiles([file], project, firstScanAt)
    const applied = applyVaultSync(project, bootstrap, [])
    const linked: TerrainProject = { ...project, vaultSync: applied.state }
    const unreadable = vaultFile('base content')
    Object.defineProperty(unreadable, 'arrayBuffer', {
      value: () => Promise.reject(new DOMException('permission denied', 'NotAllowedError')),
    })

    const preview = await scanVaultFiles([unreadable], linked, secondScanAt)
    expect(preview.complete).toBe(false)
    expect(preview.changes).toEqual([])
    expect(preview.issues[0].message).toContain('permission denied')
  })

  it('hashes original bytes so a BOM-only change is not treated as unchanged', async () => {
    const project = baseProject()
    const plain = await scanVaultFiles([vaultFile('base content')], project, firstScanAt)
    const withBom = await scanVaultFiles([vaultFile('\ufeffbase content')], project, firstScanAt)

    expect(withBom.scanFiles[0].note?.content).toBe('base content')
    expect(withBom.scanFiles[0].rawContentHash).not.toBe(plain.scanFiles[0].rawContentHash)
  })

  it('reports invalid UTF-8 as partial I/O instead of replacing bytes', async () => {
    const file = vaultFile(new Uint8Array([0xc3, 0x28]))
    const preview = await scanVaultFiles([file], baseProject(), firstScanAt)

    expect(preview.complete).toBe(false)
    expect(preview.changes).toEqual([])
    expect(preview.issues[0].message).toContain('不是有效的 UTF-8')
  })
})

function baseProject(): TerrainProject {
  const note: TerrainNote = {
    id: 'note-stable',
    fingerprint: 'stable',
    title: 'Note',
    content: 'base content',
    createdAt: '2026-08-01T08:00:00.000Z',
    createdAtMs: Date.parse('2026-08-01T08:00:00.000Z'),
    tags: [],
    source: 'Note.md',
    sourcePath: 'Math/Note.md',
    vault: 'AtlasVault',
    weight: 1,
    links: [],
    x: 0,
    y: 0,
  }
  return {
    ...createProjectFromNotes('Vault scan', [note], 'deterministic-local-fallback'),
    id: 'project-vault-scan',
    createdAt: firstScanAt,
    updatedAt: firstScanAt,
    timeZone: 'UTC',
  }
}

function vaultFile(content: BlobPart): File {
  const file = new File([content], 'Note.md', {
    type: 'text/markdown',
    lastModified: Date.parse('2026-08-01T08:00:00.000Z'),
  })
  Object.defineProperty(file, 'webkitRelativePath', { value: 'AtlasVault/Math/Note.md' })
  return file
}
