import type { TerrainProject } from './types'

export const REFERENCE_GAP_FORMULA_VERSION = 'reference-gap-v1' as const
export const DEFAULT_REFERENCE_SPARSE_ITEM_COUNT = 2
export const DEFAULT_REFERENCE_STALE_DAYS = 90

export interface ReferenceAtlasNode {
  id: string
  label: string
  parentId?: string
  weight?: number
}

export interface ReferenceAtlas {
  id: string
  label: string
  taxonomyVersion: string | number
  nodes: readonly ReferenceAtlasNode[]
}

export interface ReferenceCoverageItem {
  itemId: string
  taxonomyNodeIds: readonly string[]
  lastActivityAt?: string
}

export interface ReferenceGapOptions {
  evaluatedAt: string | number | Date
  sparseItemCount?: number
  staleAfterDays?: number
  formulaVersion?: typeof REFERENCE_GAP_FORMULA_VERSION
}

export type ReferenceCoverageState = 'missing' | 'sparse' | 'stale' | 'covered'

export interface ReferenceGapEvidence {
  nodeId: string
  label: string
  expectedWeight: number
  state: ReferenceCoverageState
  gap: number
  ocean: number
  supportingItemIds: string[]
  expectedNodeIds: string[]
  lastSupportingAt?: string
}

export interface ReferenceGapReport {
  enabled: boolean
  formulaVersion: typeof REFERENCE_GAP_FORMULA_VERSION
  evaluatedAt: string
  referenceAtlasId?: string
  reason?: 'no-reference-atlas'
  gaps: ReferenceGapEvidence[]
}

/**
 * Builds explicit reference-relative gaps. An omitted atlas disables both gap
 * and ocean values; inactivity alone never creates a personalized gap claim.
 */
export function buildReferenceGapReport(
  atlas: ReferenceAtlas | undefined,
  coverageItems: readonly ReferenceCoverageItem[],
  options: ReferenceGapOptions,
): ReferenceGapReport {
  if (options.formulaVersion && options.formulaVersion !== REFERENCE_GAP_FORMULA_VERSION) {
    throw new RangeError(`Unsupported reference gap formula: ${options.formulaVersion}`)
  }
  const evaluatedAtMs = parseDate(options.evaluatedAt)
  const evaluatedAt = new Date(evaluatedAtMs).toISOString()
  if (!atlas) {
    return {
      enabled: false,
      formulaVersion: REFERENCE_GAP_FORMULA_VERSION,
      evaluatedAt,
      reason: 'no-reference-atlas',
      gaps: [],
    }
  }
  const sparseItemCount = options.sparseItemCount ?? DEFAULT_REFERENCE_SPARSE_ITEM_COUNT
  const staleAfterDays = options.staleAfterDays ?? DEFAULT_REFERENCE_STALE_DAYS
  if (!Number.isInteger(sparseItemCount) || sparseItemCount < 1) throw new RangeError('sparseItemCount must be positive')
  if (!Number.isFinite(staleAfterDays) || staleAfterDays <= 0) throw new RangeError('staleAfterDays must be positive')
  const nodeIds = new Set(atlas.nodes.map((node) => node.id))
  const gaps = atlas.nodes.map((node) => {
    const supporting = coverageItems.filter((item) => item.taxonomyNodeIds.includes(node.id))
    const supportingItemIds = [...new Set(supporting.map((item) => item.itemId))].sort()
    const lastSupportingAt = latestTimestamp(
      supporting.flatMap((item) => item.lastActivityAt ? [item.lastActivityAt] : []),
      evaluatedAtMs,
    )
    const isStale = Boolean(lastSupportingAt) && evaluatedAtMs - Date.parse(lastSupportingAt!) >= staleAfterDays * 86_400_000
    const state: ReferenceCoverageState = supportingItemIds.length === 0
      ? 'missing'
      : isStale
        ? 'stale'
        : supportingItemIds.length < sparseItemCount
          ? 'sparse'
          : 'covered'
    const gap = state === 'missing' ? 1 : state === 'stale' ? 0.75 : state === 'sparse' ? 1 - supportingItemIds.length / sparseItemCount : 0
    return {
      nodeId: node.id,
      label: node.label,
      expectedWeight: node.weight ?? 1,
      state,
      gap,
      ocean: gap,
      supportingItemIds,
      expectedNodeIds: expectedDescendants(atlas.nodes, node.id, nodeIds),
      lastSupportingAt,
    }
  })
  return {
    enabled: true,
    formulaVersion: REFERENCE_GAP_FORMULA_VERSION,
    evaluatedAt,
    referenceAtlasId: atlas.id,
    gaps,
  }
}

export function buildProjectReferenceGapReport(
  project: TerrainProject,
  selectedAtlasId: string,
  evaluatedAt: string | number | Date,
): ReferenceGapReport {
  const manifest = project.referenceAtlases?.find((atlas) => atlas.id === selectedAtlasId)
  const taxonomyNodes = project.taxonomyNodes ?? []
  const atlas: ReferenceAtlas | undefined = manifest
    ? {
        id: manifest.id,
        label: manifest.label,
        taxonomyVersion: manifest.taxonomyVersion,
        nodes: manifest.taxonomyNodeIds.map((id) => {
          const node = taxonomyNodes.find((candidate) => candidate.id === id)
          return { id, label: node?.label ?? id, parentId: node?.parentId }
        }),
      }
    : undefined
  const nodeIdsByLabel = new Map<string, string>()
  for (const node of taxonomyNodes) {
    nodeIdsByLabel.set(normalizeLabel(node.label), node.id)
    for (const alias of node.aliases) nodeIdsByLabel.set(normalizeLabel(alias), node.id)
  }
  const activityByItem = new Map<string, string>()
  const evaluatedAtMs = parseDate(evaluatedAt)
  for (const event of project.interactionEvents) {
    retainLatestActivity(activityByItem, event.itemId, event.occurredAt, evaluatedAtMs)
  }
  for (const aggregate of project.activityHistory?.aggregates ?? []) {
    retainLatestActivity(activityByItem, aggregate.itemId, aggregate.lastOccurredAt, evaluatedAtMs)
  }
  const coverageItems = project.notes.map((note) => ({
    itemId: note.id,
    taxonomyNodeIds: [...new Set((note.declaredAreas ?? note.areas ?? (note.area ? [note.area] : [])).flatMap((area) => {
      const nodeId = nodeIdsByLabel.get(normalizeLabel(area))
      return nodeId ? [nodeId] : []
    }))],
    lastActivityAt: activityByItem.get(note.id),
  }))
  return buildReferenceGapReport(atlas, coverageItems, { evaluatedAt })
}

function expectedDescendants(nodes: readonly ReferenceAtlasNode[], rootId: string, nodeIds: Set<string>): string[] {
  const result = [rootId]
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes) {
      if (node.parentId && result.includes(node.parentId) && !result.includes(node.id) && nodeIds.has(node.id)) {
        result.push(node.id)
        changed = true
      }
    }
  }
  return result
}

function latestTimestamp(values: string[], latestAllowedMs = Number.POSITIVE_INFINITY): string | undefined {
  return values
    .filter((value) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= latestAllowedMs)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0]
}

function retainLatestActivity(
  target: Map<string, string>,
  itemId: string,
  occurredAt: string,
  latestAllowedMs: number,
): void {
  const occurredAtMs = Date.parse(occurredAt)
  if (!Number.isFinite(occurredAtMs) || occurredAtMs > latestAllowedMs) return
  const previous = target.get(itemId)
  if (!previous || occurredAtMs > Date.parse(previous)) target.set(itemId, occurredAt)
}

function parseDate(value: string | number | Date): number {
  const parsed = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(parsed)) throw new RangeError(`Invalid timestamp: ${String(value)}`)
  return parsed
}

function normalizeLabel(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase()
}
