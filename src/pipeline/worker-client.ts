import type { AnalysisOptions, NoteInput, ProcessingProgress, TerrainProject } from '../domain/types'
import type { AnalysisWorkerRequest, AnalysisWorkerResponse } from './worker-protocol'

export interface AnalysisHandle {
  promise: Promise<TerrainProject>
  cancel: () => void
}

export function runAnalysis(
  name: string,
  notes: NoteInput[],
  options: AnalysisOptions,
  onProgress?: (progress: ProcessingProgress) => void,
): AnalysisHandle {
  const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
  const requestId = `analysis-${Date.now()}-${Math.random().toString(16).slice(2)}`
  let settled = false
  let rejectPromise: ((reason?: unknown) => void) | undefined
  const promise = new Promise<TerrainProject>((resolve, reject) => {
    rejectPromise = reject
    worker.onmessage = (event: MessageEvent<AnalysisWorkerResponse>) => {
      const message = event.data
      if (message.requestId !== requestId || settled) return
      if (message.type === 'progress') onProgress?.(message.progress)
      if (message.type === 'complete') {
        settled = true
        worker.terminate()
        resolve(message.project)
      }
      if (message.type === 'error') {
        settled = true
        worker.terminate()
        reject(new Error(message.message))
      }
    }
    worker.onerror = (event) => {
      if (settled) return
      settled = true
      worker.terminate()
      reject(new Error(event.message || '分析 Worker 启动失败'))
    }
    const request: AnalysisWorkerRequest = { type: 'analyze', requestId, name, notes, options }
    worker.postMessage(request)
  })
  return {
    promise,
    cancel: () => {
      if (settled) return
      settled = true
      const request: AnalysisWorkerRequest = { type: 'cancel', requestId }
      try {
        worker.postMessage(request)
      } finally {
        worker.terminate()
        rejectPromise?.(new DOMException('分析已取消', 'AbortError'))
      }
    },
  }
}
