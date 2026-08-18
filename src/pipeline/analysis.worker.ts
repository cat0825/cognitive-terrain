import type { AnalysisWorkerRequest, AnalysisWorkerResponse } from './worker-protocol'
import { analyzeNotes } from './run-pipeline'
import { buildTerrainData } from './terrain'
import { calculateActivityElevation } from '../domain/activity-elevation'

const cancelled = new Set<string>()

self.onmessage = (event: MessageEvent<AnalysisWorkerRequest>) => {
  const request = event.data
  if (request.type === 'cancel') {
    cancelled.add(request.requestId)
    return
  }
  if (request.type === 'analyze') void runAnalysis(request)
  if (request.type === 'build-terrain-profile') void runTerrainProfile(request)
}

async function runAnalysis(request: Extract<AnalysisWorkerRequest, { type: 'analyze' }>): Promise<void> {
  cancelled.delete(request.requestId)
  try {
    const project = await analyzeNotes(
      request.name,
      request.notes,
      request.options,
      (progress) => post({ type: 'progress', requestId: request.requestId, progress }),
      () => cancelled.has(request.requestId),
    )
    if (cancelled.has(request.requestId)) return
    post({ type: 'complete', requestId: request.requestId, project })
  } catch (error) {
    if (cancelled.has(request.requestId)) return
    post({ type: 'error', requestId: request.requestId, message: error instanceof Error ? error.message : String(error) })
  } finally {
    cancelled.delete(request.requestId)
  }
}

async function runTerrainProfile(
  request: Extract<AnalysisWorkerRequest, { type: 'build-terrain-profile' }>,
): Promise<void> {
  cancelled.delete(request.requestId)
  try {
    const terrain = buildTerrainData(
      request.notes,
      request.gridSize,
      request.timeZone,
      undefined,
      request.elevation,
      request.elevation === 'activity'
        ? new Map(request.notes.map((note) => [
          note.id,
          calculateActivityElevation({
            itemId: note.id,
            events: request.interactionEvents,
            aggregates: request.activityAggregates,
            evaluatedAt: request.nowMs,
          }),
        ]))
        : undefined,
    )
    if (cancelled.has(request.requestId)) return
    const transfer = terrain.snapshots.map((snapshot) => snapshot.values.buffer)
    post({ type: 'terrain-profile-complete', requestId: request.requestId, terrain }, transfer)
  } catch (error) {
    if (cancelled.has(request.requestId)) return
    post({ type: 'error', requestId: request.requestId, message: error instanceof Error ? error.message : String(error) })
  } finally {
    cancelled.delete(request.requestId)
  }
}

function post(message: AnalysisWorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer })
}
