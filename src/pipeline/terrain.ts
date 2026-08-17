import { contours } from 'd3-contour'
import type { NoteActivitySummary } from '../domain/activity-temperature'
import type { LearningProgressionResult } from '../domain/learning-progression'
import type { TerrainElevation, TerrainNote, TerrainPeak, TerrainSnapshot } from '../domain/types'

export interface ContourPath {
  value: number
  rings: Array<Array<[number, number]>>
}

export interface TerrainData {
  snapshots: TerrainSnapshot[]
  peaks: TerrainPeak[]
  bandwidth: number
}

export function buildTerrainData(
  notes: TerrainNote[],
  gridSize = chooseGridSize(notes.length),
  timeZone = 'Asia/Shanghai',
  bandwidthOverride?: number,
  elevation: Extract<TerrainElevation, 'density' | 'mastery' | 'exploration' | 'activity' | 'progression'> = 'density',
  activityByNote?: ReadonlyMap<string, Pick<NoteActivitySummary, 'score'>>,
  progressionByNote?: ReadonlyMap<string, Pick<LearningProgressionResult, 'elevation'>>,
): TerrainData {
  if (notes.length === 0) {
    return {
      snapshots: [{ bucket: 'empty', label: '暂无数据', values: new Float32Array(gridSize * gridSize) }],
      peaks: [],
      bandwidth: 0.08,
    }
  }

  const bandwidth = bandwidthOverride ?? estimateBandwidth(notes)
  const byBucket = new Map<string, TerrainNote[]>()
  for (const note of [...notes].sort((a, b) => a.createdAtMs - b.createdAtMs)) {
    const bucket = monthBucket(note.createdAtMs, timeZone)
    const bucketNotes = byBucket.get(bucket) ?? []
    bucketNotes.push(note)
    byBucket.set(bucket, bucketNotes)
  }

  const densityImpulses = new Float32Array(gridSize * gridSize)
  const numeratorImpulses = elevation === 'density' ? undefined : new Float32Array(gridSize * gridSize)
  const evidenceImpulses = elevation === 'density' ? undefined : new Float32Array(gridSize * gridSize)
  const rawSnapshots: Array<{
    bucket: string
    density: Float32Array
    numerator?: Float32Array
    evidence?: Float32Array
  }> = []
  for (const [bucket, bucketNotes] of [...byBucket.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const note of bucketNotes) {
      splat(densityImpulses, gridSize, note.x, note.y, note.weight)
      if (!numeratorImpulses || !evidenceImpulses) continue
      const value = elevation === 'mastery'
        ? note.mastery
        : elevation === 'exploration'
          ? note.exploration
          : elevation === 'activity'
            ? activityByNote?.get(note.id)?.score
            : progressionByNote?.get(note.id)?.elevation
      if (value === undefined) continue
      const confidence = elevation === 'mastery' ? note.confidence ?? 0.5 : 1
      splat(numeratorImpulses, gridSize, note.x, note.y, note.weight * confidence * value)
      splat(evidenceImpulses, gridSize, note.x, note.y, note.weight * confidence)
    }
    rawSnapshots.push({
      bucket,
      density: gaussianBlur(densityImpulses, gridSize, bandwidth),
      numerator: numeratorImpulses ? gaussianBlur(numeratorImpulses, gridSize, bandwidth) : undefined,
      evidence: evidenceImpulses ? gaussianBlur(evidenceImpulses, gridSize, bandwidth) : undefined,
    })
  }

  const finalDensity = rawSnapshots.at(-1)?.density ?? new Float32Array(gridSize * gridSize)
  let globalMax = 0
  for (const value of finalDensity) globalMax = Math.max(globalMax, value)
  const snapshots = rawSnapshots.map(({ bucket, density, numerator, evidence }) => ({
    bucket,
    label: formatBucket(bucket),
    values: numerator && evidence
      ? shapeCognitiveHeights(density, numerator, evidence, gridSize, globalMax)
      : shapeHeights(density, gridSize, globalMax),
  }))
  const peaks = detectPeaks(snapshots.at(-1)?.values ?? finalDensity, gridSize, notes, bandwidth)
  return { snapshots, peaks, bandwidth }
}

export function chooseGridSize(noteCount: number): number {
  if (noteCount > 3000) return 96
  if (noteCount > 1000) return 112
  return 128
}

export function interpolateSnapshots(
  snapshots: TerrainSnapshot[],
  timeline: number,
): { a: TerrainSnapshot; b: TerrainSnapshot; mix: number } {
  const safeTimeline = Math.max(0, Math.min(Math.max(0, snapshots.length - 1), timeline))
  const aIndex = Math.floor(safeTimeline)
  const bIndex = Math.min(snapshots.length - 1, aIndex + 1)
  return { a: snapshots[aIndex], b: snapshots[bIndex], mix: safeTimeline - aIndex }
}

export function mixHeightValues(a: Float32Array, b: Float32Array, mix: number): Float32Array {
  const result = new Float32Array(a.length)
  for (let index = 0; index < a.length; index += 1) result[index] = a[index] * (1 - mix) + b[index] * mix
  return result
}

export function sampleHeight(values: Float32Array, gridSize: number, x: number, y: number): number {
  const gx = clamp(((x + 1) / 2) * (gridSize - 1), 0, gridSize - 1)
  const gy = clamp(((y + 1) / 2) * (gridSize - 1), 0, gridSize - 1)
  const x0 = Math.floor(gx)
  const y0 = Math.floor(gy)
  const x1 = Math.min(gridSize - 1, x0 + 1)
  const y1 = Math.min(gridSize - 1, y0 + 1)
  const tx = gx - x0
  const ty = gy - y0
  const top = values[y0 * gridSize + x0] * (1 - tx) + values[y0 * gridSize + x1] * tx
  const bottom = values[y1 * gridSize + x0] * (1 - tx) + values[y1 * gridSize + x1] * tx
  return top * (1 - ty) + bottom * ty
}

export function buildContourPaths(values: Float32Array, gridSize: number, levels = 16): ContourPath[] {
  const thresholds = Array.from({ length: levels }, (_, index) => {
    const t = (index + 1) / (levels + 1)
    return 0.035 + Math.pow(t, 1.55) * 0.86
  })
  return contours().size([gridSize, gridSize]).thresholds(thresholds)(Array.from(values)).map((contour) => {
    const rings: Array<Array<[number, number]>> = []
    for (const polygon of contour.coordinates) {
      for (const ring of polygon) rings.push(ring as Array<[number, number]>)
    }
    return { value: contour.value ?? 0, rings }
  })
}

function estimateBandwidth(notes: TerrainNote[]): number {
  if (notes.length < 3) return 0.12
  const sampleStep = Math.max(1, Math.floor(notes.length / 240))
  const distances: number[] = []
  for (let index = 0; index < notes.length; index += sampleStep) {
    const note = notes[index]
    const nearest: number[] = []
    for (let otherIndex = 0; otherIndex < notes.length; otherIndex += 1) {
      if (otherIndex === index) continue
      const other = notes[otherIndex]
      nearest.push(Math.hypot(note.x - other.x, note.y - other.y))
    }
    nearest.sort((a, b) => a - b)
    distances.push(nearest[Math.min(14, nearest.length - 1)])
    if (distances.length >= 240) break
  }
  distances.sort((a, b) => a - b)
  return clamp((distances[Math.floor(distances.length / 2)] ?? 0.06) * 1.25, 0.025, 0.12)
}

function splat(values: Float32Array, size: number, x: number, y: number, weight: number): void {
  const gx = clamp(((x + 1) / 2) * (size - 1), 0, size - 1)
  const gy = clamp(((y + 1) / 2) * (size - 1), 0, size - 1)
  const x0 = Math.floor(gx)
  const y0 = Math.floor(gy)
  const x1 = Math.min(size - 1, x0 + 1)
  const y1 = Math.min(size - 1, y0 + 1)
  const tx = gx - x0
  const ty = gy - y0
  values[y0 * size + x0] += weight * (1 - tx) * (1 - ty)
  values[y0 * size + x1] += weight * tx * (1 - ty)
  values[y1 * size + x0] += weight * (1 - tx) * ty
  values[y1 * size + x1] += weight * tx * ty
}

function gaussianBlur(input: Float32Array, size: number, bandwidth: number): Float32Array {
  const sigma = Math.max(1.2, bandwidth * size * 0.5)
  const radius = Math.max(2, Math.ceil(sigma * 3))
  const kernel = new Float32Array(radius * 2 + 1)
  let kernelSum = 0
  for (let index = -radius; index <= radius; index += 1) {
    const value = Math.exp(-(index * index) / (2 * sigma * sigma))
    kernel[index + radius] = value
    kernelSum += value
  }
  for (let index = 0; index < kernel.length; index += 1) kernel[index] /= kernelSum

  const horizontal = new Float32Array(input.length)
  const output = new Float32Array(input.length)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sx = clampInt(x + offset, 0, size - 1)
        sum += input[y * size + sx] * kernel[offset + radius]
      }
      horizontal[y * size + x] = sum
    }
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sy = clampInt(y + offset, 0, size - 1)
        sum += horizontal[sy * size + x] * kernel[offset + radius]
      }
      output[y * size + x] = sum
    }
  }
  return output
}

function shapeHeights(values: Float32Array, size: number, globalMax: number): Float32Array {
  const output = new Float32Array(values.length)
  const denominator = Math.log1p(Math.max(globalMax, 1e-8))
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const edgeDistance = Math.min(x, y, size - 1 - x, size - 1 - y) / (size * 0.12)
      const edge = smoothstep(0, 1, edgeDistance)
      output[y * size + x] = (Math.log1p(values[y * size + x]) / denominator) * edge
    }
  }
  return output
}

function shapeCognitiveHeights(
  density: Float32Array,
  numerator: Float32Array,
  evidence: Float32Array,
  size: number,
  globalDensityMax: number,
): Float32Array {
  const output = new Float32Array(density.length)
  const denominator = Math.log1p(Math.max(globalDensityMax, 1e-8))
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x
      const edgeDistance = Math.min(x, y, size - 1 - x, size - 1 - y) / (size * 0.12)
      const edge = smoothstep(0, 1, edgeDistance)
      const normalizedDensity = Math.log1p(density[index]) / denominator
      const weightedMean = evidence[index] > 1e-8 ? numerator[index] / evidence[index] : 0
      output[index] = Math.pow(Math.max(0, normalizedDensity), 0.35) * clamp(weightedMean, 0, 1) * edge
    }
  }
  return output
}

function detectPeaks(
  values: Float32Array,
  size: number,
  notes: TerrainNote[],
  bandwidth: number,
): TerrainPeak[] {
  const candidates: Array<{ x: number; y: number; height: number }> = []
  const radius = Math.max(3, Math.round(size * 0.035))
  for (let y = radius; y < size - radius; y += 1) {
    for (let x = radius; x < size - radius; x += 1) {
      const height = values[y * size + x]
      if (height < 0.24) continue
      let isMaximum = true
      for (let oy = -radius; oy <= radius && isMaximum; oy += 1) {
        for (let ox = -radius; ox <= radius; ox += 1) {
          if (values[(y + oy) * size + x + ox] > height) {
            isMaximum = false
            break
          }
        }
      }
      if (isMaximum) candidates.push({ x, y, height })
    }
  }
  candidates.sort((a, b) => b.height - a.height)
  const selected: typeof candidates = []
  for (const candidate of candidates) {
    if (selected.some((peak) => Math.hypot(peak.x - candidate.x, peak.y - candidate.y) < size * 0.12)) continue
    selected.push(candidate)
    if (selected.length >= 12) break
  }
  return selected.map((peak, index) => {
    const x = (peak.x / (size - 1)) * 2 - 1
    const y = (peak.y / (size - 1)) * 2 - 1
    const nearby = notes
      .map((note) => ({ note, distance: Math.hypot(note.x - x, note.y - y) }))
      .filter(({ distance }) => distance <= Math.max(0.15, bandwidth * 2.4))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 24)
      .map(({ note }) => note)
    return {
      id: `peak-${index + 1}`,
      x,
      y,
      height: peak.height,
      label: choosePeakLabel(nearby, index),
      noteIds: nearby.map((note) => note.id),
    }
  })
}

function choosePeakLabel(notes: TerrainNote[], index: number): string {
  const counts = new Map<string, number>()
  for (const note of notes) {
    for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  const label = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
  return label || notes[0]?.title.slice(0, 8) || `主题 ${index + 1}`
}

function monthBucket(timestamp: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(timestamp)
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  return `${year}-${month}`
}

function formatBucket(bucket: string): string {
  const [year, month] = bucket.split('-')
  return `${year}年${Number(month)}月`
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}
