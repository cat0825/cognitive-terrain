import { describe, expect, it } from 'vitest'
import type { TerrainNote } from '../../src/domain/types'
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
