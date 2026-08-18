import { cognitiveStateFromNote, normalizeActiveReferenceAtlasId } from './cognitive-state'
import {
  DEFAULT_LEARNING_PROGRESSION_PROFILE_VERSION,
  normalizeCognitiveObservations,
} from './learning-progression'
import { DEFAULT_TERRAIN_PROFILE_ID, DEFAULT_TERRAIN_PROFILES } from './terrain-profile'
import { areasForNote, plateIdForArea } from './knowledge-plates'
import { buildPrerequisiteTopology } from './prerequisite-topology'
import {
  legacyTaxonomyNodesForProject,
  normalizeTaxonomyAlias,
  resolveTaxonomyAlias,
  validateTaxonomy,
} from './taxonomy'
import type { ActivityHistoryState } from './activity-history'
import { STABLE_LAYOUT_FORMULA_VERSION } from './layout-version'
import type {
  CognitiveState,
  CognitiveObservation,
  ExplorationLifecycleItem,
  InteractionEvent,
  NoteNeighborEvidence,
  PrerequisiteTopology,
  ReferenceAtlasManifest,
  TerrainProfile,
  TerrainProject,
  TaxonomyNode,
  VaultSourceState,
  VaultSyncRevision,
} from './types'

export interface WorkspaceV3 {
  schemaVersion: 3
  id: string
  name: string
  createdAt: string
  updatedAt: string
  timeZone: string
  activeTerrainProfileId: string
  activityHistory?: ActivityHistoryState
  taxonomyVersion?: number
  activeReferenceAtlasId?: string
  learningProgressionProfileVersion?: TerrainProject['learningProgressionProfileVersion']
  prerequisiteTopology?: PrerequisiteTopology
}

export interface KnowledgeItemV3 {
  id: string
  workspaceId: string
  title: string
  content: string
  contentHash: string
  sourceIds: string[]
  tags: string[]
  area?: string
  areas?: string[]
  declaredAreas?: string[]
  createdAt: string
  updatedAt: string
  status: 'draft' | 'active' | 'archived'
}

export interface SourceV3 {
  id: string
  workspaceId: string
  kind: 'note' | 'web' | 'unknown'
  title: string
  sourcePath?: string
  vault?: string
  canonicalUrl?: string
  contentHash: string
  sourceKey?: string
  lastModifiedMs?: number
  size?: number
  provenance: 'import' | 'vault-sync'
  retrievedAt: string
}

export interface RelationV3 {
  id: string
  workspaceId: string
  fromItemId: string
  toItemId?: string
  targetTitle: string
  kind: 'wikilink' | 'prerequisite'
  resolved: boolean
  provenance: 'import' | 'yaml' | 'app-confirmed'
  sourceNoteId?: string
  sourceField?: 'prerequisites' | 'buildsOn' | 'app'
}

export interface PlateMembershipV3 {
  itemId: string
  taxonomyNodeId: string
  declaredLabel: string
  declaredLabels: string[]
  resolved: boolean
  resolution: 'label' | 'alias' | 'migration' | 'unresolved'
  taxonomyVersion: number
  weight: number
  provenance: 'yaml' | 'migration'
}

export interface LayoutRecordV3 {
  layoutId: string
  itemId: string
  x: number
  y: number
  algorithmVersion: string
  anchorVersion: string
}

export interface CitationV3 {
  id: string
  workspaceId: string
  itemId: string
  sourceId: string
  quote: string
  locator: {
    page?: number
    section?: string
    startOffset?: number
    endOffset?: number
    fragmentUrl?: string
  }
  capturedAt: string
  contentHash: string
}

export interface MigrationBaselinePatchV3 {
  kind: 'migration-baseline'
  entityHash: string
  contentHash: string
  sourceSchemaVersion: number
}

export interface VaultSyncPatchV3 {
  kind: 'vault-sync'
  sourceId: string
  operation: VaultSyncRevision['operation']
  rawContentHash: string
  previousContentHash?: string
  fromPath?: string
  toPath?: string
  entityHash: string
  acceptedAt: string
  timestampSource: VaultSyncRevision['timestampSource']
  provenance: 'vault-sync'
}

export interface VaultWritebackPatchV3 {
  kind: 'vault-writeback'
  sourceId: string
  path: string
  beforeRawContentHash: string
  afterRawContentHash: string
  requestIds: string[]
  acceptedAt: string
  provenance: 'vault-writeback'
}

export interface RevisionV3 {
  id: string
  workspaceId: string
  entityId: string
  entityType: 'item'
  patch: MigrationBaselinePatchV3 | VaultSyncPatchV3 | VaultWritebackPatchV3
  actorId: 'migration' | 'vault-sync' | 'vault-writeback'
  createdAt: string
}

export interface SchemaV3Bundle {
  workspace: WorkspaceV3
  items: KnowledgeItemV3[]
  sources: SourceV3[]
  relations: RelationV3[]
  cognitiveStates: CognitiveState[]
  cognitiveObservations: CognitiveObservation[]
  interactionEvents: InteractionEvent[]
  plateMemberships: PlateMembershipV3[]
  layouts: LayoutRecordV3[]
  neighborEvidence: NoteNeighborEvidence[]
  terrainProfiles: TerrainProfile[]
  citations: CitationV3[]
  revisions: RevisionV3[]
  taxonomyNodes: TaxonomyNode[]
  referenceAtlases: ReferenceAtlasManifest[]
  explorationItems: ExplorationLifecycleItem[]
}

export interface SchemaV3MigrationReport {
  sourceSchemaVersion: number
  sourceDigest: string
  itemCount: number
  sourceCount: number
  relationCount: number
  unresolvedRelationCount: number
  cognitiveStateCount: number
  cognitiveObservationCount: number
  layoutCount: number
  neighborEvidenceCount: number
  citationCount: number
  revisionCount: number
  explorationItemCount: number
  warnings: string[]
}

export interface SchemaV3MigrationOptions {
  sourceSchemaVersion?: number
}

export function migrateTerrainProjectToV3(
  project: TerrainProject,
  options: SchemaV3MigrationOptions = {},
): {
  bundle: SchemaV3Bundle
  report: SchemaV3MigrationReport
} {
  const sourceSchemaVersion = options.sourceSchemaVersion ?? project.schemaVersion
  assertUniqueIds('item', project.notes.map((note) => note.id))
  assertUniqueIds('cognitive state item', (project.cognitiveStates ?? []).map((state) => state.itemId))
  const cognitiveObservations = normalizeCognitiveObservations(project.cognitiveObservations)
  assertUniqueIds('cognitive observation', cognitiveObservations.map((observation) => observation.id))
  assertUniqueIds('interaction event', (project.interactionEvents ?? []).map((event) => event.id))
  assertUniqueIds('terrain profile', (project.terrainProfiles ?? []).map((profile) => profile.id))
  const itemIds = new Set(project.notes.map((note) => note.id))
  const explorationItems = normalizeExplorationItems(project.explorationItems ?? [], itemIds)
  const neighborEvidence = (project.noteNeighborEvidence ?? [])
    .flat()
    .filter((evidence) => itemIds.has(evidence.sourceId) && itemIds.has(evidence.targetId))
  assertUniqueIds(
    'neighbor evidence',
    neighborEvidence.map((evidence) => `${evidence.sourceId}:${evidence.targetId}`),
  )
  assertKnownItemReferences(
    'cognitive state',
    (project.cognitiveStates ?? []).map((state) => state.itemId),
    itemIds,
  )
  assertKnownItemReferences(
    'interaction event',
    (project.interactionEvents ?? []).map((event) => event.itemId),
    itemIds,
  )
  assertKnownItemReferences(
    'cognitive observation',
    cognitiveObservations.map((observation) => observation.itemId),
    itemIds,
  )
  const titleIndex = buildTitleIndex(project)
  const prerequisiteTopology = buildPrerequisiteTopology(project.notes)
  const vaultSources = vaultSourcesForProject(project)
  const taxonomyNodes = taxonomyNodesForProject(project)
  validateTaxonomy(taxonomyNodes)
  const referenceAtlases = referenceAtlasesForProject(project, taxonomyNodes)
  const sources = project.notes.flatMap((note) => {
    const vaultSource = vaultSourceForNote(note, vaultSources)
    if (!hasSourceMetadata(note, vaultSource)) return []
    const sourceIdentity = sourceIdentityForNote(note)
    const sourceId = note.sourceId ?? vaultSource?.sourceId ?? `source-${stableHash(sourceIdentity)}`
    const sourcePath = vaultSource?.relativePath ?? note.sourcePath
    const vault = vaultSource
      ? project.vaultSync?.vaults.find((candidate) => candidate.vaultId === vaultSource.vaultId)?.displayName ?? note.vault
      : note.vault
    return [{
      id: sourceId,
      workspaceId: project.id,
      kind: sourceKind(note.source, sourcePath),
      title: note.source ?? sourcePath ?? note.title,
      sourcePath,
      vault,
      canonicalUrl: isHttpUrl(note.source) ? note.source : undefined,
      contentHash: vaultSource?.rawContentHash ?? stableHash(note.content),
      sourceKey: note.sourceKey ?? vaultSource?.acceptedNote.sourceKey,
      lastModifiedMs: vaultSource?.lastModifiedMs,
      size: vaultSource?.size,
      provenance: vaultSource ? 'vault-sync' : 'import',
      retrievedAt: vaultSource?.acceptedAt ?? project.updatedAt,
    } satisfies SourceV3]
  })
  const uniqueSources = dedupeById(sources)

  const items = project.notes.map((note) => {
    const vaultSource = vaultSourceForNote(note, vaultSources)
    const sourceId = hasSourceMetadata(note, vaultSource)
      ? note.sourceId ?? vaultSource?.sourceId ?? `source-${stableHash(sourceIdentityForNote(note))}`
      : undefined
    return {
      id: note.id,
      workspaceId: project.id,
      title: note.title,
      content: note.content,
      contentHash: stableHash(note.content),
      sourceIds: sourceId ? [sourceId] : [],
      tags: [...note.tags],
      area: note.area,
      areas: note.areas ? [...note.areas] : undefined,
      declaredAreas: note.declaredAreas ? [...note.declaredAreas] : undefined,
      createdAt: note.createdAt,
      updatedAt: vaultSource?.acceptedAt ?? project.updatedAt,
      status: note.status === 'archived' ? 'archived' : sourceId ? 'active' : 'draft',
    } satisfies KnowledgeItemV3
  })

  const wikiLinkRelations = project.notes.flatMap((note) => note.links.map((targetTitle) => {
    const toItemId = titleIndex.get(normalizeTitle(targetTitle))
    return {
      id: `relation-${stableHash(`${note.id}\n${targetTitle}`)}`,
      workspaceId: project.id,
      fromItemId: note.id,
      toItemId,
      targetTitle,
      kind: 'wikilink',
      resolved: toItemId !== undefined,
      provenance: 'import',
    } satisfies RelationV3
  }))
  const prerequisiteRelations = prerequisiteTopology.relations.map((relation) => ({
    id: relation.id,
    workspaceId: project.id,
    fromItemId: relation.fromItemId,
    toItemId: relation.toItemId,
    targetTitle: relation.declaredTarget,
    kind: 'prerequisite' as const,
    resolved: true,
    provenance: relation.provenance,
    sourceNoteId: relation.sourceNoteId,
    sourceField: relation.sourceField,
  } satisfies RelationV3))
  const relations = dedupeById([...wikiLinkRelations, ...prerequisiteRelations])

  const cognitiveStatesByItem = new Map(
    (project.cognitiveStates ?? []).map((state) => [state.itemId, state]),
  )
  const cognitiveStates = project.notes.flatMap((note) => {
    const current = cognitiveStatesByItem.get(note.id)
    if (current) return [current]
    const migrated = cognitiveStateFromNote(note, 'migration', note.reviewedAt ?? project.updatedAt)
    return migrated ? [migrated] : []
  })
  const interactionEvents = project.interactionEvents ?? []
  const terrainProfiles = project.terrainProfiles
    ?? DEFAULT_TERRAIN_PROFILES.map((profile) => ({ ...profile }))
  const plateMemberships = project.notes.flatMap((note) => {
    const areas = note.declaredAreas?.length ? [...note.declaredAreas] : areasForNote(note)
    const memberships = new Map<string, Omit<PlateMembershipV3, 'weight'>>()
    for (const area of areas) {
      const node = resolveTaxonomyAlias(taxonomyNodes, project.id, area)
      const taxonomyNodeId = node?.id ?? `unresolved-${plateIdForArea(area)}`
      const existing = memberships.get(taxonomyNodeId)
      if (existing) {
        existing.declaredLabels.push(area)
        continue
      }
      memberships.set(taxonomyNodeId, {
        itemId: note.id,
        taxonomyNodeId,
        declaredLabel: area,
        declaredLabels: [area],
        resolved: node !== undefined,
        resolution: node
          ? project.taxonomyNodes?.length
            ? normalizeTaxonomyAlias(node.label) === normalizeTaxonomyAlias(area) ? 'label' : 'alias'
            : 'migration'
          : 'unresolved',
        taxonomyVersion: node?.version ?? 0,
        provenance: note.cognitiveStateProvenance === 'yaml' ? 'yaml' as const : 'migration' as const,
      })
    }
    const weight = memberships.size ? 1 / memberships.size : 0
    return [...memberships.values()].map((membership) => ({ ...membership, weight }))
  })
  const layouts = project.notes.map((note) => ({
    layoutId: `${project.id}:layout-v2-import`,
    itemId: note.id,
    x: note.x,
    y: note.y,
    algorithmVersion: STABLE_LAYOUT_FORMULA_VERSION,
    anchorVersion: 'unanchored-v2',
  }))
  const citations: CitationV3[] = []
  const migrationRevisions = items.map((item) => {
    const entityHash = stableHash(JSON.stringify({
      title: item.title,
      contentHash: item.contentHash,
      sourceIds: item.sourceIds,
      tags: item.tags,
      area: item.area,
      areas: item.areas,
      status: item.status,
    }))
    return {
      id: `revision-${stableHash(`${item.id}\n${entityHash}`)}`,
      workspaceId: project.id,
      entityId: item.id,
      entityType: 'item',
      patch: {
        kind: 'migration-baseline',
        entityHash,
        contentHash: item.contentHash,
        sourceSchemaVersion,
      },
      actorId: 'migration',
      createdAt: item.updatedAt,
    } satisfies RevisionV3
  })
  const vaultSyncRevisions = (project.vaultSync?.revisions ?? []).map((revision) => ({
    id: revision.id,
    workspaceId: project.id,
    entityId: revision.itemId,
    entityType: 'item' as const,
    patch: {
      kind: 'vault-sync' as const,
      sourceId: revision.sourceId,
      operation: revision.operation,
      rawContentHash: revision.rawContentHash,
      previousContentHash: revision.previousContentHash,
      fromPath: revision.fromPath,
      toPath: revision.toPath,
      entityHash: revision.entityHash,
      acceptedAt: revision.acceptedAt,
      timestampSource: revision.timestampSource,
      provenance: revision.provenance,
    },
    actorId: 'vault-sync' as const,
    createdAt: revision.occurredAt,
  } satisfies RevisionV3))
  const vaultWritebackRevisions = (project.vaultSync?.writebackRevisions ?? []).map((revision) => ({
    id: revision.id,
    workspaceId: project.id,
    entityId: revision.itemId,
    entityType: 'item' as const,
    patch: {
      kind: 'vault-writeback' as const,
      sourceId: revision.sourceId,
      path: revision.path,
      beforeRawContentHash: revision.beforeRawContentHash,
      afterRawContentHash: revision.afterRawContentHash,
      requestIds: [...revision.requestIds],
      acceptedAt: revision.acceptedAt,
      provenance: revision.provenance,
    },
    actorId: 'vault-writeback' as const,
    createdAt: revision.acceptedAt,
  } satisfies RevisionV3))
  const revisions = dedupeById([...migrationRevisions, ...vaultSyncRevisions, ...vaultWritebackRevisions])
  const warnings = [
    ...(uniqueSources.length === 0 ? ['项目没有可迁移的来源；所有条目均标记为 draft'] : []),
    ...(relations.some((relation) => relation.kind === 'wikilink' && !relation.resolved) ? ['部分 WikiLink 无法解析，已保留目标标题'] : []),
    ...(prerequisiteTopology.diagnostics.length
      ? [`${prerequisiteTopology.diagnostics.length} 条 prerequisite 声明未参与结构派生；请检查拓扑诊断`]
      : []),
  ]
  const bundle: SchemaV3Bundle = {
    workspace: {
      schemaVersion: 3,
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      timeZone: project.timeZone,
      activeTerrainProfileId: project.activeTerrainProfileId ?? DEFAULT_TERRAIN_PROFILE_ID,
      activityHistory: project.activityHistory,
      taxonomyVersion: Math.max(
        project.taxonomyVersion ?? 0,
        taxonomyNodes.reduce((max, node) => Math.max(max, node.version), 0),
      ),
      activeReferenceAtlasId: normalizeActiveReferenceAtlasId(
        referenceAtlases,
        project.activeReferenceAtlasId,
      ),
      learningProgressionProfileVersion: project.learningProgressionProfileVersion
        ?? DEFAULT_LEARNING_PROGRESSION_PROFILE_VERSION,
      prerequisiteTopology,
    },
    items,
    sources: uniqueSources,
    relations,
    cognitiveStates,
    cognitiveObservations,
    interactionEvents,
    plateMemberships,
    layouts,
    neighborEvidence,
    terrainProfiles,
    citations,
    revisions,
    taxonomyNodes,
    referenceAtlases,
    explorationItems,
  }
  return {
    bundle,
    report: {
      sourceSchemaVersion,
      sourceDigest: project.sourceDigest,
      itemCount: items.length,
      sourceCount: uniqueSources.length,
      relationCount: relations.length,
      unresolvedRelationCount: relations.filter((relation) => !relation.resolved).length,
      cognitiveStateCount: cognitiveStates.length,
      cognitiveObservationCount: cognitiveObservations.length,
      layoutCount: layouts.length,
      neighborEvidenceCount: neighborEvidence.length,
      citationCount: citations.length,
      revisionCount: revisions.length,
      explorationItemCount: explorationItems.length,
      warnings,
    },
  }
}

export function normalizeExplorationItems(
  values: readonly ExplorationLifecycleItem[],
  knownItemIds: ReadonlySet<string>,
): ExplorationLifecycleItem[] {
  assertUniqueIds('exploration item', values.map((item) => item.id))
  assertUniqueIds('exploration suggestion', values.map((item) => item.suggestion.id))
  assertUniqueIds(
    'exploration lifecycle event',
    values.flatMap((item) => item.history.map((event) => event.id)),
  )
  return values.map((item) => {
    if (!Number.isFinite(item.suggestion.priority)) {
      throw new Error(`Schema v3 migration rejected invalid exploration priority: ${item.id}`)
    }
    return {
      ...item,
      suggestion: {
        ...item.suggestion,
        reason: { ...item.suggestion.reason },
        supportingItemIds: [...new Set(item.suggestion.supportingItemIds)]
          .filter((itemId) => knownItemIds.has(itemId)),
        sourceRoute: normalizeExplorationSourceRoute(item.suggestion.sourceRoute, knownItemIds),
        action: { ...item.suggestion.action },
        referenceBoundary: item.suggestion.referenceBoundary
          ? { ...item.suggestion.referenceBoundary }
          : undefined,
        reopenReason: item.suggestion.reopenReason ? { ...item.suggestion.reopenReason } : undefined,
        previousDecision: item.suggestion.previousDecision
          ? { ...item.suggestion.previousDecision }
          : undefined,
      },
      action: { ...item.action },
      history: item.history.map((event) => ({
        ...event,
        action: event.action ? { ...event.action } : undefined,
      })),
    }
  })
}

function normalizeExplorationSourceRoute(
  route: ExplorationLifecycleItem['suggestion']['sourceRoute'],
  knownItemIds: ReadonlySet<string>,
): ExplorationLifecycleItem['suggestion']['sourceRoute'] {
  if (route.kind === 'note' && !knownItemIds.has(route.noteId)) {
    return { kind: 'unavailable', originalKind: 'note', detail: 'source note no longer exists' }
  }
  if (route.kind === 'relationship'
    && (!knownItemIds.has(route.fromItemId) || (route.toItemId !== undefined && !knownItemIds.has(route.toItemId)))) {
    return { kind: 'unavailable', originalKind: 'relationship', detail: 'relationship endpoint no longer exists' }
  }
  if (route.kind === 'goal' && route.noteId !== undefined && !knownItemIds.has(route.noteId)) {
    const { noteId: _noteId, ...goalRoute } = route
    return goalRoute
  }
  return { ...route }
}

function buildTitleIndex(project: TerrainProject): Map<string, string> {
  const index = new Map<string, string>()
  const ambiguousTitles = new Set<string>()
  for (const note of project.notes) {
    const title = normalizeTitle(note.title)
    if (ambiguousTitles.has(title)) continue
    if (index.has(title)) {
      index.delete(title)
      ambiguousTitles.add(title)
      continue
    }
    index.set(title, note.id)
  }
  return index
}

function taxonomyNodesForProject(project: TerrainProject): TaxonomyNode[] {
  if (project.taxonomyNodes?.length) {
    const foreign = project.taxonomyNodes.find((node) => node.workspaceId !== project.id)
    if (foreign) throw new Error(`taxonomy node ${foreign.id} crosses workspace boundary`)
    return project.taxonomyNodes.map((node) => ({ ...node, aliases: [...node.aliases] }))
  }
  const labels = project.notes.flatMap((note) => areasForNote(note))
  return legacyTaxonomyNodesForProject(project.id, labels, project.updatedAt, plateIdForArea)
}

function referenceAtlasesForProject(
  project: TerrainProject,
  taxonomyNodes: readonly TaxonomyNode[],
): ReferenceAtlasManifest[] {
  const currentVersion = Math.max(
    project.taxonomyVersion ?? 0,
    taxonomyNodes.reduce((max, node) => Math.max(max, node.version), 0),
  )
  const nodeIds = new Set(taxonomyNodes.map((node) => node.id))
  const manifestIds = new Set<string>()
  return (project.referenceAtlases ?? []).map((manifest) => {
    if (!manifest.id.trim() || manifestIds.has(manifest.id)) throw new Error(`duplicate or empty reference atlas id: ${manifest.id}`)
    manifestIds.add(manifest.id)
    if (manifest.workspaceId !== project.id) throw new Error(`reference atlas ${manifest.id} crosses workspace boundary`)
    if (!manifest.label.normalize('NFKC').trim()) throw new Error(`reference atlas ${manifest.id} requires a label`)
    const createdAt = Date.parse(manifest.createdAt)
    const updatedAt = Date.parse(manifest.updatedAt)
    if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt) || updatedAt < createdAt) {
      throw new Error(`reference atlas ${manifest.id} has invalid timestamps`)
    }
    if (!Number.isInteger(manifest.taxonomyVersion) || manifest.taxonomyVersion < 1 || manifest.taxonomyVersion > currentVersion) {
      throw new Error(`reference atlas ${manifest.id} has invalid taxonomy version: ${manifest.taxonomyVersion}`)
    }
    const uniqueNodeIds = [...new Set(manifest.taxonomyNodeIds)]
    for (const nodeId of uniqueNodeIds) {
      if (!nodeIds.has(nodeId)) throw new Error(`reference atlas ${manifest.id} references missing taxonomy node: ${nodeId}`)
    }
    return { ...manifest, taxonomyNodeIds: uniqueNodeIds }
  })
}

function normalizeTitle(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function sourceKind(source: string | undefined, sourcePath?: string): SourceV3['kind'] {
  if (isHttpUrl(source)) return 'web'
  return source || sourcePath ? 'note' : 'unknown'
}

function vaultSourcesForProject(project: TerrainProject): {
  byId: ReadonlyMap<string, VaultSourceState>
  byItemId: ReadonlyMap<string, VaultSourceState>
} {
  const sources = project.vaultSync?.sources ?? []
  return {
    byId: new Map(sources.map((source) => [source.sourceId, source])),
    byItemId: new Map(sources.map((source) => [source.itemId, source])),
  }
}

function vaultSourceForNote(
  note: TerrainProject['notes'][number],
  sources: ReturnType<typeof vaultSourcesForProject>,
): VaultSourceState | undefined {
  return note.sourceId ? sources.byId.get(note.sourceId) ?? sources.byItemId.get(note.id) : sources.byItemId.get(note.id)
}

function hasSourceMetadata(
  note: TerrainProject['notes'][number],
  vaultSource?: VaultSourceState,
): boolean {
  return Boolean(note.sourceId || note.source || note.sourcePath || note.vault || vaultSource)
}

function sourceIdentityForNote(note: TerrainProject['notes'][number]): string {
  return `${note.vault ?? ''}\n${note.sourcePath ?? ''}\n${note.source ?? ''}`
}

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function dedupeById<T extends { id: string }>(values: T[]): T[] {
  return [...new Map(values.map((value) => [value.id, value])).values()]
}

function assertUniqueIds(label: string, ids: string[]): void {
  const seen = new Set<string>()
  for (const id of ids) {
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error(`Schema v3 migration rejected an empty ${label} id`)
    }
    if (seen.has(id)) {
      throw new Error(`Schema v3 migration rejected duplicate ${label} id: ${id}`)
    }
    seen.add(id)
  }
}

function assertKnownItemReferences(label: string, itemIds: string[], knownItemIds: ReadonlySet<string>): void {
  for (const itemId of itemIds) {
    if (!knownItemIds.has(itemId)) {
      throw new Error(`Schema v3 migration rejected ${label} reference to missing item: ${itemId}`)
    }
  }
}

function stableHash(value: string): string {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(16).padStart(8, '0')
}
