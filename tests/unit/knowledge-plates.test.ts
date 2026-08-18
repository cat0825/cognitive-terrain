import { describe, expect, it } from 'vitest'
import {
  buildPlateBridges,
  buildPlateCollisions,
  areasForNote,
  normalizeArea,
  plateColor,
  plateIdForArea,
  similarityReasons,
  summarizeKnowledgePlates,
} from '../../src/domain/knowledge-plates'
import type { TerrainNote, TerrainProject } from '../../src/domain/types'
import { visibleNotesFor } from '../../src/domain/project-view'

function note(id: string, title: string, area: string | undefined, patch: Partial<TerrainNote> = {}): TerrainNote {
  return {
    id,
    fingerprint: id,
    title,
    content: title,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdAtMs: Date.parse('2026-01-01T00:00:00.000Z'),
    tags: [],
    weight: 1,
    area,
    links: [],
    x: 0,
    y: 0,
    ...patch,
  }
}

describe('knowledge plates', () => {
  it('normalizes YAML areas into stable plate ids and colors', () => {
    expect(normalizeArea('  数学  ')).toBe('数学')
    expect(plateIdForArea('Math')).toBe(plateIdForArea(' math '))
    expect(plateColor('Math')).toBe(plateColor(' math '))
    expect(new Set(['Math', 'History', 'Physics'].map(plateColor)).size).toBeGreaterThan(1)
    expect(areasForNote({ area: ' Math ', areas: ['math', ' 物理 ', '物理'] })).toEqual(['Math', '物理'])
  })

  it('summarizes plate membership and resolved cross-area WikiLinks', () => {
    const notes = [
      note('algebra', 'Algebra', '数学', { links: ['Mechanics'], tags: ['linear'] }),
      note('proof', 'Proof', '数学', { x: 0.2 }),
      note('mechanics', 'Mechanics', '物理', { x: 0.1, tags: ['linear'] }),
      note('loose', 'Loose', undefined),
    ]
    const summaries = summarizeKnowledgePlates(notes)
    const math = summaries.find((plate) => plate.label === '数学')
    const physics = summaries.find((plate) => plate.label === '物理')

    expect(math).toMatchObject({ noteCount: 2, crossLinkCount: 1 })
    expect(physics).toMatchObject({ noteCount: 1, crossLinkCount: 1 })
    expect(buildPlateBridges(notes)).toMatchObject([
      { fromId: 'algebra', toId: 'mechanics', kind: 'wikilink', sharedTags: ['linear'] },
    ])
  })

  it('does not invent a bridge from layout proximity alone', () => {
    const bridges = buildPlateBridges([
      note('math', 'Math', '数学', { x: 0, y: 0 }),
      note('physics', 'Physics', '物理', { x: 0.15, y: 0.1 }),
    ])
    expect(bridges).toEqual([])
  })

  it('does not invent a bridge or wikilink reason for an ambiguous title', () => {
    const notes = [
      note('origin', 'Origin', '数学', { links: ['Shared'] }),
      note('first', 'Shared', '物理', { sourcePath: 'first/Shared.md' }),
      note('second', 'Shared', '历史', { sourcePath: 'second/Shared.md' }),
    ]

    expect(buildPlateBridges(notes)).toEqual([])
    expect(similarityReasons(notes, 'origin', 'first').map((reason) => reason.kind)).not.toContain('wikilink')
    expect(similarityReasons(notes, 'origin', 'second').map((reason) => reason.kind)).not.toContain('wikilink')
  })

  it('does not classify a WikiLink as cross-plate when notes share any membership', () => {
    const notes = [
      note('quantum', 'Quantum', '数学', { areas: ['数学', '物理'], links: ['Mechanics'] }),
      note('mechanics', 'Mechanics', '物理'),
    ]

    expect(buildPlateBridges(notes)).toEqual([])
    expect(similarityReasons(notes, 'quantum', 'mechanics').map((reason) => reason.label)).toContain('同属 物理')
  })

  it('aggregates dense plate pairs into an explainable collision band', () => {
    const notes = [
      note('m1', 'Math 1', '数学', { links: ['Physics 1'], x: -0.4, y: 0.2 }),
      note('m2', 'Math 2', '数学', { links: ['Physics 1'], x: -0.2, y: 0 }),
      note('m3', 'Math 3', '数学', { links: ['Physics 2'], x: 0, y: -0.2 }),
      note('p1', 'Physics 1', '物理', { x: 0.4, y: 0.2 }),
      note('p2', 'Physics 2', '物理', { x: 0.2, y: -0.2 }),
      note('history', 'History', '历史', { links: ['Physics 2'] }),
    ]

    const collisions = buildPlateCollisions(notes)
    const dense = collisions.find((collision) => collision.relationCount === 3)
    const sparse = collisions.find((collision) => collision.relationCount === 1)

    expect(dense).toMatchObject({
      firstArea: '数学',
      secondArea: '物理',
      relationCount: 3,
      mode: 'band',
    })
    expect(dense?.firstAnchor.x).toBeCloseTo(-0.2)
    expect(dense?.firstAnchor.y).toBeCloseTo(0)
    expect(dense?.strength).toBeGreaterThan(0.6)
    expect(dense?.bridges).toHaveLength(3)
    expect(sparse).toMatchObject({ relationCount: 1, mode: 'lines' })
  })

  it('keeps resolved link direction evidence while retaining unique-pair relation counts', () => {
    const notes = [
      note('a', 'A', 'alpha', { links: ['B', 'B'] }),
      note('b', 'B', 'beta', { links: ['A'] }),
    ]

    const bridges = buildPlateBridges(notes)
    const collision = buildPlateCollisions(notes)[0]

    expect(bridges.map(({ id }) => id)).toEqual(['bridge-a-b'])
    expect(bridges[0]?.evidence.map(({ fromId, toId }) => `${fromId}->${toId}`)).toEqual(['a->b', 'a->b', 'b->a'])
    expect(collision).toMatchObject({
      relationCount: 1,
      firstToSecondCount: 2,
      secondToFirstCount: 1,
      bidirectionalCount: 1,
      direction: 'neutral',
    })
    expect(collision?.directionConfidence).toBeCloseTo(1 / 3)
  })

  it('exposes a deterministic direction only with enough one-way evidence', () => {
    const forward = [
      note('a1', 'A1', 'alpha', { links: ['B1'] }),
      note('a2', 'A2', 'alpha', { links: ['B2'] }),
      note('a3', 'A3', 'alpha', { links: ['B3'] }),
      note('b1', 'B1', 'beta'),
      note('b2', 'B2', 'beta'),
      note('b3', 'B3', 'beta'),
    ]
    const reverse = [
      note('a1', 'A1', 'alpha'),
      note('a2', 'A2', 'alpha'),
      note('a3', 'A3', 'alpha'),
      note('b1', 'B1', 'beta', { links: ['A1'] }),
      note('b2', 'B2', 'beta', { links: ['A2'] }),
      note('b3', 'B3', 'beta', { links: ['A3'] }),
    ]

    const forwardCollision = buildPlateCollisions(forward)[0]
    const reverseCollision = buildPlateCollisions(reverse)[0]

    expect(forwardCollision).toMatchObject({
      firstArea: 'alpha',
      secondArea: 'beta',
      firstToSecondCount: 3,
      secondToFirstCount: 0,
      bidirectionalCount: 0,
      direction: 'first-to-second',
      directionConfidence: 1,
    })
    expect(reverseCollision).toMatchObject({
      firstToSecondCount: 0,
      secondToFirstCount: 3,
      bidirectionalCount: 0,
      direction: 'second-to-first',
      directionConfidence: 1,
    })
  })

  it('keeps mixed direction evidence neutral', () => {
    const notes = [
      note('a1', 'A1', 'alpha', { links: ['B1'] }),
      note('a2', 'A2', 'alpha', { links: ['B2'] }),
      note('b1', 'B1', 'beta'),
      note('b2', 'B2', 'beta'),
      note('b3', 'B3', 'beta', { links: ['A3'] }),
      note('a3', 'A3', 'alpha'),
    ]

    const collision = buildPlateCollisions(notes)[0]
    expect(collision).toMatchObject({
      relationCount: 3,
      firstToSecondCount: 2,
      secondToFirstCount: 1,
      bidirectionalCount: 0,
      direction: 'neutral',
    })
  })

  it('explains neighborhood with evidence instead of a bare distance', () => {
    const notes = [
      note('a', 'A', '数学', { links: ['B'], tags: ['线性代数', '证明'] }),
      note('b', 'B', '数学', { tags: ['线性代数'], x: 0.12, y: 0.05 }),
    ]
    expect(similarityReasons(notes, 'a', 'b').map((reason) => reason.label)).toEqual([
      '显式 WikiLink',
      '同属 数学',
      '共享 #线性代数',
      '布局距离 13.0',
    ])
  })

  it('filters the visible map by normalized plate membership', () => {
    const notes = [
      note('math', 'Math', ' 数学 '),
      note('physics', 'Physics', '物理', { areas: ['物理', '计算机'] }),
      note('history', 'History', '历史'),
    ]
    const project = { notes, snapshots: [] } as unknown as TerrainProject

    expect(visibleNotesFor(project, 0, '', [], ['数学', '计算机']).map((item) => item.id)).toEqual(['math', 'physics'])
  })
})
