import type {
  TerrainProject,
  VaultSyncNoteSnapshot,
  VaultWritebackRevision,
} from './types'
import { entityHash, fieldHashes } from './vault-sync'
import type { VaultWritebackField, VaultWritebackRequest } from './vault-writeback'

export interface VaultWritebackCommittedFile {
  sourceId: string
  path: string
  beforeByteHash: string
  afterByteHash: string
  afterText: string
  size: number
  requestIds: string[]
}

export function commitVaultWriteback(
  project: TerrainProject,
  requests: readonly VaultWritebackRequest[],
  files: readonly VaultWritebackCommittedFile[],
  acceptedAt: string,
): TerrainProject {
  if (!Number.isFinite(Date.parse(acceptedAt))) throw new Error('写回确认时间无效')
  const requestById = new Map(requests.map((request) => [request.id, request]))
  const noteById = new Map(project.notes.map((note) => [note.id, note]))
  const addedLinksByItem = new Map<string, string[]>()
  const writtenContentByItem = new Map<string, string>()
  const revisions: VaultWritebackRevision[] = []

  const sources = (project.vaultSync?.sources ?? []).map((source) => {
    const file = files.find((candidate) => candidate.sourceId === source.sourceId)
    if (!file) return source
    if (source.status !== 'present' || normalizePath(source.relativePath) !== normalizePath(file.path)) {
      throw new Error(`写回 source 已变化：${file.path}`)
    }
    if (source.rawContentHash !== file.beforeByteHash) throw new Error(`写回 source hash 已变化：${file.path}`)
    const note = noteById.get(source.itemId)
    if (!note) throw new Error(`写回笔记不存在：${file.path}`)
    const acceptedNote = cloneSnapshot(source.acceptedNote)
    let wroteWikiLink = false

    for (const requestId of file.requestIds) {
      const request = requestById.get(requestId)
      if (!request || request.sourceId !== source.sourceId) throw new Error(`写回请求与 source 不匹配：${requestId}`)
      if (request.kind === 'field') {
        applyAcceptedField(acceptedNote, note, request.field)
        continue
      }
      const target = project.vaultSync?.sources.find((candidate) => candidate.sourceId === request.targetSourceId)
      if (!target || target.status !== 'present' || target.vaultId !== source.vaultId) {
        throw new Error(`写回 WikiLink 目标已变化：${request.targetSourceId}`)
      }
      const link = target.relativePath.replace(/\.(?:md|markdown)$/i, '')
      wroteWikiLink = true
      if (!acceptedNote.links.some((value) => normalizeLink(value) === normalizeLink(link))) acceptedNote.links.push(link)
      const added = addedLinksByItem.get(source.itemId) ?? []
      if (!note.links.some((value) => normalizeLink(value) === normalizeLink(link)) && !added.includes(link)) added.push(link)
      addedLinksByItem.set(source.itemId, added)
    }
    if (wroteWikiLink) {
      const content = markdownBodyContent(file.afterText)
      acceptedNote.content = content
      writtenContentByItem.set(source.itemId, content)
    }

    revisions.push({
      id: `vault-writeback:${source.sourceId}:${hashId(`${acceptedAt}\n${file.afterByteHash}\n${file.requestIds.join('|')}`)}`,
      sourceId: source.sourceId,
      itemId: source.itemId,
      path: source.relativePath,
      beforeRawContentHash: source.rawContentHash,
      afterRawContentHash: file.afterByteHash,
      requestIds: [...file.requestIds],
      acceptedAt,
      provenance: 'vault-writeback',
    })
    return {
      ...source,
      rawContentHash: file.afterByteHash,
      entityHash: entityHash(acceptedNote),
      size: file.size,
      acceptedFieldHashes: fieldHashes(acceptedNote),
      acceptedNote,
      acceptedAt,
    }
  })

  if (revisions.length !== files.length) throw new Error('部分写回 source 无法提交到项目')
  return {
    ...project,
    updatedAt: acceptedAt,
    notes: project.notes.map((note) => {
      const added = addedLinksByItem.get(note.id)
      const content = writtenContentByItem.get(note.id)
      return added?.length || content !== undefined
        ? { ...note, content: content ?? note.content, links: [...note.links, ...(added ?? [])] }
        : note
    }),
    vaultSync: project.vaultSync && {
      ...project.vaultSync,
      sources,
      writebackRevisions: [
        ...(project.vaultSync.writebackRevisions ?? []),
        ...revisions,
      ],
    },
  }
}

function markdownBodyContent(text: string): string {
  const value = text.startsWith('\ufeff') ? text.slice(1) : text
  const opening = /^(?:---)[ \t]*(?:\r?\n)/.exec(value)
  if (!opening) return value.trim()
  const tail = value.slice(opening[0].length)
  const closing = /(?:^|\r?\n)---[ \t]*(?:\r?\n|$)/m.exec(tail)
  if (!closing) return value.trim()
  return tail.slice(closing.index + closing[0].length).trim()
}

function applyAcceptedField(
  accepted: VaultSyncNoteSnapshot,
  note: TerrainProject['notes'][number],
  field: VaultWritebackField,
): void {
  if (field === 'areas') {
    const areas = [...(note.areas ?? (note.area ? [note.area] : []))]
    accepted.areas = areas
    accepted.declaredAreas = areas
    return
  }
  if (field === 'mastery') accepted.mastery = note.mastery
  else if (field === 'confidence') accepted.confidence = note.confidence
  else if (field === 'exploration') accepted.exploration = note.exploration
  else if (field === 'status') accepted.status = note.status
  else accepted.reviewedAt = note.reviewedAt
}

function cloneSnapshot(source: VaultSyncNoteSnapshot): VaultSyncNoteSnapshot {
  return {
    ...source,
    tags: [...source.tags],
    areas: [...source.areas],
    declaredAreas: [...source.declaredAreas],
    links: [...source.links],
  }
}

function normalizePath(value: string): string {
  return value.normalize('NFKC').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/').toLocaleLowerCase()
}

function normalizeLink(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\.(?:md|markdown)$/i, '').replace(/^\.\//, '').toLocaleLowerCase()
}

function hashId(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
