import type { ActivityHistoryState } from './activity-history'

export type NoteStatus = 'seed' | 'growing' | 'stable' | 'gap' | 'archived'

export type TaxonomyNodeStatus = 'active' | 'archived'

export interface TaxonomyNode {
  id: string
  workspaceId: string
  label: string
  parentId?: string
  aliases: string[]
  description?: string
  version: number
  status: TaxonomyNodeStatus
  createdAt: string
  updatedAt: string
}

export interface ReferenceAtlasManifest {
  id: string
  workspaceId: string
  label: string
  taxonomyVersion: number
  taxonomyNodeIds: string[]
  createdAt: string
  updatedAt: string
}

export type ExplorationReasonCode =
  | 'reference-gap'
  | 'stale-reviewed-item'
  | 'unresolved-bridge'
  | 'unassessed-note'
  | 'low-confidence-note'
  | 'user-marked-goal'

export type ExplorationReason = ExplorationReasonCode extends infer Code
  ? Code extends ExplorationReasonCode
    ? { code: Code; detail: string }
    : never
  : never

export type ExplorationSourceRoute =
  | { kind: 'note'; noteId: string }
  | {
      kind: 'relationship'
      bridgeId: string
      fromItemId: string
      toItemId?: string
      targetTitle?: string
    }
  | { kind: 'reference-node'; atlasId: string; taxonomyNodeId: string }
  | { kind: 'goal'; goalId: string; noteId?: string }
  | {
      kind: 'unavailable'
      originalKind: 'note' | 'relationship' | 'reference-node' | 'goal'
      detail?: string
    }

export interface ExplorationAction {
  title: string
  detail?: string
}

export interface ExplorationReferenceBoundary {
  atlasId: string
  taxonomyNodeId: string
  label?: string
  taxonomyVersion?: string | number
}

export interface ExplorationReopenReason {
  code:
    | 'fresh-evidence-after-completed'
    | 'fresh-evidence-after-dismissed'
    | 'fresh-evidence-after-rejected'
  previousEvidenceFingerprint: string
  previousDecidedAt: string
}

export interface ExplorationPreviousDecision {
  status: 'completed' | 'dismissed' | 'rejected'
  decidedAt: string
  evidenceFingerprint: string
}

export interface ExplorationSuggestion {
  id: string
  reason: ExplorationReason
  supportingItemIds: string[]
  sourceRoute: ExplorationSourceRoute
  evidenceFingerprint: string
  priority: number
  action: ExplorationAction
  referenceBoundary?: ExplorationReferenceBoundary
  reopenReason?: ExplorationReopenReason
  previousDecision?: ExplorationPreviousDecision
}

export type ExplorationLifecycleStatus =
  | 'proposed'
  | 'accepted'
  | 'in-progress'
  | 'completed'
  | 'snoozed'
  | 'dismissed'
  | 'rejected'

export type ExplorationLifecycleEventType =
  | 'edit'
  | 'accept'
  | 'start'
  | 'complete'
  | 'snooze'
  | 'dismiss'
  | 'reject'

export interface ExplorationLifecycleEvent {
  id: string
  type: ExplorationLifecycleEventType
  occurredAt: string
  fromStatus: ExplorationLifecycleStatus
  toStatus: ExplorationLifecycleStatus
  evidenceFingerprint: string
  action?: ExplorationAction
  snoozedUntil?: string
  note?: string
}

export interface ExplorationLifecycleItem {
  id: string
  suggestion: ExplorationSuggestion
  status: ExplorationLifecycleStatus
  action: ExplorationAction
  userNotes?: string
  snoozedUntil?: string
  lastExploredAt?: string
  updatedAt: string
  history: ExplorationLifecycleEvent[]
}

export type CognitiveStateProvenance = 'yaml' | 'app' | 'migration'

export type PrerequisiteProvenance = 'yaml' | 'app-confirmed'
export type PrerequisiteSourceField = 'prerequisites' | 'buildsOn' | 'app'

export interface PrerequisiteInput {
  target: string
  provenance: PrerequisiteProvenance
  sourceField: PrerequisiteSourceField
}

export interface PrerequisiteDeclaration extends PrerequisiteInput {
  relationId: string
}

export interface PrerequisiteRelation {
  id: string
  sourceNoteId: string
  fromItemId: string
  toItemId: string
  declaredTarget: string
  provenance: PrerequisiteProvenance
  sourceField: PrerequisiteSourceField
}

export type PrerequisiteDiagnosticKind = 'self-link' | 'unresolved-target' | 'ambiguous-title' | 'cycle'

export interface PrerequisiteDiagnostic {
  id: string
  kind: PrerequisiteDiagnosticKind
  sourceNoteId: string
  relationIds: string[]
  declaredTarget?: string
  itemIds: string[]
}

export interface FoundationAssignment {
  itemId: string
  status: 'neutral' | 'derived' | 'excluded'
  depth?: number
  branchRootIds: string[]
  relationIds: string[]
  sourceNoteIds: string[]
}

export interface PrerequisiteTopology {
  version: 1
  formulaVersion: 'explicit-prerequisite-dag-v1'
  relations: PrerequisiteRelation[]
  diagnostics: PrerequisiteDiagnostic[]
  assignments: FoundationAssignment[]
}

export interface CognitiveState {
  itemId: string
  mastery?: number
  confidence?: number
  exploration?: number
  status?: NoteStatus
  reviewedAt?: string
  updatedAt: string
  provenance: CognitiveStateProvenance
}

export type InteractionEventType =
  | 'created'
  | 'edited'
  | 'opened'
  | 'reviewed'
  | 'linked'
  | 'classified'

export interface InteractionEvent {
  id: string
  itemId: string
  type: InteractionEventType
  occurredAt: string
  payload?: Record<string, unknown>
}

export type TerrainElevation = 'density' | 'mastery' | 'exploration' | 'activity' | 'structure'
export type TerrainColor = 'area' | 'source-kind' | 'trust'
export type TerrainOverlay = 'temperature' | 'confidence' | 'staleness' | 'gaps'

export interface TerrainProfile {
  id: string
  label: string
  elevation: TerrainElevation
  color: TerrainColor
  overlay?: TerrainOverlay
  formulaVersion: string
}

export interface NoteInput {
  id?: string
  sourceId?: string
  sourceKey?: string
  title?: string
  content: string
  createdAt: string
  tags?: string[] | string
  source?: string
  sourcePath?: string
  vault?: string
  weight?: number
  mastery?: number
  confidence?: number
  exploration?: number
  status?: NoteStatus
  area?: string
  areas?: string[]
  declaredAreas?: string[]
  reviewedAt?: string
  cognitiveStateProvenance?: CognitiveStateProvenance
  links?: string[]
  prerequisites?: PrerequisiteInput[]
}

export interface TerrainNote {
  id: string
  sourceId?: string
  sourceKey?: string
  fingerprint: string
  title: string
  content: string
  createdAt: string
  createdAtMs: number
  tags: string[]
  source?: string
  sourcePath?: string
  vault?: string
  weight: number
  mastery?: number
  confidence?: number
  exploration?: number
  status?: NoteStatus
  area?: string
  areas?: string[]
  declaredAreas?: string[]
  reviewedAt?: string
  cognitiveStateProvenance?: CognitiveStateProvenance
  links: string[]
  prerequisites?: PrerequisiteDeclaration[]
  x: number
  y: number
}

export interface TerrainSnapshot {
  bucket: string
  label: string
  values: Float32Array
}

export interface TerrainPeak {
  id: string
  x: number
  y: number
  height: number
  label: string
  noteIds: string[]
}

export interface NoteNeighborEvidence {
  sourceId: string
  targetId: string
  rank: number
  score: number
  modelId: string
  embeddingMode: 'semantic' | 'fallback'
  formulaVersion: 'embedding-cosine-neighbors-v1'
  provenance: 'embedding'
}

export interface TerrainProject {
  schemaVersion: 3
  id: string
  name: string
  createdAt: string
  updatedAt: string
  timeZone: string
  modelId: string
  embeddingMode: 'semantic' | 'fallback' | 'demo'
  sourceDigest: string
  gridSize: number
  notes: TerrainNote[]
  snapshots: TerrainSnapshot[]
  peaks: TerrainPeak[]
  noteNeighbors: string[][]
  noteNeighborEvidence?: NoteNeighborEvidence[][]
  cognitiveStates: CognitiveState[]
  interactionEvents: InteractionEvent[]
  activityHistory?: ActivityHistoryState
  terrainProfiles: TerrainProfile[]
  activeTerrainProfileId: string
  taxonomyNodes?: TaxonomyNode[]
  taxonomyVersion?: number
  referenceAtlases?: ReferenceAtlasManifest[]
  activeReferenceAtlasId?: string
  explorationItems?: ExplorationLifecycleItem[]
  vaultSync?: VaultSyncState
  prerequisiteTopology?: PrerequisiteTopology
}

export type VaultSyncField =
  | 'title'
  | 'content'
  | 'createdAt'
  | 'tags'
  | 'weight'
  | 'mastery'
  | 'confidence'
  | 'exploration'
  | 'status'
  | 'areas'
  | 'reviewedAt'
  | 'links'
  | 'prerequisites'

export interface VaultSyncNoteSnapshot {
  sourceKey?: string
  title: string
  content: string
  createdAt: string
  tags: string[]
  weight: number
  mastery?: number
  confidence?: number
  exploration?: number
  status?: NoteStatus
  areas: string[]
  declaredAreas: string[]
  reviewedAt?: string
  links: string[]
  prerequisites?: PrerequisiteDeclaration[]
}

export interface VaultSyncVault {
  vaultId: string
  displayName: string
  accessMode: 'directory-handle' | 'reselect-files'
  lastScannedAt: string
}

export interface VaultSourceState {
  sourceId: string
  itemId: string
  vaultId: string
  relativePath: string
  status: 'present' | 'removed'
  rawContentHash: string
  entityHash: string
  lastModifiedMs?: number
  size?: number
  acceptedFieldHashes: Partial<Record<VaultSyncField, string>>
  acceptedNote: VaultSyncNoteSnapshot
  acceptedAt: string
}

export interface VaultSyncRevision {
  id: string
  sourceId: string
  itemId: string
  operation: 'add' | 'modify' | 'rename' | 'remove'
  rawContentHash: string
  previousContentHash?: string
  fromPath?: string
  toPath?: string
  entityHash: string
  acceptedAt: string
  occurredAt: string
  timestampSource: 'file-last-modified' | 'accepted-at'
  provenance: 'vault-sync'
}

export interface VaultWritebackRevision {
  id: string
  sourceId: string
  itemId: string
  path: string
  beforeRawContentHash: string
  afterRawContentHash: string
  requestIds: string[]
  acceptedAt: string
  provenance: 'vault-writeback'
}

export interface VaultSyncState {
  version: 1
  vaults: VaultSyncVault[]
  sources: VaultSourceState[]
  revisions: VaultSyncRevision[]
  writebackRevisions?: VaultWritebackRevision[]
}

export interface AnalysisOptions {
  modelId?: string
  timeZone?: string
  gridSize?: number
  embeddingStrategy?: 'transformers' | 'deterministic'
}

export type ProcessingStage =
  | 'parsing'
  | 'model'
  | 'embedding'
  | 'layout'
  | 'terrain'
  | 'cache'

export interface ProcessingProgress {
  stage: ProcessingStage
  completed: number
  total: number
  message: string
}

export interface ImportIssue {
  file: string
  row?: number
  field?: string
  message: string
}

export interface ParsedImport {
  notes: NoteInput[]
  issues: ImportIssue[]
  name: string
}

export type ViewMode = '3d' | '2d'
export type QualityLevel = 'high' | 'medium' | 'low'
export type VisualDimension = 'density' | 'mastery' | 'exploration' | 'activity' | 'structure' | 'temperature' | 'area'

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
  noteCount: number
}

export type ProjectBackupReason =
  | 'manual'
  | 'before-save'
  | 'before-delete'
  | 'before-restore'
  | 'before-vault-sync'
  | 'before-vault-writeback'

export interface ProjectBackup {
  id: string
  projectId: string
  projectName: string
  createdAt: string
  reason: ProjectBackupReason
  project: TerrainProject
}

export interface ProjectBackupSummary {
  id: string
  projectId: string
  projectName: string
  createdAt: string
  reason: ProjectBackupReason
  noteCount: number
}
