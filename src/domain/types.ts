export interface NoteInput {
  id?: string
  title?: string
  content: string
  createdAt: string
  tags?: string[] | string
  source?: string
  weight?: number
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
  weight: number
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
  schemaVersion: 1
  id: string
  name: string
  createdAt: string
  updatedAt: string
  timeZone: string
  modelId: string
  sourceDigest: string
  gridSize: number
  notes: TerrainNote[]
  snapshots: TerrainSnapshot[]
  peaks: TerrainPeak[]
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

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
  noteCount: number
}
