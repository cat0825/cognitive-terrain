import { describe, expect, it } from 'vitest'
import type { TerrainNote } from '../../src/domain/types'
import { buildActivitySummaries } from '../../src/domain/activity-temperature'
import { materializePrerequisites } from '../../src/domain/prerequisite-topology'
import {
  buildTerrainData,
  interpolateSnapshots,
  mixHeightValues,
  sampleHeight,
} from '../../src/pipeline/terrain'

function note(id: string, createdAt: string, x: number, y: number, tag: string, weight = 1): TerrainNote {
  const createdAtMs = Date.parse(createdAt)
  return {
    id,
    fingerprint: id,
    title: id,
    content: id,
    createdAt,
    createdAtMs,
    tags: [tag],
    weight,
    x,
    y,
  }
}

describe('terrain pipeline', () => {
  it('uses note weights to preserve relative terrain prominence', () => {
    const terrain = buildTerrainData(
      [
        note('light', '2026-01-10T00:00:00.000Z', -0.45, 0, 'light', 0.5),
        note('heavy', '2026-01-10T00:00:00.000Z', 0.45, 0, 'heavy', 2),
      ],
      48,
      'UTC',
      0.06,
    )
    const values = terrain.snapshots[0].values

    expect(sampleHeight(values, 48, 0.45, 0)).toBeGreaterThan(sampleHeight(values, 48, -0.45, 0))
  })

  it('builds cumulative monthly snapshots and labels peaks', () => {
    const terrain = buildTerrainData(
      [
        note('january', '2026-01-10T08:00:00.000Z', -0.35, 0.1, 'alpha'),
        note('february', '2026-02-10T08:00:00.000Z', 0.35, 0.1, 'beta'),
      ],
      32,
      'UTC',
    )

    expect(terrain.snapshots.map((snapshot) => snapshot.bucket)).toEqual(['2026-01', '2026-02'])
    expect(terrain.snapshots[0].values).toHaveLength(32 * 32)
    expect(Math.max(...terrain.snapshots[1].values)).toBeGreaterThan(0)
    expect(terrain.peaks.length).toBeGreaterThan(0)
    expect(terrain.peaks.every((peak) => peak.noteIds.length > 0)).toBe(true)
  })

  it('uses confidence-weighted mastery to change elevation without moving notes', () => {
    const low = {
      ...note('low-mastery', '2026-01-10T00:00:00.000Z', -0.45, 0, 'low'),
      mastery: 0.15,
      confidence: 1,
    }
    const high = {
      ...note('high-mastery', '2026-01-10T00:00:00.000Z', 0.45, 0, 'high'),
      mastery: 0.9,
      confidence: 1,
    }
    const terrain = buildTerrainData([low, high], 48, 'UTC', 0.06, 'mastery')
    const values = terrain.snapshots[0].values

    expect(sampleHeight(values, 48, high.x, high.y)).toBeGreaterThan(
      sampleHeight(values, 48, low.x, low.y) * 3,
    )
    expect([low.x, low.y, high.x, high.y]).toEqual([-0.45, 0, 0.45, 0])
  })

  it('does not invent mastery elevation for unassessed notes', () => {
    const assessed = {
      ...note('assessed', '2026-01-10T00:00:00.000Z', -0.45, 0, 'assessed'),
      mastery: 0.8,
      confidence: 0.9,
    }
    const unassessed = note('unassessed', '2026-01-10T00:00:00.000Z', 0.45, 0, 'unassessed')
    const terrain = buildTerrainData([assessed, unassessed], 48, 'UTC', 0.05, 'mastery')
    const values = terrain.snapshots[0].values

    expect(sampleHeight(values, 48, assessed.x, assessed.y)).toBeGreaterThan(0.4)
    expect(sampleHeight(values, 48, unassessed.x, unassessed.y)).toBeLessThan(0.05)
  })

  it('uses exploration as a separate elevation profile', () => {
    const cold = { ...note('cold', '2026-01-10T00:00:00.000Z', -0.45, 0, 'cold'), exploration: 0.1 }
    const hot = { ...note('hot', '2026-01-10T00:00:00.000Z', 0.45, 0, 'hot'), exploration: 0.95 }
    const terrain = buildTerrainData([cold, hot], 48, 'UTC', 0.06, 'exploration')
    const values = terrain.snapshots[0].values

    expect(sampleHeight(values, 48, hot.x, hot.y)).toBeGreaterThan(
      sampleHeight(values, 48, cold.x, cold.y) * 4,
    )
  })

  it('uses activity elevation without changing note plane coordinates', () => {
    const evaluatedAt = '2026-02-01T00:00:00.000Z'
    const cold = note('cold-activity', '2026-01-10T00:00:00.000Z', -0.45, 0, 'cold')
    const hot = note('hot-activity', '2026-01-10T00:00:00.000Z', 0.45, 0, 'hot')
    const activityByNote = buildActivitySummaries(
      [cold, hot],
      [{ id: 'event-hot', itemId: hot.id, type: 'reviewed', occurredAt: '2026-01-31T00:00:00.000Z' }],
      Date.parse(evaluatedAt),
    )
    const terrain = buildTerrainData([cold, hot], 48, 'UTC', 0.06, 'activity', activityByNote)
    const values = terrain.snapshots[0].values

    expect(sampleHeight(values, 48, hot.x, hot.y)).toBeGreaterThan(sampleHeight(values, 48, cold.x, cold.y) * 3)
    expect([cold.x, cold.y, hot.x, hot.y]).toEqual([-0.45, 0, 0.45, 0])
  })

  it('renders explicit prerequisite depth as strata without moving planar coordinates', () => {
    const root = note('root', '2026-01-10T00:00:00.000Z', -0.45, 0, 'root')
    const child = {
      ...note('child', '2026-01-10T00:00:00.000Z', 0.45, 0, 'child'),
      prerequisites: materializePrerequisites('child', [{
        target: 'root',
        provenance: 'yaml',
        sourceField: 'prerequisites',
      }]),
    }
    const terrain = buildTerrainData([root, child], 48, 'UTC', 0.05, 'structure')
    const values = terrain.snapshots[0].values

    expect(sampleHeight(values, 48, child.x, child.y)).toBeGreaterThan(sampleHeight(values, 48, root.x, root.y) * 2)
    expect([root.x, root.y, child.x, child.y]).toEqual([-0.45, 0, 0.45, 0])
  })

  it('keeps structural elevation neutral without explicit prerequisite evidence', () => {
    const terrain = buildTerrainData([
      note('a', '2026-01-10T00:00:00.000Z', -0.4, 0, 'a'),
      note('b', '2026-01-10T00:00:00.000Z', 0.4, 0, 'b'),
    ], 32, 'UTC', 0.05, 'structure')

    expect(Math.max(...terrain.snapshots[0].values)).toBe(0)
  })

  it('interpolates and samples height values at timeline boundaries', () => {
    const snapshots = [
      { bucket: 'a', label: 'A', values: new Float32Array([0, 0, 0, 0]) },
      { bucket: 'b', label: 'B', values: new Float32Array([1, 1, 1, 1]) },
    ]
    const interpolation = interpolateSnapshots(snapshots, 0.25)
    const mixed = mixHeightValues(interpolation.a.values, interpolation.b.values, interpolation.mix)

    expect(interpolation.mix).toBe(0.25)
    expect(Array.from(mixed)).toEqual([0.25, 0.25, 0.25, 0.25])
    expect(sampleHeight(mixed, 2, 0, 0)).toBeCloseTo(0.25)
  })
})
