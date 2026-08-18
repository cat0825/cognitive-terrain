import { describe, expect, it } from 'vitest'
import { createProjectFromNotes } from '../../src/domain/demo'
import { snapshotFromTerrainNote } from '../../src/domain/vault-sync'
import {
  buildVaultWritebackPreview,
  sha256Bytes,
  type VaultWritebackReadFile,
  type VaultWritebackRequest,
} from '../../src/domain/vault-writeback'
import type { TerrainNote, TerrainProject, VaultSourceState } from '../../src/domain/types'

const createdAt = '2026-08-17T10:00:00.000Z'

describe('vault writeback preview', () => {
  it('replaces only the YAML scalar while preserving BOM, CRLF, and an inline comment', async () => {
    const text = '\ufeff---\r\nmastery: 0.2 # keep this comment\r\ntags: [math]\r\n---\r\nBody\r\n'
    const { project, files } = await fixture({ sourceText: text })

    const entry = await previewEntry(project, files, fieldRequest('mastery'))

    expect(entry.status).toBe('ready')
    expect(entry.afterText).toBe(
      '\ufeff---\r\nmastery: 0.8 # keep this comment\r\ntags: [math]\r\n---\r\nBody\r\n',
    )
    expect(entry.afterText.slice(0, 1)).toBe('\ufeff')
    expect(entry.afterText.replaceAll('\r\n', '')).not.toContain('\n')
  })

  it('creates frontmatter containing only the requested allowlisted field', async () => {
    const { project, files } = await fixture({ sourceText: 'Plain body\n' })

    const entry = await previewEntry(project, files, fieldRequest('confidence'))

    expect(entry.status).toBe('ready')
    expect(entry.afterText).toBe('---\nconfidence: 0.65\n---\nPlain body\n')
    expect(entry.afterText).not.toContain('title:')
    expect(entry.afterText).not.toContain('tags:')
    expect(entry.afterText).not.toContain('weight:')
  })

  it('applies multiple requests for one source in order without losing an earlier patch', async () => {
    const text = '---\nmastery: 0.2\n---\nBody\n'
    const { project, files } = await fixture({ sourceText: text })

    const preview = await buildVaultWritebackPreview(project, files, [
      fieldRequest('mastery'),
      fieldRequest('confidence'),
    ], createdAt)

    expect(preview.entries).toHaveLength(2)
    expect(preview.entries[0]).toMatchObject({
      status: 'ready',
      beforeText: text,
      afterText: '---\nmastery: 0.8\n---\nBody\n',
    })
    expect(preview.entries[1]).toMatchObject({
      status: 'ready',
      beforeText: preview.entries[0].afterText,
      afterText: '---\nmastery: 0.8\nconfidence: 0.65\n---\nBody\n',
      beforeByteHash: preview.entries[0].afterByteHash,
    })
  })

  it.each([
    ['invalid YAML', '---\nmastery: [\n---\nBody\n', 'invalid-yaml'],
    ['duplicate YAML keys', '---\nmastery: 0.2\nmastery: 0.3\n---\nBody\n', 'duplicate-key'],
    ['both area aliases', '---\narea: Math\nareas: [Physics]\n---\nBody\n', 'ambiguous-area-alias'],
  ])('blocks %s', async (_label, sourceText, blockCode) => {
    const { project, files } = await fixture({ sourceText })
    const request = blockCode === 'ambiguous-area-alias' ? fieldRequest('areas') : fieldRequest('mastery')

    const entry = await previewEntry(project, files, request)

    expect(entry).toMatchObject({ status: 'blocked', blockCode })
    expect(entry.afterText).toBe(sourceText)
    expect(entry.unifiedDiff).toBe('')
  })

  it('blocks a stale file hash before parsing or patching the source', async () => {
    const { project, files } = await fixture({ sourceText: '---\nmastery: 0.2\n---\nBody\n' })
    const staleFiles = files.map((file) => ({ ...file, byteHash: 'sha256:external-edit' }))

    const entry = await previewEntry(project, staleFiles, fieldRequest('mastery'))

    expect(entry).toMatchObject({
      status: 'blocked',
      blockCode: 'source-revision-mismatch',
      afterText: files[0].text,
      unifiedDiff: '',
    })
  })

  it('blocks a stale source path as a source revision mismatch', async () => {
    const { project, files } = await fixture({ sourceText: 'Body\n' })
    const movedFiles = files.map((file) => ({ ...file, path: 'Moved/Source.md' }))

    const entry = await previewEntry(project, movedFiles, fieldRequest('mastery'))

    expect(entry).toMatchObject({ status: 'blocked', blockCode: 'source-revision-mismatch' })
  })

  it('uses the vault-relative path when the target title is duplicated', async () => {
    const { project, files } = await fixture({ sourceText: 'Source body\n', duplicateTargetTitle: true })

    const entry = await previewEntry(project, files, wikiLinkRequest())

    expect(entry.status).toBe('ready')
    expect(entry.afterText).toBe('Source body\n[[Reference/Target]]')
    expect(entry.afterText).not.toContain('[[Target]]')
  })

  it('treats an existing full-path WikiLink as a no-op', async () => {
    const text = 'Source body\n\nSee [[Reference/Target|target note]].\n'
    const { project, files } = await fixture({ sourceText: text, duplicateTargetTitle: true })

    const entry = await previewEntry(project, files, wikiLinkRequest())

    expect(entry).toMatchObject({
      status: 'noop',
      beforeText: text,
      afterText: text,
      unifiedDiff: '',
    })
  })

  it.each([
    ['fenced code block', 'Source body\n```ts\nconst value = 1\n'],
    ['fenced code block closed with a different marker', 'Source body\n```ts\nconst value = 1\n~~~\n'],
    ['HTML comment', 'Source body\n<!-- unfinished\n'],
    ['WikiLink', 'Source body\n[[unfinished'],
    ['WikiLink with one closing bracket', 'Source body\n[[unfinished]'],
  ])('blocks an unclosed %s at the Markdown tail', async (_label, sourceText) => {
    const { project, files } = await fixture({ sourceText })

    const entry = await previewEntry(project, files, wikiLinkRequest())

    expect(entry).toMatchObject({ status: 'blocked', blockCode: 'unsafe-markdown-tail' })
    expect(entry.afterText).toBe(sourceText)
  })
})

function fieldRequest(field: 'mastery' | 'confidence' | 'areas'): VaultWritebackRequest {
  return { id: `request-${field}`, sourceId: 'source-main', kind: 'field', field }
}

function wikiLinkRequest(): VaultWritebackRequest {
  return {
    id: 'request-wikilink',
    sourceId: 'source-main',
    kind: 'wikilink',
    targetSourceId: 'source-target',
  }
}

async function previewEntry(
  project: TerrainProject,
  files: readonly VaultWritebackReadFile[],
  request: VaultWritebackRequest,
) {
  const preview = await buildVaultWritebackPreview(project, files, [request], createdAt)
  expect(preview.entries).toHaveLength(1)
  return preview.entries[0]
}

async function fixture(options: { sourceText: string; duplicateTargetTitle?: boolean }): Promise<{
  project: TerrainProject
  files: VaultWritebackReadFile[]
}> {
  const notes = [
    note({
      id: 'note-main',
      sourceId: 'source-main',
      title: 'Source',
      sourcePath: 'Notes/Source.md',
      mastery: 0.8,
      confidence: 0.65,
      areas: ['Math', 'Physics'],
    }),
    note({
      id: 'note-target',
      sourceId: 'source-target',
      title: 'Target',
      sourcePath: 'Reference/Target.md',
    }),
  ]
  if (options.duplicateTargetTitle) {
    notes.push(note({
      id: 'note-target-duplicate',
      sourceId: 'source-target-duplicate',
      title: 'Target',
      sourcePath: 'Archive/Target.md',
    }))
  }
  const rawTexts = new Map<string, string>([
    ['source-main', options.sourceText],
    ['source-target', 'Target body\n'],
    ['source-target-duplicate', 'Duplicate target body\n'],
  ])
  const sources = await Promise.all(notes.map(async (terrainNote) => {
    const text = rawTexts.get(terrainNote.sourceId!)!
    const bytes = new TextEncoder().encode(text)
    return source(terrainNote, await sha256Bytes(bytes))
  }))
  const base = createProjectFromNotes('Vault writeback', notes, 'deterministic-local-fallback')
  const project: TerrainProject = {
    ...base,
    id: 'project-vault-writeback',
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
      sources,
      revisions: [],
    },
  }
  const files = await Promise.all(sources.map(async (vaultSource): Promise<VaultWritebackReadFile> => {
    const text = rawTexts.get(vaultSource.sourceId)!
    const bytes = new TextEncoder().encode(text)
    return {
      sourceId: vaultSource.sourceId,
      path: vaultSource.relativePath,
      bytes,
      text,
      byteHash: await sha256Bytes(bytes),
    }
  }))
  return { project, files }
}

function note(options: {
  id: string
  sourceId: string
  title: string
  sourcePath: string
  mastery?: number
  confidence?: number
  areas?: string[]
}): TerrainNote {
  return {
    id: options.id,
    sourceId: options.sourceId,
    fingerprint: options.id,
    title: options.title,
    content: `${options.title} body`,
    createdAt,
    createdAtMs: Date.parse(createdAt),
    tags: [],
    source: options.sourcePath.split('/').at(-1),
    sourcePath: options.sourcePath,
    vault: 'Atlas',
    weight: 1,
    mastery: options.mastery,
    confidence: options.confidence,
    areas: options.areas,
    links: [],
    x: 0,
    y: 0,
  }
}

function source(terrainNote: TerrainNote, rawContentHash: string): VaultSourceState {
  return {
    sourceId: terrainNote.sourceId!,
    itemId: terrainNote.id,
    vaultId: 'vault-atlas',
    relativePath: terrainNote.sourcePath!,
    status: 'present',
    rawContentHash,
    entityHash: `entity:${terrainNote.id}`,
    acceptedFieldHashes: {},
    acceptedNote: snapshotFromTerrainNote(terrainNote),
    acceptedAt: createdAt,
  }
}
