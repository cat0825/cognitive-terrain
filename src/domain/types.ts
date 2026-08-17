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

export type CognitiveStateProvenance = 'yaml' | 'app' | 'migration'

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

export type CognitiveObservationProvenance =
  | 'self-assessment'
  | 'yaml-import'
  | 'review-outcome'
  | 'migration'

export interface CognitiveObservationBase {
  schemaVersion: 1
  id: string
  itemId: string
  observedAt: string
  provenance: CognitiveObservationProvenance
  reason: string
}

export type CognitiveObservation =
  | (CognitiveObservationBase & {
      field: 'mastery' | 'confidence' | 'exploration'
      value: number
    })
  | (CognitiveObservationBase & {
      field: 'status'
      value: NoteStatus
    })
  | (CognitiveObservationBase & {
      field: 'reviewedAt'
      value: string
    })

export type LearningProgressionProfileVersion =
  | 'learning-progression-v1'
  | 'learning-progression-linear-decay-v1'

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

export type TerrainElevation = 'density' | 'mastery' | 'exploration' | 'activity' | 'progression' | 'structure'
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
}

export interface TerrainNote {
  id: string
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
  cognitiveStates: CognitiveState[]
  cognitiveObservations?: CognitiveObservation[]
  learningProgressionProfileVersion?: LearningProgressionProfileVersion
  interactionEvents: InteractionEvent[]
  activityHistory?: ActivityHistoryState
  terrainProfiles: TerrainProfile[]
  activeTerrainProfileId: string
  taxonomyNodes?: TaxonomyNode[]
  taxonomyVersion?: number
  referenceAtlases?: ReferenceAtlasManifest[]
  activeReferenceAtlasId?: string
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
export type VisualDimension = 'density' | 'mastery' | 'exploration' | 'activity' | 'progression' | 'temperature' | 'area'

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
  noteCount: number
}

export type ProjectBackupReason = 'manual' | 'before-save' | 'before-delete' | 'before-restore'

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
