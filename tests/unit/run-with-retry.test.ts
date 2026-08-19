import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const script = path.resolve('scripts/run-with-retry.mjs')

/** Runs the wrapper and returns its exit code plus combined output. */
async function runWrapper(args: string[]): Promise<{ code: number; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('node', [script, ...args], { timeout: 60_000 })
    return { code: 0, output: `${stdout}${stderr}` }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return { code: failure.code ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

describe('run-with-retry', () => {
  it('passes through a successful command without retrying', async () => {
    const { code, output } = await runWrapper(['--', 'echo', 'ok'])

    expect(code).toBe(0)
    expect(output).toContain('ok')
    expect(output).toContain('attempt 1/3')
    expect(output).not.toContain('attempt 2/3')
  })

  it('aborts and retries a command that produces no output, instead of waiting for it', async () => {
    // This is the failure mode that consumed the 35-minute job timeout: a stalled
    // apt mirror produces no output and never exits. `sleep` stands in for it.
    // The wrapper must give up on each attempt via the idle timer rather than
    // waiting out the much longer hard timeout.
    const startedAt = Date.now()
    const { code, output } = await runWrapper([
      '--attempts=2', '--idle-timeout=1', '--timeout=45', '--', 'sleep', '40',
    ])
    const elapsedMs = Date.now() - startedAt

    expect(code).not.toBe(0)
    expect(output).toContain('no output for 1s')
    expect(output).toContain('attempt 2/2')
    // Two 1s attempts plus one 10s backoff, nowhere near 2 x 40s.
    expect(elapsedMs).toBeLessThan(30_000)
  }, 60_000)

  it('does not kill a command that is slow but still reporting progress', async () => {
    // Guards against a fix that trades hangs for false failures: a long install
    // that keeps printing must be allowed to finish.
    const { code, output } = await runWrapper([
      '--attempts=1', '--idle-timeout=5', '--timeout=45', '--',
      'node', '-e', 'console.log("start"); setTimeout(() => { console.log("end") }, 2000)',
    ])

    expect(code).toBe(0)
    expect(output).toContain('start')
    expect(output).toContain('end')
  }, 60_000)

  it('retries a command that exits non-zero and reports the exit code', async () => {
    const { code, output } = await runWrapper([
      '--attempts=2', '--idle-timeout=0', '--timeout=30', '--',
      'node', '-e', 'process.exit(3)',
    ])

    expect(code).toBe(3)
    expect(output).toContain('exit code 3')
    expect(output).toContain('attempt 2/2')
  }, 60_000)

  it('rejects a missing command separator instead of silently doing nothing', async () => {
    const { code, output } = await runWrapper(['--attempts=2'])

    expect(code).not.toBe(0)
    expect(output).toContain('Usage:')
  })
})
