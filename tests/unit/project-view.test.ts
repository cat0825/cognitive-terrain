import { describe, expect, it } from 'vitest'
import { visibleNotesFor } from '../../src/domain/project-view'
import type { TerrainNote, TerrainProject } from '../../src/domain/types'

describe('project timeline view', () => {
  it('uses the project calendar month instead of a UTC month cutoff', () => {
    const notes = [
      note('august-local', '2026-08-31T15:59:59.999Z'),
      note('september-local', '2026-08-31T16:00:00.000Z'),
    ]
    const project = {
      timeZone: 'Asia/Shanghai',
      notes,
      snapshots: [{ bucket: '2026-08' }],
    } as TerrainProject

    expect(visibleNotesFor(project, 0, '', []).map((item) => item.id)).toEqual(['august-local'])
  })
})

function note(id: string, createdAt: string): TerrainNote {
  return {
    id,
    fingerprint: id,
    title: id,
    content: id,
    createdAt,
    createdAtMs: Date.parse(createdAt),
    tags: [],
    weight: 1,
    links: [],
    x: 0,
    y: 0,
  }
}
