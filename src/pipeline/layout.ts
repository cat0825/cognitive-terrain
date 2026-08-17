import { UMAP } from 'umap-js'
export { STABLE_LAYOUT_FORMULA_VERSION } from '../domain/layout-version'

export type Coordinate = [number, number]

export interface StableLayoutResult {
  coordinates: Coordinate[]
  neighborIndices: number[][]
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function normalizeVector(values: number[]): number[] {
  const length = Math.hypot(...values)
  if (length === 0) return values.map(() => 0)
  return values.map((value) => value / length)
}

export async function buildStableLayout(
  vectors: number[][],
  onProgress?: (completed: number, total: number) => void,
): Promise<Coordinate[]> {
  return (await buildStableLayoutWithNeighbors(vectors, onProgress)).coordinates
}

export async function buildStableLayoutWithNeighbors(
  vectors: number[][],
  onProgress?: (completed: number, total: number) => void,
): Promise<StableLayoutResult> {
  if (vectors.length === 0) return { coordinates: [], neighborIndices: [] }
  if (vectors.length === 1) return { coordinates: [[0, 0]], neighborIndices: [[]] }
  if (vectors.length === 2) {
    return { coordinates: [[-0.42, 0], [0.42, 0]], neighborIndices: [[1], [0]] }
  }

  const umap = new UMAP({
    nComponents: 2,
    nNeighbors: Math.min(15, vectors.length - 1),
    minDist: 0.08,
    spread: 1,
    random: mulberry32(0x5eedc0de),
  })
  const total = umap.initializeFit(vectors)
  // umap-js computes approximate high-dimensional KNN during initializeFit.
  // Reusing those candidates avoids a second O(n^2 * dimensions) pass.
  const neighborIndices = ((umap as unknown as { knnIndices?: number[][] }).knnIndices ?? [])
    .map((indices, sourceIndex) => indices.filter((index) => index >= 0 && index !== sourceIndex))
  for (let epoch = 0; epoch < total; epoch += 1) {
    umap.step()
    if (epoch % 5 === 0 || epoch === total - 1) onProgress?.(epoch + 1, total)
    if (epoch % 20 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  return {
    coordinates: orientAndScale(umap.getEmbedding() as Coordinate[]),
    neighborIndices,
  }
}

export function orientAndScale(input: Coordinate[]): Coordinate[] {
  if (input.length < 2) return input.map(([x, y]) => [x, y])
  const meanX = input.reduce((sum, point) => sum + point[0], 0) / input.length
  const meanY = input.reduce((sum, point) => sum + point[1], 0) / input.length
  let xx = 0
  let xy = 0
  let yy = 0
  for (const [x, y] of input) {
    const dx = x - meanX
    const dy = y - meanY
    xx += dx * dx
    xy += dx * dy
    yy += dy * dy
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy)
  const cos = Math.cos(-angle)
  const sin = Math.sin(-angle)
  let points = input.map(([x, y]): Coordinate => {
    const dx = x - meanX
    const dy = y - meanY
    return [dx * cos - dy * sin, dx * sin + dy * cos]
  })

  if (points[0][0] > 0) points = points.map(([x, y]) => [-x, y])
  if (points.length > 1 && points[1][1] < 0) points = points.map(([x, y]) => [x, -y])

  const xs = points.map((point) => point[0]).sort((a, b) => a - b)
  const ys = points.map((point) => point[1]).sort((a, b) => a - b)
  const lo = Math.floor((points.length - 1) * 0.02)
  const hi = Math.ceil((points.length - 1) * 0.98)
  const centerX = (xs[lo] + xs[hi]) / 2
  const centerY = (ys[lo] + ys[hi]) / 2
  const span = Math.max(xs[hi] - xs[lo], ys[hi] - ys[lo], 1e-6)
  return points.map(([x, y]) => [
    clamp(((x - centerX) / span) * 1.84, -0.96, 0.96),
    clamp(((y - centerY) / span) * 1.84, -0.96, 0.96),
  ])
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
