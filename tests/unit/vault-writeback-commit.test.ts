import { describe, expect, it } from 'vitest'
import { createProjectFromNotes } from '../../src/domain/demo'
import {
  commitVaultWriteback,
  type VaultWritebackCommittedFile,
} from '../../src/domain/vault-writeback-commit'
import { vaultWritebackCandidates } from '../../src/domain/vault-writeback-candidates'
import {
  entityHash,
  fieldHashes,
  snapshotFromTerrainNote,
} from '../../src/domain/vault-sync'
import type {
  TerrainNote,
  TerrainProject,
  VaultSourceState,
  VaultSyncNoteSnapshot,
  VaultSyncRevision,
} from '../../src/domain/types'
import type { VaultWritebackRequest } from '../../src/domain/vault-writeback'

const createdAt = '2026-08-17T08:00:00.000Z'
const acceptedAt = '2026-08-18T09:30:00.000Z'

describe('vault writeback candidates', () => {
  it('only offers writable allowlisted fields changed from the accepted snapshot', () => {
    const project = fixture()
    const source = project.vaultSync!.sources[0]
    source.acceptedNote = {
      ...source.acceptedNote,
      title: 'Old title that must not become a candidate',
      content: 'Old body that must not become a candidate',
      mastery: 0.2,
      confidence: project.notes[0].confidence,
      exploration: 0.1,
      status: 'growing',
      areas: ['Physics'],
      declaredAreas: ['Physics'],
    }

    const candidates = vaultWritebackCandidates(project, project.notes[0].id)

    expect(candidates.map((candidate) => candidate.request.kind === 'field'
      ? candidate.request.field
      : candidate.request.kind).sort()).toEqual(['areas', 'mastery', 'status'])
    expect(candidates.every((candidate) => candidate.request.sourceId === source.sourceId)).toBe(true)
  })
})

describe('vault writeback commit', () => {
  it('commits one field into the accepted snapshot and records a separate writeback revision', () => {
    const project = fixture()
    const source = project.vaultSync!.sources[0]
    const request = fieldRequest(source.sourceId, 'mastery')
    const file = committedFile(source, [request.id], 'sha256:after-mastery')
    const expectedAccepted = {
      ...cloneSnapshot(source.acceptedNote),
      mastery: project.notes[0].mastery,
    }

    const committed = commitVaultWriteback(project, [request], [file], acceptedAt)
    const committedSource = committed.vaultSync!.sources[0]

    expect(committed.updatedAt).toBe(acceptedAt)
    expect(committedSource).toMatchObject({
      rawContentHash: file.afterByteHash,
      entityHash: entityHash(expectedAccepted),
      size: file.size,
      acceptedAt,
      acceptedNote: expectedAccepted,
      acceptedFieldHashes: fieldHashes(expectedAccepted),
    })
    expect(committed.vaultSync!.revisions).toEqual(project.vaultSync!.revisions)
    expect(committed.vaultSync!.writebackRevisions).toMatchObject([{
      sourceId: source.sourceId,
      itemId: source.itemId,
      path: source.relativePath,
      beforeRawContentHash: source.rawContentHash,
      afterRawContentHash: file.afterByteHash,
      requestIds: [request.id],
      acceptedAt,
      provenance: 'vault-writeback',
    }])
    expect(project.vaultSync!.writebackRevisions).toBeUndefined()
    expect(project.vaultSync!.sources[0].rawContentHash).toBe('sha256:source-before')
  })

  it('commits multiple fields from one file and refreshes all accepted field hashes', () => {
    const project = fixture({ acceptedConfidence: 0.3, exploration: 0.6 })
    const source = project.vaultSync!.sources[0]
    const requests = [
      fieldRequest(source.sourceId, 'confidence'),
      fieldRequest(source.sourceId, 'exploration'),
      fieldRequest(source.sourceId, 'areas'),
    ]
    const file = committedFile(source, requests.map((request) => request.id), 'sha256:after-fields')
    const expectedAccepted = {
      ...cloneSnapshot(source.acceptedNote),
      confidence: project.notes[0].confidence,
      exploration: project.notes[0].exploration,
      areas: ['Mathematics'],
      declaredAreas: ['Mathematics'],
    }

    const committed = commitVaultWriteback(project, requests, [file], acceptedAt)
    const committedSource = committed.vaultSync!.sources[0]

    expect(committedSource.acceptedNote).toEqual(expectedAccepted)
    expect(committedSource.acceptedFieldHashes).toEqual(fieldHashes(expectedAccepted))
    expect(committedSource.rawContentHash).toBe(file.afterByteHash)
    expect(committed.vaultSync!.writebackRevisions?.[0].requestIds).toEqual(requests.map((request) => request.id))
  })

  it('commits a WikiLink into both the live note and its accepted snapshot', () => {
    const project = fixture()
    const [source, target] = project.vaultSync!.sources
    const request: VaultWritebackRequest = {
      id: `wikilink:${source.sourceId}:${target.sourceId}`,
      sourceId: source.sourceId,
      kind: 'wikilink',
      targetSourceId: target.sourceId,
    }
    const file = {
      ...committedFile(source, [request.id], 'sha256:after-link'),
      afterText: '---\nmastery: 0.8\n---\nSource body\n[[References/Target]]',
    }

    const committed = commitVaultWriteback(project, [request], [file], acceptedAt)
    const expectedLink = 'References/Target'
    const committedNote = committed.notes.find((note) => note.id === source.itemId)!
    const committedSource = committed.vaultSync!.sources.find((candidate) => candidate.sourceId === source.sourceId)!

    expect(committedNote.links).toEqual([expectedLink])
    expect(committedNote.content).toBe('Source body\n[[References/Target]]')
    expect(committedSource.acceptedNote.links).toEqual([expectedLink])
    expect(committedSource.acceptedNote.content).toBe('Source body\n[[References/Target]]')
    expect(committedSource.acceptedFieldHashes.links)
      .toBe(fieldHashes(committedSource.acceptedNote).links)
    expect(project.notes.find((note) => note.id === source.itemId)!.links).toEqual([])
  })

  it.each([
    {
      name: 'a stale source hash',
      prepare: (project: TerrainProject) => ({
        project,
        request: fieldRequest(project.vaultSync!.sources[0].sourceId, 'mastery'),
        file: { ...committedFile(project.vaultSync!.sources[0], [], 'sha256:after'), beforeByteHash: 'sha256:stale' },
        error: 'source hash',
      }),
    },
    {
      name: 'a stale source path',
      prepare: (project: TerrainProject) => ({
        project,
        request: fieldRequest(project.vaultSync!.sources[0].sourceId, 'mastery'),
        file: { ...committedFile(project.vaultSync!.sources[0], [], 'sha256:after'), path: 'Moved/Source.md' },
        error: 'source 已变化',
      }),
    },
    {
      name: 'a missing source',
      prepare: (project: TerrainProject) => ({
        project,
        request: fieldRequest('source-missing', 'mastery'),
        file: {
          sourceId: 'source-missing',
          path: 'Missing.md',
          beforeByteHash: 'sha256:missing',
          afterByteHash: 'sha256:after',
          size: 1,
          requestIds: ['field:source-missing:mastery'],
        },
        error: '部分写回 source',
      }),
    },
  ])('blocks $name', ({ prepare }) => {
    const result = prepare(fixture())
    result.file.requestIds = [result.request.id]

    expect(() => commitVaultWriteback(result.project, [result.request], [result.file], acceptedAt))
      .toThrow(result.error)
  })

  it('blocks a missing WikiLink target', () => {
    const project = fixture()
    const source = project.vaultSync!.sources[0]
    const request: VaultWritebackRequest = {
      id: 'wikilink:source-main:source-missing',
      sourceId: source.sourceId,
      kind: 'wikilink',
      targetSourceId: 'source-missing',
    }
    const file = committedFile(source, [request.id], 'sha256:after')

    expect(() => commitVaultWriteback(project, [request], [file], acceptedAt))
      .toThrow('WikiLink 目标已变化')
  })
})

function fixture(options: { acceptedConfidence?: number; exploration?: number } = {}): TerrainProject {
  const sourceNote = note({
    id: 'note-main',
    sourceId: 'source-main',
    title: 'Source',
    sourcePath: 'Topics/Source.md',
    mastery: 0.8,
    confidence: 0.7,
    exploration: options.exploration,
    status: 'stable',
    area: 'Mathematics',
  })
  const targetNote = note({
    id: 'note-target',
    sourceId: 'source-target',
    title: 'Target',
    sourcePath: 'References/Target.markdown',
  })
  const base = createProjectFromNotes('Vault writeback commit', [sourceNote, targetNote], 'deterministic-local-fallback')
  const sourceAccepted = snapshotFromTerrainNote(sourceNote)
  sourceAccepted.mastery = 0.2
  sourceAccepted.confidence = options.acceptedConfidence ?? sourceNote.confidence
  sourceAccepted.exploration = 0.1
  sourceAccepted.status = 'growing'
  sourceAccepted.areas = ['Physics']
  sourceAccepted.declaredAreas = ['Physics']
  const sources = [
    source(sourceNote, sourceAccepted, 'sha256:source-before'),
    source(targetNote, snapshotFromTerrainNote(targetNote), 'sha256:target-before'),
  ]

  return {
    ...base,
    id: 'project-writeback-commit',
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
      revisions: [syncRevision(sources[0])],
    },
  }
}

function note(options: {
  id: string
  sourceId: string
  title: string
  sourcePath: string
  mastery?: number
  confidence?: number
  exploration?: number
  status?: TerrainNote['status']
  area?: string
}): TerrainNote {
  return {
    id: options.id,
    sourceId: options.sourceId,
    fingerprint: options.id,
    title: options.title,
    content: `${options.title} body`,
    createdAt,
    createdAtMs: Date.parse(createdAt),
    tags: ['vault'],
    source: options.sourcePath.split('/').at(-1),
    sourcePath: options.sourcePath,
    vault: 'Atlas',
    weight: 1,
    mastery: options.mastery,
    confidence: options.confidence,
    exploration: options.exploration,
    status: options.status,
    area: options.area,
    links: [],
    x: 0,
    y: 0,
  }
}

function source(
  terrainNote: TerrainNote,
  acceptedNote: VaultSyncNoteSnapshot,
  rawContentHash: string,
): VaultSourceState {
  return {
    sourceId: terrainNote.sourceId!,
    itemId: terrainNote.id,
    vaultId: 'vault-atlas',
    relativePath: terrainNote.sourcePath!,
    status: 'present',
    rawContentHash,
    entityHash: entityHash(acceptedNote),
    size: 100,
    acceptedFieldHashes: fieldHashes(acceptedNote),
    acceptedNote,
    acceptedAt: createdAt,
  }
}

function syncRevision(sourceState: VaultSourceState): VaultSyncRevision {
  return {
    id: 'vault-revision:source-main:add',
    sourceId: sourceState.sourceId,
    itemId: sourceState.itemId,
    operation: 'add',
    rawContentHash: sourceState.rawContentHash,
    entityHash: sourceState.entityHash,
    acceptedAt: createdAt,
    occurredAt: createdAt,
    timestampSource: 'accepted-at',
    provenance: 'vault-sync',
  }
}

function committedFile(
  sourceState: VaultSourceState,
  requestIds: string[],
  afterByteHash: string,
): VaultWritebackCommittedFile {
  return {
    sourceId: sourceState.sourceId,
    path: sourceState.relativePath,
    beforeByteHash: sourceState.rawContentHash,
    afterByteHash,
    afterText: 'Source body',
    size: 321,
    requestIds,
  }
}

function fieldRequest(
  sourceId: string,
  field: Extract<VaultWritebackRequest, { kind: 'field' }>['field'],
): VaultWritebackRequest {
  return {
    id: `field:${sourceId}:${field}`,
    sourceId,
    kind: 'field',
    field,
  }
}

function cloneSnapshot(snapshot: VaultSyncNoteSnapshot): VaultSyncNoteSnapshot {
  return {
    ...snapshot,
    tags: [...snapshot.tags],
    areas: [...snapshot.areas],
    declaredAreas: [...snapshot.declaredAreas],
    links: [...snapshot.links],
  }
}
