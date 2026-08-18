import type {
  AnalysisOptions,
  NoteInput,
  ProcessingProgress,
  TerrainElevation,
  TerrainNote,
  TerrainProject,
  InteractionEvent,
} from '../domain/types'
import type { ActivityHistoryAggregate } from '../domain/activity-history'
import type { TerrainData } from './terrain'
import type { CognitiveObservation, CognitiveState, LearningProgressionProfileVersion } from '../domain/types'

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
      interactionEvents: InteractionEvent[]
      activityAggregates?: ActivityHistoryAggregate[]
      gridSize: number
      timeZone: string
      nowMs: number
      elevation: Extract<TerrainElevation, 'mastery' | 'exploration' | 'activity' | 'progression' | 'structure'>
      cognitiveObservations?: CognitiveObservation[]
      cognitiveStates?: CognitiveState[]
      learningProgressionProfileVersion?: LearningProgressionProfileVersion
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
