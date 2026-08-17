import type { TerrainNote, TerrainProject } from './types'

export interface NoteRelations {
  outgoing: TerrainNote[]
  incoming: TerrainNote[]
  unresolved: string[]
}

export interface MaintenanceCandidate {
  note: TerrainNote
  score: number
  reasons: string[]
}

export interface SemanticLinkCandidate {
  note: TerrainNote
  distance: number
}

export function resolveNoteRelations(notes: TerrainNote[], noteId: string): NoteRelations {
  const origin = notes.find((note) => note.id === noteId)
  if (!origin) return { outgoing: [], incoming: [], unresolved: [] }
  const index = buildNoteIndex(notes)
  const outgoing: TerrainNote[] = []
  const unresolved: string[] = []
  for (const link of origin.links) {
    const target = resolveLink(index, link)
    if (target && target.id !== origin.id && !outgoing.some((note) => note.id === target.id)) outgoing.push(target)
    else if (!target) unresolved.push(link)
  }
  const incoming = notes.filter((note) => note.id !== origin.id && note.links.some((link) => resolveLink(index, link)?.id === origin.id))
  return { outgoing, incoming, unresolved: [...new Set(unresolved)] }
}

export function linkedNotes(notes: TerrainNote[], noteId: string): TerrainNote[] {
  const relations = resolveNoteRelations(notes, noteId)
  return [...relations.outgoing, ...relations.incoming]
    .filter((note, index, all) => all.findIndex((candidate) => candidate.id === note.id) === index)
}

export function semanticLinkCandidates(notes: TerrainNote[], noteId: string, limit = 4): SemanticLinkCandidate[] {
  const origin = notes.find((note) => note.id === noteId)
  if (!origin) return []
  const explicit = new Set(linkedNotes(notes, noteId).map((note) => note.id))
  explicit.add(origin.id)
  return notes
    .filter((note) => !explicit.has(note.id))
    .map((note) => ({ note, distance: Math.hypot(origin.x - note.x, origin.y - note.y) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
}

export function maintenanceCandidates(project: TerrainProject, limit = 8, now = Date.now()): MaintenanceCandidate[] {
  const relationCounts = new Map(project.notes.map((note) => {
    const relations = resolveNoteRelations(project.notes, note.id)
    return [note.id, relations.outgoing.length + relations.incoming.length] as const
  }))
  return project.notes
    .filter((note) => note.status !== 'archived')
    .map((note) => scoreCandidate(note, relationCounts.get(note.id) ?? 0, now))
    .sort((a, b) => b.score - a.score || a.note.title.localeCompare(b.note.title))
    .slice(0, limit)
}

function scoreCandidate(note: TerrainNote, relationCount: number, now: number): MaintenanceCandidate {
  const reasons: string[] = []
  let score = 0
  if (note.mastery === undefined) {
    score += 0.48
    reasons.push('未评估熟练度')
  } else if (note.mastery < 0.45) {
    score += (0.45 - note.mastery) * 0.9 + 0.16
    reasons.push(`熟练度 ${Math.round(note.mastery * 100)}%`)
  }
  if (note.confidence !== undefined && note.confidence < 0.5) {
    score += (0.5 - note.confidence) * 0.35 + 0.08
    reasons.push('置信度偏低')
  }
  if ((note.exploration ?? 0) >= 0.65) {
    score += (note.exploration ?? 0) * 0.16
    reasons.push('探索意愿较高')
  }
  if (relationCount >= 3) {
    score += Math.min(0.16, relationCount * 0.025)
    reasons.push(`${relationCount} 条明确关系`)
  }
  const reviewedAt = note.reviewedAt ? Date.parse(note.reviewedAt) : Number.NaN
  if (Number.isNaN(reviewedAt)) {
    score += 0.1
    reasons.push('尚未记录复习')
  } else {
    const days = Math.max(0, (now - reviewedAt) / 86_400_000)
    if (days >= 30) {
      score += Math.min(0.18, days / 365)
      reasons.push(`${Math.floor(days)} 天未复习`)
    }
  }
  if (!reasons.length) reasons.push('状态稳定')
  return { note, score, reasons }
}

function buildNoteIndex(notes: TerrainNote[]): Map<string, TerrainNote[]> {
  const index = new Map<string, TerrainNote[]>()
  for (const note of notes) {
    for (const key of noteKeys(note)) {
      const values = index.get(key) ?? []
      values.push(note)
      index.set(key, values)
    }
  }
  return index
}

function resolveLink(index: Map<string, TerrainNote[]>, value: string): TerrainNote | undefined {
  const candidates = index.get(normalizeKey(value))
  return candidates?.length === 1 ? candidates[0] : undefined
}

function noteKeys(note: TerrainNote): string[] {
  const keys = [normalizeKey(note.title)]
  if (note.sourcePath) {
    keys.push(normalizeKey(note.sourcePath))
    keys.push(normalizeKey(note.sourcePath.split('/').at(-1) ?? note.sourcePath))
  }
  return [...new Set(keys.filter(Boolean))]
}

function normalizeKey(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\.md$/i, '').replace(/^\.\//, '').toLocaleLowerCase()
}
