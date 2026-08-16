import type { TerrainNote } from './types'

export interface KnowledgePlate {
  id: string
  label: string
  color: string
  noteCount: number
  crossLinkCount: number
}

export interface PlateBridge {
  id: string
  fromId: string
  toId: string
  fromArea: string
  toArea: string
  kind: 'wikilink'
  distance: number
  score: number
  sharedTags: string[]
  evidence: PlateBridgeEvidence[]
}

export interface PlateBridgeEvidence {
  fromId: string
  toId: string
  fromArea: string
  toArea: string
}

export interface PlateCollision {
  id: string
  firstArea: string
  secondArea: string
  relationCount: number
  firstToSecondCount: number
  secondToFirstCount: number
  bidirectionalCount: number
  direction: 'first-to-second' | 'second-to-first' | 'neutral'
  directionConfidence: number
  strength: number
  mode: 'lines' | 'band'
  firstAnchor: { x: number; y: number }
  secondAnchor: { x: number; y: number }
  bridges: PlateBridge[]
}

export interface SimilarityReason {
  kind: 'wikilink' | 'area' | 'tag' | 'boundary' | 'distance'
  label: string
}

const PLATE_PALETTE = ['#76a6a0', '#9b8ad9', '#c49b67', '#7f9fc8', '#b67f8c', '#8da56d', '#c27f5e', '#6f9aa8']
export const COLLISION_BAND_THRESHOLD = 3
/** A single relation is too sparse to expose a directional cue. */
export const COLLISION_DIRECTION_MIN_RELATIONS = 2
/** Direction must have a clear enough imbalance to be rendered. */
export const COLLISION_DIRECTION_MIN_CONFIDENCE = 0.6

export function normalizeArea(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
  return normalized || undefined
}

export function areaLabel(value: string | undefined): string | undefined {
  if (!value) return undefined
  const label = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return label || undefined
}

export function areasForNote(note: { area?: string; areas?: string[] }): string[] {
  const labels = new Map<string, string>()
  for (const value of [note.area, ...(note.areas ?? [])]) {
    const normalized = normalizeArea(value)
    const label = areaLabel(value)
    if (normalized && label && !labels.has(normalized)) labels.set(normalized, label)
  }
  return [...labels.values()]
}

export function primaryAreaForNote(note: { area?: string; areas?: string[] }): string | undefined {
  return areasForNote(note)[0]
}

export function plateIdForArea(value: string): string {
  return `plate-${stableHash(normalizeArea(value) ?? value)}`
}

export function plateColor(value: string): string {
  const normalized = normalizeArea(value) ?? value
  return PLATE_PALETTE[stableNumber(normalized) % PLATE_PALETTE.length] ?? PLATE_PALETTE[0]
}

export function summarizeKnowledgePlates(notes: TerrainNote[]): KnowledgePlate[] {
  const summaries = new Map<string, KnowledgePlate>()
  for (const note of notes) {
    for (const label of areasForNote(note)) {
      const normalized = normalizeArea(label)
      if (!normalized) continue
      const id = plateIdForArea(normalized)
      const current = summaries.get(id)
      if (current) {
        current.noteCount += 1
        continue
      }
      summaries.set(id, {
        id,
        label,
        color: plateColor(normalized),
        noteCount: 1,
        crossLinkCount: 0,
      })
    }
  }

  for (const bridge of buildPlateBridges(notes)) {
    for (const area of [bridge.fromArea, bridge.toArea]) {
      const plate = summaries.get(plateIdForArea(area))
      if (plate) plate.crossLinkCount += 1
    }
  }
  return [...summaries.values()].sort((a, b) => b.noteCount - a.noteCount || a.label.localeCompare(b.label))
}

export function buildPlateBridges(notes: TerrainNote[]): PlateBridge[] {
  const edges = explicitEdges(notes)
  const bridges = new Map<string, PlateBridge>()
  for (const { from, to } of edges) {
    const fromAreas = normalizedAreasForNote(from)
    const toAreas = normalizedAreasForNote(to)
    if (!fromAreas.length || !toAreas.length || sharesArea(fromAreas, toAreas)) continue
    const fromArea = fromAreas[0]
    const toArea = toAreas[0]
    const [firstId, secondId] = [from.id, to.id].sort()
    const id = `bridge-${firstId}-${secondId}`
    const evidence = { fromId: from.id, toId: to.id, fromArea, toArea }
    const current = bridges.get(id)
    if (current) {
      current.evidence.push(evidence)
      continue
    }
    const distance = Math.hypot(from.x - to.x, from.y - to.y)
    const sharedTags = sharedTagsOf(from, to)
    const score = Math.min(1, 0.82 + sharedTags.length * 0.04)
    bridges.set(id, {
      id,
      fromId: from.id,
      toId: to.id,
      fromArea,
      toArea,
      kind: 'wikilink',
      distance,
      score,
      sharedTags,
      evidence: [evidence],
    })
  }
  return [...bridges.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
}

export function buildPlateCollisions(
  notes: TerrainNote[],
  bandThreshold = COLLISION_BAND_THRESHOLD,
): PlateCollision[] {
  const notesById = new Map(notes.map((note) => [note.id, note]))
  const areaLabels = new Map<string, string>()
  for (const note of notes) {
    for (const area of areasForNote(note)) {
      const normalized = normalizeArea(area)
      if (normalized && !areaLabels.has(normalized)) areaLabels.set(normalized, area)
    }
  }
  const groups = new Map<string, {
    firstArea: string
    secondArea: string
    bridges: PlateBridge[]
    relationPairs: Set<string>
    firstToSecondCount: number
    secondToFirstCount: number
    bidirectionalPairs: Set<string>
    firstPoints: Array<{ x: number; y: number }>
    secondPoints: Array<{ x: number; y: number }>
  }>()
  for (const bridge of buildPlateBridges(notes)) {
    const [firstArea, secondArea] = [bridge.fromArea, bridge.toArea].sort()
    const id = collisionId(firstArea, secondArea)
    const group = groups.get(id) ?? {
      firstArea,
      secondArea,
      bridges: [],
      relationPairs: new Set<string>(),
      firstToSecondCount: 0,
      secondToFirstCount: 0,
      bidirectionalPairs: new Set<string>(),
      firstPoints: [],
      secondPoints: [],
    }
    const from = notesById.get(bridge.fromId)
    const to = notesById.get(bridge.toId)
    if (!from || !to) continue
    const fromBelongsToFirst = bridge.fromArea === firstArea
    const relationPair = [from.id, to.id].sort().join('|')
    group.relationPairs.add(relationPair)
    let directions = 0
    for (const evidence of bridge.evidence) {
      if (evidence.fromArea === firstArea) {
        group.firstToSecondCount += 1
        directions |= 1
      } else {
        group.secondToFirstCount += 1
        directions |= 2
      }
    }
    if (directions === 3) group.bidirectionalPairs.add(relationPair)
    group.bridges.push(bridge)
    group.firstPoints.push(fromBelongsToFirst ? from : to)
    group.secondPoints.push(fromBelongsToFirst ? to : from)
    groups.set(id, group)
  }
  return [...groups.entries()].map(([id, group]) => {
    const relationCount = group.relationPairs.size
    const directionalTotal = group.firstToSecondCount + group.secondToFirstCount
    const directionConfidence = directionalTotal
      ? Math.abs(group.firstToSecondCount - group.secondToFirstCount) / directionalTotal
      : 0
    const direction = relationCount < COLLISION_DIRECTION_MIN_RELATIONS || directionConfidence < COLLISION_DIRECTION_MIN_CONFIDENCE
      ? 'neutral'
      : group.firstToSecondCount > group.secondToFirstCount
        ? 'first-to-second'
        : group.secondToFirstCount > group.firstToSecondCount
          ? 'second-to-first'
          : 'neutral'
    return {
      id,
      firstArea: areaLabels.get(group.firstArea) ?? group.firstArea,
      secondArea: areaLabels.get(group.secondArea) ?? group.secondArea,
      relationCount,
      firstToSecondCount: group.firstToSecondCount,
      secondToFirstCount: group.secondToFirstCount,
      bidirectionalCount: group.bidirectionalPairs.size,
      direction,
      directionConfidence,
      strength: Math.min(1, Math.log2(relationCount + 1) / 3),
      mode: relationCount >= Math.max(2, bandThreshold) ? 'band' : 'lines',
      firstAnchor: averagePoint(group.firstPoints),
      secondAnchor: averagePoint(group.secondPoints),
      bridges: group.bridges,
    } satisfies PlateCollision
  }).sort((a, b) => b.relationCount - a.relationCount || a.id.localeCompare(b.id))
}

export function similarityReasons(notes: TerrainNote[], originId: string, targetId: string): SimilarityReason[] {
  const origin = notes.find((note) => note.id === originId)
  const target = notes.find((note) => note.id === targetId)
  if (!origin || !target) return []
  const reasons: SimilarityReason[] = []
  const explicit = explicitEdges(notes).some((edge) =>
    (edge.from.id === origin.id && edge.to.id === target.id) || (edge.from.id === target.id && edge.to.id === origin.id),
  )
  if (explicit) reasons.push({ kind: 'wikilink', label: '显式 WikiLink' })
  const originAreas = normalizedAreasForNote(origin)
  const targetAreas = normalizedAreasForNote(target)
  const sharedAreas = originAreas.filter((area) => targetAreas.includes(area))
  if (sharedAreas.length) {
    const labels = areasForNote(origin).filter((label) => sharedAreas.includes(normalizeArea(label) ?? ''))
    reasons.push({ kind: 'area', label: `同属 ${labels.join('、')}` })
  }
  const tags = sharedTagsOf(origin, target)
  if (tags.length) reasons.push({ kind: 'tag', label: `共享 ${tags.slice(0, 3).map((tag) => `#${tag}`).join(' ')}` })
  const distance = Math.hypot(origin.x - target.x, origin.y - target.y)
  if (originAreas.length && targetAreas.length && !sharedAreas.length && distance <= 0.42) {
    reasons.push({ kind: 'boundary', label: `跨板块结构接近 · ${Math.round(distance * 100) / 100}` })
  }
  reasons.push({ kind: 'distance', label: `布局距离 ${(distance * 100).toFixed(1)}` })
  return reasons
}

function normalizedAreasForNote(note: { area?: string; areas?: string[] }): string[] {
  return areasForNote(note).flatMap((area) => {
    const normalized = normalizeArea(area)
    return normalized ? [normalized] : []
  })
}

function sharesArea(left: string[], right: string[]): boolean {
  const rightAreas = new Set(right)
  return left.some((area) => rightAreas.has(area))
}

function collisionId(firstArea: string, secondArea: string): string {
  return `collision-${plateIdForArea(firstArea)}-${plateIdForArea(secondArea)}`
}

function averagePoint(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 })
  return points.length ? { x: total.x / points.length, y: total.y / points.length } : { x: 0, y: 0 }
}

interface ExplicitEdge {
  from: TerrainNote
  to: TerrainNote
}

function explicitEdges(notes: TerrainNote[]): ExplicitEdge[] {
  const index = buildNoteIndex(notes)
  const edges: ExplicitEdge[] = []
  for (const from of notes) {
    for (const link of from.links) {
      const to = index.get(normalizeRelationKey(link))
      if (!to || to.id === from.id) continue
      edges.push({ from, to })
    }
  }
  return edges
}

function buildNoteIndex(notes: TerrainNote[]): Map<string, TerrainNote> {
  const index = new Map<string, TerrainNote>()
  for (const note of notes) {
    for (const key of [note.title, note.sourcePath, note.sourcePath?.split('/').at(-1)]) {
      if (!key) continue
      const normalized = normalizeRelationKey(key)
      if (normalized && !index.has(normalized)) index.set(normalized, note)
    }
  }
  return index
}

function normalizeRelationKey(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\.md$/i, '').replace(/^\.\//, '').toLocaleLowerCase()
}

function sharedTagsOf(a: TerrainNote, b: TerrainNote): string[] {
  const bTags = new Set(b.tags.map((tag) => tag.toLocaleLowerCase()))
  return [...new Set(a.tags.filter((tag) => bTags.has(tag.toLocaleLowerCase())))]
}

function stableNumber(value: string): number {
  return Number.parseInt(stableHash(value), 16) >>> 0
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
