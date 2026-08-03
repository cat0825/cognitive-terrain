import type { AnalysisOptions, NoteInput, ProcessingProgress, TerrainProject } from '../domain/types'

export type AnalysisWorkerRequest =
  | {
      type: 'analyze'
      requestId: string
      name: string
      notes: NoteInput[]
      options?: AnalysisOptions
    }
  | {
      type: 'cancel'
      requestId: string
    }

export type AnalysisWorkerResponse =
  | { type: 'progress'; requestId: string; progress: ProcessingProgress }
  | { type: 'complete'; requestId: string; project: TerrainProject }
  | { type: 'error'; requestId: string; message: string }
