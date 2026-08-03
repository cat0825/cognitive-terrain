import { describe, expect, it } from 'vitest'
import { normalizeVector, orientAndScale } from '../../src/pipeline/layout'

describe('layout helpers', () => {
  it('normalizes vectors without producing invalid zero-vector values', () => {
    expect(normalizeVector([3, 4])).toEqual([0.6, 0.8])
    expect(normalizeVector([0, 0, 0])).toEqual([0, 0, 0])
  })

  it('orients and scales coordinates deterministically into terrain bounds', () => {
    const points: Array<[number, number]> = [
      [4, 1],
      [7, 3],
      [5, 8],
      [2, 6],
    ]

    const first = orientAndScale(points)
    const second = orientAndScale(points)

    expect(second).toEqual(first)
    expect(first[0][0]).toBeLessThanOrEqual(0)
    for (const [x, y] of first) {
      expect(x).toBeGreaterThanOrEqual(-0.96)
      expect(x).toBeLessThanOrEqual(0.96)
      expect(y).toBeGreaterThanOrEqual(-0.96)
      expect(y).toBeLessThanOrEqual(0.96)
    }
  })
})
