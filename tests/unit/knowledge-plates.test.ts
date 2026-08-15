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
