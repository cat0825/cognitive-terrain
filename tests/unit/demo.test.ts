import { describe, expect, it } from 'vitest'
import { createDemoProject } from '../../src/domain/demo'

describe('AI Infra demo project', () => {
  it('builds a deterministic dense knowledge terrain', () => {
    const first = createDemoProject()
    const second = createDemoProject()

    expect(first.name).toBe('AI Infra 知识地形')
    expect(first.notes).toHaveLength(1800)
    expect(first.peaks).toHaveLength(30)
    expect(first.peaks.every((peak) => peak.noteIds.length === 60)).toBe(true)
    expect(first.notes.every((note) => note.content === '')).toBe(true)
    expect(first.notes.every((note) => note.tags.length === 2)).toBe(true)
    expect(Math.min(...first.notes.map((note) => note.weight))).toBeLessThan(0.7)
    expect(Math.max(...first.notes.map((note) => note.weight))).toBeGreaterThan(1.6)
    expect(first.snapshots[0]?.bucket).toBe('2021-11')
    expect(first.snapshots.at(-1)?.bucket).toBe('2025-12')
    expect(second.notes.map(({ x, y }) => [x, y])).toEqual(first.notes.map(({ x, y }) => [x, y]))
    expect(second.notes.map((note) => note.weight)).toEqual(first.notes.map((note) => note.weight))
  })
})
