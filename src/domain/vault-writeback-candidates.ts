import type { TerrainProject, VaultSyncNoteSnapshot } from './types'
import type { VaultWritebackField, VaultWritebackRequest } from './vault-writeback'

const FIELD_ORDER: readonly VaultWritebackField[] = [
  'mastery',
  'confidence',
  'exploration',
  'status',
  'areas',
  'reviewedAt',
]

export interface VaultWritebackCandidate {
  request: VaultWritebackRequest
  itemId: string
  noteTitle: string
  path: string
  label: string
}

export function vaultWritebackCandidates(
  project: TerrainProject,
  itemId?: string,
): VaultWritebackCandidate[] {
  const noteById = new Map(project.notes.map((note) => [note.id, note]))
  const candidates: VaultWritebackCandidate[] = []

  for (const source of project.vaultSync?.sources ?? []) {
    if (source.status !== 'present' || (itemId && source.itemId !== itemId)) continue
    const note = noteById.get(source.itemId)
    if (!note) continue
    for (const field of FIELD_ORDER) {
      const current = fieldValue(note, field)
      if (!isWritableValue(field, current) || equalValue(current, fieldValue(source.acceptedNote, field))) continue
      candidates.push({
        request: {
          id: `field:${source.sourceId}:${field}`,
          sourceId: source.sourceId,
          kind: 'field',
          field,
        },
        itemId: note.id,
        noteTitle: note.title,
        path: source.relativePath,
        label: fieldLabel(field),
      })
    }
  }

  return candidates.sort((left, right) => left.path.localeCompare(right.path) || left.label.localeCompare(right.label))
}

export function vaultWikiLinkCandidate(
  project: TerrainProject,
  sourceItemId: string,
  targetItemId: string,
): VaultWritebackCandidate | undefined {
  const source = project.vaultSync?.sources.find((candidate) => candidate.itemId === sourceItemId && candidate.status === 'present')
  const target = project.vaultSync?.sources.find((candidate) => candidate.itemId === targetItemId && candidate.status === 'present')
  const sourceNote = project.notes.find((note) => note.id === sourceItemId)
  const targetNote = project.notes.find((note) => note.id === targetItemId)
  if (!source || !target || !sourceNote || !targetNote || source.vaultId !== target.vaultId) return undefined
  return {
    request: {
      id: `wikilink:${source.sourceId}:${target.sourceId}`,
      sourceId: source.sourceId,
      kind: 'wikilink',
      targetSourceId: target.sourceId,
    },
    itemId: sourceNote.id,
    noteTitle: sourceNote.title,
    path: source.relativePath,
    label: `WikiLink -> ${targetNote.title}`,
  }
}

function fieldValue(
  note: TerrainProject['notes'][number] | VaultSyncNoteSnapshot,
  field: VaultWritebackField,
): unknown {
  if (field === 'areas') return note.areas?.length
    ? [...note.areas]
    : 'area' in note && note.area
      ? [note.area]
      : []
  return note[field]
}

function isWritableValue(field: VaultWritebackField, value: unknown): boolean {
  if (field === 'areas') return Array.isArray(value) && value.length > 0
  return value !== undefined && value !== null && value !== ''
}

function equalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function fieldLabel(field: VaultWritebackField): string {
  if (field === 'mastery') return '熟练度'
  if (field === 'confidence') return '置信度'
  if (field === 'exploration') return '探索度'
  if (field === 'status') return '状态'
  if (field === 'areas') return '领域'
  return '最近复习时间'
}
