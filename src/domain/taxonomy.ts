import type { TaxonomyNode, TaxonomyNodeStatus } from './types'

export const TAXONOMY_VERSION = 1

export interface TaxonomyNodeInput {
  id?: string
  workspaceId: string
  label: string
  parentId?: string
  aliases?: string[]
  description?: string
  version?: number
  status?: TaxonomyNodeStatus
  createdAt?: string
  updatedAt?: string
}

export interface TaxonomyMembershipRef {
  itemId: string
  taxonomyNodeId: string
  resolved?: boolean
}

export interface TaxonomyMutationPreview {
  kind: 'rename' | 'reparent' | 'merge'
  nodeId: string
  targetNodeId?: string
  affectedItemIds: string[]
  affectedNodeIds: string[]
}

export interface TaxonomyMutationResult<TMembership extends TaxonomyMembershipRef = TaxonomyMembershipRef> {
  nodes: TaxonomyNode[]
  memberships: TMembership[]
  preview: TaxonomyMutationPreview
}

export function normalizeTaxonomyAlias(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
}

export const normalizeTaxonomyLabel = normalizeTaxonomyAlias

export function taxonomyNodeIdFor(workspaceId: string, label: string): string {
  const normalizedWorkspace = workspaceId.normalize('NFKC').trim()
  return `taxonomy-${stableHash(`${normalizedWorkspace}\n${normalizeTaxonomyAlias(label)}`)}`
}

export function createTaxonomyNode(input: TaxonomyNodeInput, now = new Date().toISOString()): TaxonomyNode {
  const label = input.label.normalize('NFKC').trim().replace(/\s+/gu, ' ')
  if (!input.workspaceId.trim()) throw new Error('taxonomy node requires a workspaceId')
  if (!normalizeTaxonomyAlias(label)) throw new Error('taxonomy node requires a non-empty label')
  const timestamp = input.createdAt ?? now
  return {
    id: input.id ?? taxonomyNodeIdFor(input.workspaceId, label),
    workspaceId: input.workspaceId,
    label,
    parentId: input.parentId,
    aliases: uniqueAliases(input.aliases ?? [], label),
    description: input.description?.trim() || undefined,
    version: Math.max(1, Math.floor(input.version ?? TAXONOMY_VERSION)),
    status: input.status ?? 'active',
    createdAt: timestamp,
    updatedAt: input.updatedAt ?? timestamp,
  }
}

export function validateTaxonomy(nodes: readonly TaxonomyNode[]): void {
  const byId = new Map<string, TaxonomyNode>()
  for (const node of nodes) {
    if (!node.id.trim()) throw new Error('taxonomy node id must not be empty')
    if (byId.has(node.id)) throw new Error(`duplicate taxonomy node id: ${node.id}`)
    if (!node.workspaceId.trim()) throw new Error(`taxonomy node ${node.id} requires a workspaceId`)
    if (!normalizeTaxonomyAlias(node.label)) throw new Error(`taxonomy node ${node.id} requires a label`)
    if (!Number.isInteger(node.version) || node.version < 1) throw new Error(`invalid taxonomy version: ${node.id}`)
    if (node.status !== 'active' && node.status !== 'archived') throw new Error(`invalid taxonomy status: ${node.id}`)
    const createdAt = Date.parse(node.createdAt)
    const updatedAt = Date.parse(node.updatedAt)
    if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt) || updatedAt < createdAt) {
      throw new Error(`invalid taxonomy timestamps: ${node.id}`)
    }
    byId.set(node.id, node)
  }
  const aliases = new Map<string, string>()
  for (const node of nodes) {
    if (node.parentId) {
      const parent = byId.get(node.parentId)
      if (!parent) throw new Error(`taxonomy node ${node.id} references missing parent: ${node.parentId}`)
      if (parent.workspaceId !== node.workspaceId) throw new Error(`taxonomy node ${node.id} crosses workspace boundary`)
    }
    for (const alias of node.status === 'archived' ? [] : [node.label, ...node.aliases]) {
      const normalized = normalizeTaxonomyAlias(alias)
      if (!normalized) throw new Error(`taxonomy node ${node.id} contains an empty alias`)
      const key = `${node.workspaceId}\n${normalized}`
      const previous = aliases.get(key)
      if (previous && previous !== node.id) throw new Error(`taxonomy alias resolves ambiguously: ${alias}`)
      aliases.set(key, node.id)
    }
    const visited = new Set<string>()
    let current: TaxonomyNode | undefined = node
    while (current?.parentId) {
      if (visited.has(current.id)) throw new Error(`taxonomy cycle detected at node: ${current.id}`)
      visited.add(current.id)
      current = byId.get(current.parentId)
    }
  }
}

export function resolveTaxonomyAlias(
  nodes: readonly TaxonomyNode[],
  workspaceId: string,
  alias: string,
): TaxonomyNode | undefined {
  const normalized = normalizeTaxonomyAlias(alias)
  if (!normalized) return undefined
  return nodes.find((node) => node.workspaceId === workspaceId
    && node.status !== 'archived'
    && [node.label, ...node.aliases].some((candidate) => normalizeTaxonomyAlias(candidate) === normalized))
}

export function unresolvedTaxonomyAliases(
  labels: readonly string[],
  nodes: readonly TaxonomyNode[],
  workspaceId: string,
): string[] {
  const unresolved = new Map<string, string>()
  for (const label of labels) {
    const normalized = normalizeTaxonomyAlias(label)
    if (normalized && !resolveTaxonomyAlias(nodes, workspaceId, label) && !unresolved.has(normalized)) unresolved.set(normalized, label)
  }
  return [...unresolved.values()].sort((a, b) => normalizeTaxonomyAlias(a).localeCompare(normalizeTaxonomyAlias(b)))
}

export function unclassifiedTaxonomyItemIds(
  itemIds: readonly string[],
  memberships: readonly TaxonomyMembershipRef[],
): string[] {
  const classified = new Set(
    memberships.filter((membership) => membership.resolved !== false).map((membership) => membership.itemId),
  )
  return [...new Set(itemIds)].filter((itemId) => !classified.has(itemId)).sort()
}

export function unclassifiedTaxonomyItems<T extends { id: string }>(
  items: readonly T[],
  memberships: readonly TaxonomyMembershipRef[],
): T[] {
  const unclassifiedIds = new Set(unclassifiedTaxonomyItemIds(items.map((item) => item.id), memberships))
  return items.filter((item) => unclassifiedIds.has(item.id))
}

export function legacyTaxonomyNodesForProject(
  workspaceId: string,
  labels: readonly string[],
  now = new Date().toISOString(),
  legacyIdFor?: (label: string) => string,
): TaxonomyNode[] {
  const unique = new Map<string, string>()
  for (const label of labels) {
    const normalized = normalizeTaxonomyAlias(label)
    if (normalized && !unique.has(normalized)) unique.set(normalized, label.normalize('NFKC').trim().replace(/\s+/gu, ' '))
  }
  return [...unique.values()].sort((a, b) => normalizeTaxonomyAlias(a).localeCompare(normalizeTaxonomyAlias(b)))
    .map((label) => createTaxonomyNode({
      id: legacyIdFor?.(label),
      workspaceId,
      label,
      aliases: [],
      version: TAXONOMY_VERSION,
    }, now))
}

export function previewTaxonomyRename(
  nodes: readonly TaxonomyNode[],
  nodeId: string,
  memberships: readonly TaxonomyMembershipRef[] = [],
): TaxonomyMutationPreview {
  const node = requireNode(nodes, nodeId)
  return preview('rename', node.id, undefined, memberships, [node.id])
}

export function renameTaxonomyNode<TMembership extends TaxonomyMembershipRef>(
  nodes: readonly TaxonomyNode[],
  nodeId: string,
  label: string,
  memberships: readonly TMembership[] = [],
  now = new Date().toISOString(),
): TaxonomyMutationResult<TMembership> {
  requireNode(nodes, nodeId)
  const nextLabel = label.normalize('NFKC').trim().replace(/\s+/gu, ' ')
  if (!normalizeTaxonomyAlias(nextLabel)) throw new Error('taxonomy node requires a non-empty label')
  const nextNodes = nodes.map((node) => node.id === nodeId
    ? { ...node, label: nextLabel, aliases: uniqueAliases([...node.aliases, node.label], nextLabel), version: node.version + 1, updatedAt: now }
    : { ...node })
  validateTaxonomy(nextNodes)
  return { nodes: nextNodes, memberships: memberships.map((membership) => ({ ...membership })), preview: previewTaxonomyRename(nodes, nodeId, memberships) }
}

export function previewTaxonomyReparent(
  nodes: readonly TaxonomyNode[],
  nodeId: string,
  parentId: string | undefined,
  memberships: readonly TaxonomyMembershipRef[] = [],
): TaxonomyMutationPreview {
  requireNode(nodes, nodeId)
  if (parentId) requireNode(nodes, parentId)
  const nextNodes = nodes.map((node) => node.id === nodeId ? { ...node, parentId } : node)
  validateTaxonomy(nextNodes)
  return preview('reparent', nodeId, parentId, memberships, [nodeId])
}

export function reparentTaxonomyNode<TMembership extends TaxonomyMembershipRef>(
  nodes: readonly TaxonomyNode[],
  nodeId: string,
  parentId: string | undefined,
  memberships: readonly TMembership[] = [],
  now = new Date().toISOString(),
): TaxonomyMutationResult<TMembership> {
  previewTaxonomyReparent(nodes, nodeId, parentId, memberships)
  const nextNodes = nodes.map((node) => node.id === nodeId ? { ...node, parentId, version: node.version + 1, updatedAt: now } : { ...node })
  return { nodes: nextNodes, memberships: memberships.map((membership) => ({ ...membership })), preview: previewTaxonomyReparent(nodes, nodeId, parentId, memberships) }
}

export function previewTaxonomyMerge(
  nodes: readonly TaxonomyNode[],
  sourceNodeId: string,
  targetNodeId: string,
  memberships: readonly TaxonomyMembershipRef[] = [],
): TaxonomyMutationPreview {
  const source = requireNode(nodes, sourceNodeId)
  const target = requireNode(nodes, targetNodeId)
  if (sourceNodeId === targetNodeId) throw new Error('cannot merge a taxonomy node into itself')
  if (source.workspaceId !== target.workspaceId) throw new Error('cannot merge taxonomy nodes across workspaces')
  if (isDescendantOf(nodes, targetNodeId, sourceNodeId)) throw new Error('taxonomy merge would create a cycle')
  const affectedItemIds = memberships.filter((membership) => membership.taxonomyNodeId === sourceNodeId).map((membership) => membership.itemId)
  return {
    kind: 'merge',
    nodeId: sourceNodeId,
    targetNodeId,
    affectedItemIds: [...new Set(affectedItemIds)].sort(),
    affectedNodeIds: [sourceNodeId, targetNodeId, ...nodes.filter((node) => node.parentId === sourceNodeId).map((node) => node.id)],
  }
}

export function mergeTaxonomyNodes<TMembership extends TaxonomyMembershipRef>(
  nodes: readonly TaxonomyNode[],
  sourceNodeId: string,
  targetNodeId: string,
  memberships: readonly TMembership[] = [],
  now = new Date().toISOString(),
): TaxonomyMutationResult<TMembership> {
  const source = requireNode(nodes, sourceNodeId)
  const target = requireNode(nodes, targetNodeId)
  if (source.workspaceId !== target.workspaceId) throw new Error('cannot merge taxonomy nodes across workspaces')
  const preview = previewTaxonomyMerge(nodes, sourceNodeId, targetNodeId, memberships)
  const nextNodes = nodes.map((node) => node.id === targetNodeId
    ? { ...node, aliases: uniqueAliases([...node.aliases, source.label, ...source.aliases], node.label), version: node.version + 1, updatedAt: now }
    : node.id === sourceNodeId
      ? { ...node, status: 'archived' as const, version: node.version + 1, updatedAt: now }
      : node.parentId === sourceNodeId
        ? { ...node, parentId: targetNodeId, version: node.version + 1, updatedAt: now }
      : { ...node })
  validateTaxonomy(nextNodes)
  const nextMemberships = memberships.map((membership) => membership.taxonomyNodeId === sourceNodeId
    ? { ...membership, taxonomyNodeId: targetNodeId }
    : { ...membership })
  return { nodes: nextNodes, memberships: nextMemberships, preview }
}

function preview(
  kind: TaxonomyMutationPreview['kind'],
  nodeId: string,
  targetNodeId: string | undefined,
  memberships: readonly TaxonomyMembershipRef[],
  affectedNodeIds: string[],
): TaxonomyMutationPreview {
  return {
    kind,
    nodeId,
    targetNodeId,
    affectedItemIds: [...new Set(memberships.filter((membership) => membership.taxonomyNodeId === nodeId).map((membership) => membership.itemId))].sort(),
    affectedNodeIds,
  }
}

function requireNode(nodes: readonly TaxonomyNode[], id: string): TaxonomyNode {
  const node = nodes.find((candidate) => candidate.id === id)
  if (!node) throw new Error(`unknown taxonomy node: ${id}`)
  return node
}

function isDescendantOf(nodes: readonly TaxonomyNode[], nodeId: string, ancestorId: string): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  let current = byId.get(nodeId)
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true
    current = byId.get(current.parentId)
  }
  return false
}

function uniqueAliases(aliases: readonly string[], label: string): string[] {
  const seen = new Set<string>([normalizeTaxonomyAlias(label)])
  const result: string[] = []
  for (const alias of aliases) {
    const normalized = normalizeTaxonomyAlias(alias)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(alias.normalize('NFKC').trim().replace(/\s+/gu, ' '))
  }
  return result.sort((a, b) => normalizeTaxonomyAlias(a).localeCompare(normalizeTaxonomyAlias(b)))
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
