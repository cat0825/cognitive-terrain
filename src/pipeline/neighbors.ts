import type { TerrainNote } from '../domain/types'

export interface NeighborMatch {
  id: string
  title: string
  tags: string[]
  distance: number
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

function toMatch(note: TerrainNote): NeighborMatch {
  return { id: note.id, title: note.title, tags: note.tags, distance: 0 }
}
