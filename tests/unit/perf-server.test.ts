import { afterEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error -- plain ESM script shared with CI, no type declarations
import { signalProcessTree } from '../../scripts/perf-server.mjs'

afterEach(() => vi.restoreAllMocks())

describe('perf preview cleanup', () => {
  it('signals the detached process group on POSIX hosts', () => {
    if (process.platform === 'win32') return
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    const childKill = vi.fn()

    expect(signalProcessTree({ pid: 42, kill: childKill }, 'SIGTERM')).toBe(true)
    expect(kill).toHaveBeenCalledWith(-42, 'SIGTERM')
    expect(childKill).not.toHaveBeenCalled()
  })

  it('falls back to the direct child when the process group no longer exists', () => {
    if (process.platform === 'win32') return
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('gone'), { code: 'ESRCH' })
    })
    const childKill = vi.fn(() => true)

    expect(signalProcessTree({ pid: 42, kill: childKill }, 'SIGKILL')).toBe(true)
    expect(childKill).toHaveBeenCalledWith('SIGKILL')
  })
})
