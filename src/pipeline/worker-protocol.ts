import type {
  AnalysisOptions,
  NoteInput,
  ProcessingProgress,
  TerrainElevation,
  TerrainNote,
  TerrainProject,
} from '../domain/types'
import type { TerrainData } from './terrain'

export type AnalysisWorkerRequest =
  | {
      type: 'analyze'
      requestId: string
      name: string
      notes: NoteInput[]
      options?: AnalysisOptions
    }
  | {
      type: 'build-terrain-profile'
      requestId: string
      notes: TerrainNote[]
      gridSize: number
      timeZone: string
      elevation: Extract<TerrainElevation, 'mastery' | 'exploration' | 'structure'>
    }
  | {
      type: 'cancel'
      requestId: string
    }

export type AnalysisWorkerResponse =
  | { type: 'progress'; requestId: string; progress: ProcessingProgress }
  | { type: 'complete'; requestId: string; project: TerrainProject }
  | { type: 'terrain-profile-complete'; requestId: string; terrain: TerrainData }
  | { type: 'error'; requestId: string; message: string }
