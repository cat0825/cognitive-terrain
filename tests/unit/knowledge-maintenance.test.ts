import { describe, expect, it } from 'vitest'
import { maintenanceCandidates, resolveNoteRelations, semanticLinkCandidates } from '../../src/domain/knowledge-maintenance'
import type { TerrainNote, TerrainProject } from '../../src/domain/types'

function note(id: string, title: string, links: string[] = [], patch: Partial<TerrainNote> = {}): TerrainNote {
  return {
    id,
    fingerprint: id,
    title,
    content: title,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdAtMs: Date.parse('2026-01-01T00:00:00.000Z'),
    tags: [],
    weight: 1,
    links,
    x: 0,
    y: 0,
    ...patch,
  }
}

describe('knowledge maintenance', () => {
  it('resolves outgoing, incoming, and unresolved wikilinks', () => {
    const notes = [note('a', 'A', ['B', 'Missing']), note('b', 'B', [], { links: ['A'] })]
    expect(resolveNoteRelations(notes, 'a')).toMatchObject({
      outgoing: [{ id: 'b' }],
      incoming: [{ id: 'b' }],
      unresolved: ['Missing'],
    })
  })

  it('prioritizes unassessed and low-mastery notes', () => {
    const project = { notes: [note('stable', 'Stable', [], { mastery: 0.9, confidence: 0.9 }), note('unknown', 'Unknown'), note('low', 'Low', [], { mastery: 0.1 })] } as TerrainProject
    const candidates = maintenanceCandidates(project, 3)
    expect(candidates.map((candidate) => candidate.note.id)).toEqual(['unknown', 'low', 'stable'])
    expect(candidates[0]?.reasons).toContain('未评估熟练度')
  })

  it('suggests nearby notes that are not explicitly linked', () => {
    const notes = [
      note('a', 'A', ['B'], { x: 0, y: 0 }),
      note('b', 'B', [], { x: 0.01, y: 0.01 }),
      note('c', 'C', [], { x: 0.02, y: 0.02 }),
      note('d', 'D', [], { x: 0.8, y: 0.8 }),
    ]
    expect(semanticLinkCandidates(notes, 'a').map((item) => item.note.id)).toEqual(['c', 'd'])
  })
})
