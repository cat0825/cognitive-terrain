import { describe, expect, it, vi } from 'vitest'
import { createLatestRequestController } from '../../src/store/latest-request'

describe('latest request controller', () => {
  it('keeps a superseded request from clearing or cancelling the current request', () => {
    const controller = createLatestRequestController<{ cancel: () => void }>()
    const first = { cancel: vi.fn() }
    const second = { cancel: vi.fn() }

    const firstGeneration = controller.begin()
    controller.attach(firstGeneration, first)
    const secondGeneration = controller.begin()
    controller.attach(secondGeneration, second)
    controller.clear(firstGeneration)
    controller.cancel()

    expect(first.cancel).toHaveBeenCalledOnce()
    expect(second.cancel).toHaveBeenCalledOnce()
    expect(controller.isCurrent(firstGeneration)).toBe(false)
    expect(controller.isCurrent(secondGeneration)).toBe(false)
  })

  it('cancels a request attached after its generation was superseded', () => {
    const controller = createLatestRequestController<{ cancel: () => void }>()
    const stale = { cancel: vi.fn() }
    const generation = controller.begin()
    controller.begin()
    controller.attach(generation, stale)
    expect(stale.cancel).toHaveBeenCalledOnce()
  })
})
