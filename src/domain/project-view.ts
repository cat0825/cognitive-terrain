import type { TerrainNote, TerrainProject } from './types'

export function visibleNotesFor(
  project: TerrainProject,
  timeline: number,
  search: string,
  activeTags: string[],
): TerrainNote[] {
  const cutoff = timelineCutoff(project, timeline)
  const query = search.trim().toLocaleLowerCase()
  return project.notes.filter((note) => {
    if (note.createdAtMs > cutoff) return false
    if (activeTags.length && !activeTags.every((tag) => note.tags.includes(tag))) return false
    if (!query) return true
    return `${note.title}\n${note.content}\n${note.tags.join(' ')}`.toLocaleLowerCase().includes(query)
  })
}

export function projectTagCounts(project: TerrainProject): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>()
  for (const note of project.notes) {
    for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, count }))
}

function timelineCutoff(project: TerrainProject, timeline: number): number {
  if (!project.snapshots.length) return Number.POSITIVE_INFINITY
  const index = Math.min(project.snapshots.length - 1, Math.max(0, Math.ceil(timeline)))
  const bucket = project.snapshots[index].bucket
  if (bucket === 'empty') return Number.POSITIVE_INFINITY
  const [year, month] = bucket.split('-').map(Number)
  return Date.UTC(year, month, 1) - 1
}
