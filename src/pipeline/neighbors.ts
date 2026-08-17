import type { NoteNeighborEvidence, TerrainNote, TerrainProject } from '../domain/types'

export const EMBEDDING_NEIGHBOR_FORMULA_VERSION = 'embedding-cosine-neighbors-v1' as const

export interface NeighborMatch {
  id: string
  title: string
  tags: string[]
  distance: number
}

export interface EmbeddingNeighborResult {
  noteNeighbors: string[][]
  noteNeighborEvidence: NoteNeighborEvidence[][]
}

export function computeEmbeddingNeighbors(
  notes: readonly TerrainNote[],
  vectors: readonly (readonly number[])[],
  modelId: string,
  embeddingMode: Extract<TerrainProject['embeddingMode'], 'semantic' | 'fallback'>,
  k = 6,
  candidateIndices?: readonly (readonly number[])[],
): EmbeddingNeighborResult {
  if (notes.length !== vectors.length) throw new RangeError('notes and vectors must have equal length')
  const noteNeighborEvidence = notes.map((note, sourceIndex) => {
    const candidates = candidateIndices?.[sourceIndex]
      ?? vectors.map((_targetVector, targetIndex) => targetIndex)
    return candidates
    .map((targetIndex) => ({
      targetIndex,
      score: cosineSimilarity(vectors[sourceIndex] ?? [], vectors[targetIndex] ?? []),
    }))
    .filter(({ targetIndex }) => targetIndex !== sourceIndex)
    .sort((left, right) => right.score - left.score
      || (notes[left.targetIndex]?.id ?? '').localeCompare(notes[right.targetIndex]?.id ?? ''))
    .slice(0, Math.max(0, k))
    .flatMap(({ targetIndex, score }, rank) => {
      const target = notes[targetIndex]
      if (!target) return []
      return [{
        sourceId: note.id,
        targetId: target.id,
        rank: rank + 1,
        score,
        modelId,
        embeddingMode,
        formulaVersion: EMBEDDING_NEIGHBOR_FORMULA_VERSION,
        provenance: 'embedding',
      } satisfies NoteNeighborEvidence]
    })
  })
  return {
    noteNeighbors: noteNeighborEvidence.map((evidence) => evidence.map((entry) => entry.targetId)),
    noteNeighborEvidence,
  }
}

export function computeNeighbors(
  notes: TerrainNote[],
  k = 6,
): string[][] {
  return notes.map((note, index) => {
    const scored = notes
      .map((other, otherIndex) => ({
        other,
        otherIndex,
        distance: coordinateDistance(note, other) - tagOverlap(note, other) * 0.2,
      }))
      .filter(({ otherIndex }) => otherIndex !== index)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k)
    return scored
      .map(({ otherIndex }) => notes[otherIndex]?.id)
      .filter((id): id is string => id !== undefined)
  })
}

export function findNeighbors(
  project: { notes: TerrainNote[]; noteNeighbors?: string[][] },
  noteId: string,
  k = 6,
): NeighborMatch[] {
  const ownNeighbors = project.noteNeighbors?.[project.notes.findIndex((note) => note.id === noteId)]
  if (ownNeighbors?.length) {
    const byId = new Map(project.notes.map((note) => [note.id, note]))
    return ownNeighbors
      .slice(0, k)
      .map((id) => byId.get(id))
      .filter((note): note is TerrainNote => Boolean(note))
      .map(toMatch)
  }
  const origin = project.notes.find((note) => note.id === noteId)
  if (!origin) return []
  return project.notes
    .filter((note) => note.id !== noteId)
    .map((note) => ({
      note,
      distance: coordinateDistance(origin, note) - tagOverlap(origin, note) * 0.2,
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, k)
    .map(({ note }) => toMatch(note))
}

function coordinateDistance(a: TerrainNote, b: TerrainNote): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function tagOverlap(a: TerrainNote, b: TerrainNote): number {
  const bTags = new Set(b.tags)
  return a.tags.filter((tag) => bTags.has(tag)).length
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) return 0
  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0
    const rightValue = right[index] ?? 0
    dot += leftValue * rightValue
    leftMagnitude += leftValue * leftValue
    rightMagnitude += rightValue * rightValue
  }
  const denominator = Math.sqrt(leftMagnitude * rightMagnitude)
  return denominator > 0 ? Math.max(-1, Math.min(1, dot / denominator)) : 0
}

function toMatch(note: TerrainNote): NeighborMatch {
  return { id: note.id, title: note.title, tags: note.tags, distance: 0 }
}
