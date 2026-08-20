export interface CancellableRequest {
  cancel: () => void
}

export interface LatestRequestController<T extends CancellableRequest> {
  begin: () => number
  attach: (generation: number, request: T) => void
  isCurrent: (generation: number) => boolean
  clear: (generation: number) => void
  cancel: () => void
}

export function createLatestRequestController<T extends CancellableRequest>(): LatestRequestController<T> {
  let generation = 0
  let active: T | null = null
  return {
    begin: () => {
      generation += 1
      active?.cancel()
      active = null
      return generation
    },
    attach: (requestGeneration, request) => {
      if (requestGeneration !== generation) {
        request.cancel()
        return
      }
      active = request
    },
    isCurrent: (requestGeneration) => requestGeneration === generation,
    clear: (requestGeneration) => {
      if (requestGeneration === generation) active = null
    },
    cancel: () => {
      generation += 1
      active?.cancel()
      active = null
    },
  }
}
