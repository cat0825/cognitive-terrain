import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAnalysis } from '../../src/pipeline/worker-client'
import type { AnalysisWorkerRequest } from '../../src/pipeline/worker-protocol'

class FakeWorker {
  static instances: FakeWorker[] = []

  onmessage: Worker['onmessage'] = null
  onerror: Worker['onerror'] = null
  posted: AnalysisWorkerRequest[] = []
  terminated = false

  constructor() {
    FakeWorker.instances.push(this)
  }

  postMessage(message: AnalysisWorkerRequest): void {
    this.posted.push(message)
  }

  terminate(): void {
    this.terminated = true
  }
}

describe('analysis worker client', () => {
  afterEach(() => {
    FakeWorker.instances = []
    vi.unstubAllGlobals()
  })

  it('rejects the analysis promise with AbortError when cancelled', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const handle = runAnalysis(
      'Cancelled project',
      [{ content: 'A note', createdAt: '2026-01-01T00:00:00.000Z' }],
      {},
    )
    const worker = FakeWorker.instances[0]

    handle.cancel()

    await expect(handle.promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.posted.map((message) => message.type)).toEqual(['analyze', 'cancel'])
    expect(worker.terminated).toBe(true)
  })
})
