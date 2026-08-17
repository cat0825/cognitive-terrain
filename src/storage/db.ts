import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from 'idb'
import { cognitiveStateFromNote } from '../domain/cognitive-state'
import { compactActivityHistory } from '../domain/activity-history'
import { areasForNote, plateIdForArea } from '../domain/knowledge-plates'
import { legacyTaxonomyNodesForProject, validateTaxonomy } from '../domain/taxonomy'
import {
  migrateTerrainProjectToV3,
  type CitationV3,
  type KnowledgeItemV3,
  type LayoutRecordV3,
  type PlateMembershipV3,
  type RelationV3,
  type RevisionV3,
  type SchemaV3Bundle,
  type SourceV3,
  type WorkspaceV3,
} from '../domain/schema-v3'
import { DEFAULT_TERRAIN_PROFILE_ID, DEFAULT_TERRAIN_PROFILES } from '../domain/terrain-profile'
import type {
  CognitiveState,
  InteractionEvent,
  ProjectBackup,
  ReferenceAtlasManifest,
  TerrainProfile,
  TerrainProject,
  TaxonomyNode,
} from '../domain/types'

export const DATABASE_NAME = 'cognitive-terrain'
export const DATABASE_VERSION = 6

export interface StoredCognitiveState extends CognitiveState {
  workspaceId: string
}

export interface StoredInteractionEvent extends InteractionEvent {
  workspaceId: string
}

export interface StoredPlateMembership extends PlateMembershipV3 {
  workspaceId: string
}

export interface StoredLayoutRecord extends LayoutRecordV3 {
  workspaceId: string
}

export interface StoredTerrainProfile extends TerrainProfile {
  workspaceId: string
}

export interface CognitiveTerrainDB extends DBSchema {
  projects: {
    key: string
    value: TerrainProject
    indexes: { 'by-updated-at': string }
  }
  backups: {
    key: string
    value: ProjectBackup
    indexes: {
      'by-project': string
      'by-created-at': string
    }
  }
  workspaces: {
    key: string
    value: WorkspaceV3
    indexes: { 'by-updated-at': string }
  }
  items: {
    key: [string, string]
    value: KnowledgeItemV3
    indexes: {
      'by-workspace': string
      'by-status': [string, string]
      'by-updated-at': [string, string]
    }
  }
  sources: {
    key: [string, string]
    value: SourceV3
    indexes: {
      'by-workspace': string
      'by-canonical-url': [string, string]
      'by-content-hash': [string, string]
    }
  }
  relations: {
    key: [string, string]
    value: RelationV3
    indexes: {
      'by-workspace': string
      'by-from': [string, string]
      'by-to': [string, string]
    }
  }
  cognitiveStates: {
    key: [string, string]
    value: StoredCognitiveState
    indexes: {
      'by-workspace': string
      'by-item': [string, string]
    }
  }
  interactionEvents: {
    key: [string, string]
    value: StoredInteractionEvent
    indexes: {
      'by-workspace': string
      'by-item': [string, string]
      'by-occurred-at': [string, string]
    }
  }
  plateMemberships: {
    key: [string, string, string]
    value: StoredPlateMembership
    indexes: {
      'by-workspace': string
      'by-item': [string, string]
      'by-taxonomy': [string, string]
    }
  }
  taxonomyNodes: {
    key: [string, string]
    value: TaxonomyNode
    indexes: {
      'by-workspace': string
      'by-parent': [string, string]
      'by-version': [string, number]
    }
  }
  referenceAtlases: {
    key: [string, string]
    value: ReferenceAtlasManifest
    indexes: {
      'by-workspace': string
      'by-taxonomy-version': [string, number]
    }
  }
  layouts: {
    key: [string, string, string]
    value: StoredLayoutRecord
    indexes: {
      'by-workspace': string
      'by-layout': [string, string]
    }
  }
  terrainProfiles: {
    key: [string, string]
    value: StoredTerrainProfile
    indexes: { 'by-workspace': string }
  }
  citations: {
    key: [string, string]
    value: CitationV3
    indexes: {
      'by-workspace': string
      'by-item': [string, string]
      'by-source': [string, string]
    }
  }
  revisions: {
    key: [string, string]
    value: RevisionV3
    indexes: {
      'by-workspace': string
      'by-entity': [string, string]
      'by-created-at': [string, string]
    }
  }
}

export const PROJECT_TRANSACTION_STORE_NAMES: StoreNames<CognitiveTerrainDB>[] = [
  'projects',
  'backups',
  'workspaces',
  'items',
  'sources',
  'relations',
  'cognitiveStates',
  'interactionEvents',
  'plateMemberships',
  'taxonomyNodes',
  'referenceAtlases',
  'layouts',
  'terrainProfiles',
  'citations',
  'revisions',
]

type DatabaseWriteMode = 'readwrite' | 'versionchange'
type DatabaseWriteTransaction<Mode extends DatabaseWriteMode> = IDBPTransaction<
  CognitiveTerrainDB,
  StoreNames<CognitiveTerrainDB>[],
  Mode
>
type WorkspaceStoreName = Exclude<
  StoreNames<CognitiveTerrainDB>,
  'projects' | 'backups' | 'workspaces'
>

let databasePromise: Promise<IDBPDatabase<CognitiveTerrainDB>> | undefined

export function getDatabase(): Promise<IDBPDatabase<CognitiveTerrainDB>> {
  if (databasePromise) return databasePromise
  const opening = openDB<CognitiveTerrainDB>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(database, oldVersion, _newVersion, transaction) {
      void transaction.done.catch(() => undefined)
      void upgradeDatabase(database, oldVersion, transaction).catch(() => {
        try {
          transaction.abort()
        } catch {
          // A failed request may already have aborted the versionchange transaction.
        }
      })
    },
    blocking() {
      void closeDatabase()
    },
  })
  databasePromise = opening
  void opening.catch(() => {
    if (databasePromise === opening) databasePromise = undefined
  })
  return opening
}

export async function closeDatabase(): Promise<void> {
  if (!databasePromise) return
  const database = await databasePromise
  database.close()
  databasePromise = undefined
}

export function migrateProject(project: TerrainProject): TerrainProject {
  const sourceSchemaVersion = (project as { schemaVersion: number }).schemaVersion
  const legacyV1 = sourceSchemaVersion < 2
  const migratedNotes = project.notes.map((note) => {
    const areas = areasForNote(note)
    return {
      ...note,
      area: areas[0],
      areas: areas.length ? areas : undefined,
      links: note.links ?? [],
    }
  })
  const cognitiveStates = project.cognitiveStates ?? migratedNotes.flatMap((note) => {
    const state = cognitiveStateFromNote(note, 'migration', note.reviewedAt ?? project.updatedAt)
    return state ? [state] : []
  })
  const terrainProfiles = project.terrainProfiles?.length
    ? project.terrainProfiles
    : DEFAULT_TERRAIN_PROFILES.map((profile) => ({ ...profile }))
  const activeTerrainProfileId = terrainProfiles.some((profile) => profile.id === project.activeTerrainProfileId)
    ? project.activeTerrainProfileId
    : terrainProfiles[0]?.id ?? DEFAULT_TERRAIN_PROFILE_ID
  const interactionEvents = project.interactionEvents ?? project.activityHistory?.rawEvents ?? []
  const activityHistory = compactActivityHistory(interactionEvents, {
    timeZone: project.timeZone,
    now: project.updatedAt,
    aggregates: project.activityHistory?.aggregates,
  })
  const taxonomyNodes = project.taxonomyNodes?.length
    ? project.taxonomyNodes.map((node) => ({ ...node, aliases: [...node.aliases] }))
    : legacyTaxonomyNodesForProject(
        project.id,
        migratedNotes.flatMap((note) => note.declaredAreas?.length ? note.declaredAreas : areasForNote(note)),
        project.updatedAt,
        plateIdForArea,
      )
  validateTaxonomy(taxonomyNodes)
  return {
    ...project,
    schemaVersion: 3,
    embeddingMode: legacyV1 ? 'fallback' : project.embeddingMode ?? 'fallback',
    noteNeighbors: legacyV1 ? [] : project.noteNeighbors ?? [],
    notes: migratedNotes,
    cognitiveStates,
    interactionEvents: activityHistory.rawEvents,
    activityHistory,
    terrainProfiles,
    activeTerrainProfileId,
    taxonomyNodes,
    taxonomyVersion: Math.max(
      project.taxonomyVersion ?? 0,
      taxonomyNodes.reduce((max, node) => Math.max(max, node.version), 0),
    ),
    referenceAtlases: (project.referenceAtlases ?? []).map((manifest) => ({
      ...manifest,
      taxonomyNodeIds: [...manifest.taxonomyNodeIds],
    })),
  }
}

export async function replaceProjectMaterialization<Mode extends DatabaseWriteMode>(
  transaction: DatabaseWriteTransaction<Mode>,
  project: TerrainProject,
  sourceSchemaVersion: number = project.schemaVersion,
): Promise<void> {
  const { bundle } = migrateTerrainProjectToV3(project, { sourceSchemaVersion })
  await clearProjectMaterialization(transaction, project.id, false)

  await transaction.objectStore('workspaces').put(bundle.workspace)
  const writes: Array<() => Promise<unknown>> = [
    ...bundle.items.map((item) => () => transaction.objectStore('items').put(item)),
    ...bundle.sources.map((source) => () => transaction.objectStore('sources').put(source)),
    ...bundle.relations.map((relation) => () => transaction.objectStore('relations').put(relation)),
    ...bundle.cognitiveStates.map((state) => () => transaction.objectStore('cognitiveStates').put({
      ...state,
      workspaceId: project.id,
    })),
    ...bundle.interactionEvents.map((event) => () => transaction.objectStore('interactionEvents').put({
      ...event,
      workspaceId: project.id,
    })),
    ...bundle.plateMemberships.map((membership) => () => transaction.objectStore('plateMemberships').put({
      ...membership,
      workspaceId: project.id,
    })),
    ...bundle.taxonomyNodes.map((node) => () => transaction.objectStore('taxonomyNodes').put(node)),
    ...bundle.referenceAtlases.map((manifest) => () => transaction.objectStore('referenceAtlases').put(manifest)),
    ...bundle.layouts.map((layout) => () => transaction.objectStore('layouts').put({
      ...layout,
      workspaceId: project.id,
    })),
    ...bundle.terrainProfiles.map((profile) => () => transaction.objectStore('terrainProfiles').put({
      ...profile,
      workspaceId: project.id,
    })),
    ...bundle.citations.map((citation) => () => transaction.objectStore('citations').put(citation)),
    ...bundle.revisions.map((revision) => () => transaction.objectStore('revisions').put(revision)),
  ]
  await Promise.all(writes.map((write) => Promise.resolve().then(write)))
}

export async function clearProjectMaterialization<Mode extends DatabaseWriteMode>(
  transaction: DatabaseWriteTransaction<Mode>,
  workspaceId: string,
  includeRevisions = true,
): Promise<void> {
  await transaction.objectStore('workspaces').delete(workspaceId)
  const stores: WorkspaceStoreName[] = [
    'items',
    'sources',
    'relations',
    'cognitiveStates',
    'interactionEvents',
    'plateMemberships',
    'taxonomyNodes',
    'referenceAtlases',
    'layouts',
    'terrainProfiles',
    'citations',
    ...(includeRevisions ? ['revisions' as const] : []),
  ]
  await Promise.all(stores.map((storeName) => clearWorkspaceStore(transaction, storeName, workspaceId)))
}

export async function readProjectMaterialization(workspaceId: string): Promise<SchemaV3Bundle | undefined> {
  const database = await getDatabase()
  const workspace = await database.get('workspaces', workspaceId)
  if (!workspace) return undefined
  const [
    items,
    sources,
    relations,
    storedCognitiveStates,
    storedInteractionEvents,
    storedPlateMemberships,
    taxonomyNodes,
    referenceAtlases,
    storedLayouts,
    storedTerrainProfiles,
    citations,
    revisions,
  ] = await Promise.all([
    database.getAllFromIndex('items', 'by-workspace', workspaceId),
    database.getAllFromIndex('sources', 'by-workspace', workspaceId),
    database.getAllFromIndex('relations', 'by-workspace', workspaceId),
    database.getAllFromIndex('cognitiveStates', 'by-workspace', workspaceId),
    database.getAllFromIndex('interactionEvents', 'by-workspace', workspaceId),
    database.getAllFromIndex('plateMemberships', 'by-workspace', workspaceId),
    database.getAllFromIndex('taxonomyNodes', 'by-workspace', workspaceId),
    database.getAllFromIndex('referenceAtlases', 'by-workspace', workspaceId),
    database.getAllFromIndex('layouts', 'by-workspace', workspaceId),
    database.getAllFromIndex('terrainProfiles', 'by-workspace', workspaceId),
    database.getAllFromIndex('citations', 'by-workspace', workspaceId),
    database.getAllFromIndex('revisions', 'by-workspace', workspaceId),
  ])
  return {
    workspace,
    items,
    sources,
    relations,
    cognitiveStates: storedCognitiveStates.map(stripWorkspaceId),
    interactionEvents: storedInteractionEvents.map(stripWorkspaceId),
    plateMemberships: storedPlateMemberships.map(stripWorkspaceId),
    taxonomyNodes,
    referenceAtlases,
    layouts: storedLayouts.map(stripWorkspaceId),
    terrainProfiles: storedTerrainProfiles.map(stripWorkspaceId),
    citations,
    revisions,
  }
}

function createSchemaV3Stores(database: IDBPDatabase<CognitiveTerrainDB>): void {
  const workspaces = database.createObjectStore('workspaces', { keyPath: 'id' })
  workspaces.createIndex('by-updated-at', 'updatedAt')

  const items = database.createObjectStore('items', { keyPath: ['workspaceId', 'id'] })
  items.createIndex('by-workspace', 'workspaceId')
  items.createIndex('by-status', ['workspaceId', 'status'])
  items.createIndex('by-updated-at', ['workspaceId', 'updatedAt'])

  const sources = database.createObjectStore('sources', { keyPath: ['workspaceId', 'id'] })
  sources.createIndex('by-workspace', 'workspaceId')
  sources.createIndex('by-canonical-url', ['workspaceId', 'canonicalUrl'])
  sources.createIndex('by-content-hash', ['workspaceId', 'contentHash'])

  const relations = database.createObjectStore('relations', { keyPath: ['workspaceId', 'id'] })
  relations.createIndex('by-workspace', 'workspaceId')
  relations.createIndex('by-from', ['workspaceId', 'fromItemId'])
  relations.createIndex('by-to', ['workspaceId', 'toItemId'])

  const cognitiveStates = database.createObjectStore('cognitiveStates', {
    keyPath: ['workspaceId', 'itemId'],
  })
  cognitiveStates.createIndex('by-workspace', 'workspaceId')
  cognitiveStates.createIndex('by-item', ['workspaceId', 'itemId'])

  const interactionEvents = database.createObjectStore('interactionEvents', {
    keyPath: ['workspaceId', 'id'],
  })
  interactionEvents.createIndex('by-workspace', 'workspaceId')
  interactionEvents.createIndex('by-item', ['workspaceId', 'itemId'])
  interactionEvents.createIndex('by-occurred-at', ['workspaceId', 'occurredAt'])

  const plateMemberships = database.createObjectStore('plateMemberships', {
    keyPath: ['workspaceId', 'itemId', 'taxonomyNodeId'],
  })
  plateMemberships.createIndex('by-workspace', 'workspaceId')
  plateMemberships.createIndex('by-item', ['workspaceId', 'itemId'])
  plateMemberships.createIndex('by-taxonomy', ['workspaceId', 'taxonomyNodeId'])

  createTaxonomyNodeStore(database)
  createReferenceAtlasStore(database)

  const layouts = database.createObjectStore('layouts', {
    keyPath: ['workspaceId', 'layoutId', 'itemId'],
  })
  layouts.createIndex('by-workspace', 'workspaceId')
  layouts.createIndex('by-layout', ['workspaceId', 'layoutId'])

  const terrainProfiles = database.createObjectStore('terrainProfiles', {
    keyPath: ['workspaceId', 'id'],
  })
  terrainProfiles.createIndex('by-workspace', 'workspaceId')

  const citations = database.createObjectStore('citations', { keyPath: ['workspaceId', 'id'] })
  citations.createIndex('by-workspace', 'workspaceId')
  citations.createIndex('by-item', ['workspaceId', 'itemId'])
  citations.createIndex('by-source', ['workspaceId', 'sourceId'])

  const revisions = database.createObjectStore('revisions', { keyPath: ['workspaceId', 'id'] })
  revisions.createIndex('by-workspace', 'workspaceId')
  revisions.createIndex('by-entity', ['workspaceId', 'entityId'])
  revisions.createIndex('by-created-at', ['workspaceId', 'createdAt'])
}

async function upgradeDatabase(
  database: IDBPDatabase<CognitiveTerrainDB>,
  oldVersion: number,
  transaction: DatabaseWriteTransaction<'versionchange'>,
): Promise<void> {
  if (oldVersion < 1) {
    const store = database.createObjectStore('projects', { keyPath: 'id' })
    store.createIndex('by-updated-at', 'updatedAt')
  }
  if (oldVersion < 3) {
    const backups = database.createObjectStore('backups', { keyPath: 'id' })
    backups.createIndex('by-project', 'projectId')
    backups.createIndex('by-created-at', 'createdAt')
  }
  if (oldVersion < 5) {
    createSchemaV3Stores(database)
    const store = transaction.objectStore('projects')
    let cursor = await store.openCursor()
    while (cursor) {
      const sourceSchemaVersion = (cursor.value as { schemaVersion: number }).schemaVersion
      const project = migrateProject(cursor.value)
      await cursor.update(project)
      await replaceProjectMaterialization(transaction, project, sourceSchemaVersion)
      cursor = await cursor.continue()
    }
  }
  if (oldVersion >= 5 && oldVersion < 6) {
    createTaxonomyNodeStore(database)
    createReferenceAtlasStore(database)
    const store = transaction.objectStore('projects')
    let cursor = await store.openCursor()
    while (cursor) {
      const project = migrateProject(cursor.value)
      await cursor.update(project)
      await replaceProjectMaterialization(transaction, project, 3)
      cursor = await cursor.continue()
    }
  }
}

function createTaxonomyNodeStore(database: IDBPDatabase<CognitiveTerrainDB>): void {
  const taxonomyNodes = database.createObjectStore('taxonomyNodes', { keyPath: ['workspaceId', 'id'] })
  taxonomyNodes.createIndex('by-workspace', 'workspaceId')
  taxonomyNodes.createIndex('by-parent', ['workspaceId', 'parentId'])
  taxonomyNodes.createIndex('by-version', ['workspaceId', 'version'])
}

function createReferenceAtlasStore(database: IDBPDatabase<CognitiveTerrainDB>): void {
  const referenceAtlases = database.createObjectStore('referenceAtlases', { keyPath: ['workspaceId', 'id'] })
  referenceAtlases.createIndex('by-workspace', 'workspaceId')
  referenceAtlases.createIndex('by-taxonomy-version', ['workspaceId', 'taxonomyVersion'])
}

async function clearWorkspaceStore<Mode extends DatabaseWriteMode>(
  transaction: DatabaseWriteTransaction<Mode>,
  storeName: WorkspaceStoreName,
  workspaceId: string,
): Promise<void> {
  const store = transaction.objectStore(storeName)
  const keys = await store.index('by-workspace').getAllKeys(workspaceId)
  await Promise.all(keys.map((key) => store.delete(key)))
}

function stripWorkspaceId<T extends { workspaceId: string }>(value: T): Omit<T, 'workspaceId'> {
  const { workspaceId: _workspaceId, ...record } = value
  return record
}
