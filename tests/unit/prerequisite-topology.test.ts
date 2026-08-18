import { describe, expect, it } from 'vitest'
import { buildPrerequisiteTopology, materializePrerequisites } from '../../src/domain/prerequisite-topology'
import type { PrerequisiteInput, TerrainNote } from '../../src/domain/types'

describe('prerequisite topology', () => {
  it('derives deterministic max-parent depth, roots, and evidence across disciplines', () => {
    const notes = [
      note('algebra', 'Algebra', 0.1, 0.2),
      note('physics', 'Physics', -0.2, 0.3),
      note('calculus', 'Calculus', 0.4, -0.1, [yaml('Algebra')]),
      note('mechanics', 'Mechanics', 0.8, 0.7, [yaml('Physics'), yaml('Calculus', 'buildsOn')]),
      note('neutral', 'Unrelated', -0.8, -0.6),
    ]

    const topology = buildPrerequisiteTopology(notes)

    expect(topology.relations.map((relation) => [relation.fromItemId, relation.toItemId])).toEqual([
      ['algebra', 'calculus'],
      ['calculus', 'mechanics'],
      ['physics', 'mechanics'],
    ])
    expect(assignment(topology, 'mechanics')).toMatchObject({
      status: 'derived',
      depth: 2,
      branchRootIds: ['algebra', 'physics'],
    })
    expect(assignment(topology, 'mechanics').relationIds).toHaveLength(3)
    expect(assignment(topology, 'mechanics').sourceNoteIds).toEqual(['calculus', 'mechanics'])
    expect(assignment(topology, 'neutral')).toEqual({
      itemId: 'neutral',
      status: 'neutral',
      branchRootIds: [],
      relationIds: [],
      sourceNoteIds: [],
    })

    const reordered = buildPrerequisiteTopology([...notes].reverse())
    expect(reordered).toEqual(topology)
  })

  it('reports and excludes self-links, unresolved targets, ambiguous titles, and cycles', () => {
    const notes = [
      note('duplicate-a', 'Shared', 0, 0),
      note('duplicate-b', 'Shared', 0, 0),
      note('a', 'A', 0, 0, [yaml('B')]),
      note('b', 'B', 0, 0, [yaml('A')]),
      note('invalid', 'Invalid', 0, 0, [yaml('Invalid'), yaml('Missing'), yaml('Shared')]),
    ]

    const topology = buildPrerequisiteTopology(notes)

    expect(topology.diagnostics.map((diagnostic) => diagnostic.kind).sort()).toEqual([
      'ambiguous-title',
      'cycle',
      'self-link',
      'unresolved-target',
    ])
    expect(topology.relations).toEqual([])
    expect(assignment(topology, 'a').status).toBe('excluded')
    expect(assignment(topology, 'b').status).toBe('excluded')
    expect(assignment(topology, 'invalid').status).toBe('neutral')
  })

  it('changes only structural results when an explicit edge is reversed', () => {
    const coordinates = { a: [0.22, -0.31], b: [-0.47, 0.66] } as const
    const forward = [
      note('a', 'A', ...coordinates.a),
      note('b', 'B', ...coordinates.b, [yaml('A')]),
    ]
    const reversed = [
      note('a', 'A', ...coordinates.a, [yaml('B')]),
      note('b', 'B', ...coordinates.b),
    ]

    expect(assignment(buildPrerequisiteTopology(forward), 'b').depth).toBe(1)
    expect(assignment(buildPrerequisiteTopology(reversed), 'a').depth).toBe(1)
    expect(forward.map(({ id, x, y }) => ({ id, x, y }))).toEqual(reversed.map(({ id, x, y }) => ({ id, x, y })))
  })

  it('does not leak sibling branch evidence into a descendant path', () => {
    const notes = [
      note('root', 'Root', 0, 0),
      note('left', 'Left', -0.4, 0.2, [yaml('Root')]),
      note('right', 'Right', 0.4, 0.2, [yaml('Root')]),
    ]
    const topology = buildPrerequisiteTopology(notes)
    const leftRelation = topology.relations.find((relation) => relation.toItemId === 'left')!
    const rightRelation = topology.relations.find((relation) => relation.toItemId === 'right')!

    expect(assignment(topology, 'left').relationIds).toEqual([leftRelation.id])
    expect(assignment(topology, 'left').relationIds).not.toContain(rightRelation.id)
    expect(assignment(topology, 'root').relationIds).toEqual([leftRelation.id, rightRelation.id].sort())
  })
})

function note(
  id: string,
  title: string,
  x: number,
  y: number,
  prerequisites: PrerequisiteInput[] = [],
): TerrainNote {
  return {
    id,
    fingerprint: id,
    title,
    content: title,
    createdAt: '2026-08-01T00:00:00.000Z',
    createdAtMs: Date.parse('2026-08-01T00:00:00.000Z'),
    tags: [],
    weight: 1,
    links: [],
    prerequisites: materializePrerequisites(id, prerequisites),
    x,
    y,
  }
}

function yaml(target: string, sourceField: 'prerequisites' | 'buildsOn' = 'prerequisites'): PrerequisiteInput {
  return { target, provenance: 'yaml', sourceField }
}

function assignment(topology: ReturnType<typeof buildPrerequisiteTopology>, itemId: string) {
  return topology.assignments.find((candidate) => candidate.itemId === itemId)!
}
