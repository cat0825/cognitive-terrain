import { describe, expect, it } from 'vitest'
import { createDemoProject } from '../../src/domain/demo'
import { buildPlateBridges, buildPlateCollisions } from '../../src/domain/knowledge-plates'

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
    expect(buildPlateBridges(first.notes).length).toBeGreaterThan(0)
    expect(buildPlateCollisions(first.notes).filter((collision) => collision.mode === 'band').length).toBeGreaterThan(0)
    expect(first.referenceAtlases).toEqual([expect.objectContaining({
      id: 'demo-ai-infra-reference-atlas',
      taxonomyVersion: 1,
    })])
    expect(first.taxonomyNodes).toHaveLength(8)
    expect(first.referenceAtlases?.[0]?.taxonomyNodeIds).toHaveLength(7)
    // The demo is the one project that declares its own atlas as selected, so the
    // ocean / gap layer is demonstrable without a manual pick. Imported projects
    // still start unselected — a gap claim needs an explicit reference atlas.
    expect(first.activeReferenceAtlasId).toBe('demo-ai-infra-reference-atlas')
    expect(second.notes.map(({ x, y }) => [x, y])).toEqual(first.notes.map(({ x, y }) => [x, y]))
    expect(second.notes.map((note) => note.weight)).toEqual(first.notes.map((note) => note.weight))
  }, 15_000)
})
