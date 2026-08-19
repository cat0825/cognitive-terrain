#!/usr/bin/env node
/**
 * Runs a command with a per-attempt timeout and bounded retries.
 *
 * Written for `playwright install --with-deps`, which shells out to apt-get.
 * When a package mirror stalls, apt produces no output and never exits, so the
 * step consumed the entire 35-minute job budget and surfaced as an opaque job
 * cancellation rather than a failure anyone could act on. Observed on both a PR
 * branch and `main`, so it is infrastructure flakiness rather than a code
 * regression (see issue #55).
 *
 * A non-zero exit code is not the failure mode that matters here; hanging is.
 * This wrapper therefore treats "produced no output for too long" as a failure
 * and retries, instead of waiting for a process that will never finish.
 *
 * Usage:
 *   node scripts/run-with-retry.mjs [options] -- <command> [args...]
 *
 * Options:
 *   --attempts=<n>        total attempts, default 3
 *   --timeout=<seconds>   hard limit per attempt, default 300
 *   --idle-timeout=<sec>  abort an attempt after this long with no output,
 *                         default 120; 0 disables idle detection
 */

import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const DEFAULTS = { attempts: 3, timeoutSeconds: 300, idleTimeoutSeconds: 120 }

/**
 * Signals the child's entire process group, falling back to the child alone.
 *
 * Negating the pid targets the group, which is what reaches grandchildren such as
 * the apt-get that `playwright install --with-deps` starts. The fallback covers
 * the case where the group is already gone.
 */
function killProcessTree(child, signal) {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // Already exited; nothing to signal.
    }
  }
}

function parsePositiveInt(value, fallback, { allowZero = false } = {}) {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  if (parsed < 0) return fallback
  if (parsed === 0 && !allowZero) return fallback
  return parsed
}

function parseArgs(argv) {
  const separator = argv.indexOf('--')
  if (separator === -1 || separator === argv.length - 1) {
    throw new Error('Usage: node scripts/run-with-retry.mjs [options] -- <command> [args...]')
  }
  const options = { ...DEFAULTS }
  for (const flag of argv.slice(0, separator)) {
    const [name, value] = flag.split('=')
    if (name === '--attempts') options.attempts = parsePositiveInt(value, DEFAULTS.attempts)
    else if (name === '--timeout') options.timeoutSeconds = parsePositiveInt(value, DEFAULTS.timeoutSeconds)
    else if (name === '--idle-timeout') {
      options.idleTimeoutSeconds = parsePositiveInt(value, DEFAULTS.idleTimeoutSeconds, { allowZero: true })
    } else throw new Error(`Unknown option: ${name}`)
  }
  return { options, command: argv[separator + 1], args: argv.slice(separator + 2) }
}

/**
 * Resolves with the child's exit code, or a reason when the attempt is aborted.
 *
 * Output is streamed rather than buffered so a long install still reports
 * progress, and so the idle timer can observe genuine activity.
 */
function runAttempt(command, args, { timeoutSeconds, idleTimeoutSeconds }) {
  return new Promise((resolve) => {
    // detached: true puts the child in its own process group so the whole tree can
    // be signalled. `playwright install --with-deps` spawns apt-get as a
    // grandchild; killing only the direct child let apt survive holding
    // /var/lib/apt/lists/lock, and every subsequent retry then failed instantly
    // with "Could not get lock ... held by process N (apt-get)" (exit code 100).
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, detached: true })
    let settled = false
    let idleTimer
    let hardTimer

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(idleTimer)
      clearTimeout(hardTimer)
      // Signal the whole process group, not just the child. SIGKILL follows
      // SIGTERM because a wedged apt ignores the polite signal, and any survivor
      // keeps the package lock and poisons the remaining retries.
      if (result.aborted && child.exitCode === null) {
        killProcessTree(child, 'SIGTERM')
        setTimeout(() => killProcessTree(child, 'SIGKILL'), 5_000).unref?.()
      }
      resolve(result)
    }

    const resetIdleTimer = () => {
      if (!idleTimeoutSeconds) return
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        finish({ aborted: true, reason: `no output for ${idleTimeoutSeconds}s` })
      }, idleTimeoutSeconds * 1_000)
    }

    child.stdout.on('data', (chunk) => { process.stdout.write(chunk); resetIdleTimer() })
    child.stderr.on('data', (chunk) => { process.stderr.write(chunk); resetIdleTimer() })
    child.on('error', (error) => finish({ aborted: true, reason: error.message }))
    child.on('close', (code) => finish({ aborted: false, code: code ?? 1 }))

    hardTimer = setTimeout(() => {
      finish({ aborted: true, reason: `exceeded ${timeoutSeconds}s` })
    }, timeoutSeconds * 1_000)
    resetIdleTimer()
  })
}

const { options, command, args } = parseArgs(process.argv.slice(2))
const label = [command, ...args].join(' ')

for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
  console.log(`::group::${label} (attempt ${attempt}/${options.attempts})`)
  const startedAt = Date.now()
  const result = await runAttempt(command, args, options)
  const elapsedSeconds = Math.round((Date.now() - startedAt) / 1_000)
  console.log('::endgroup::')

  if (!result.aborted && result.code === 0) {
    console.log(`${label} succeeded in ${elapsedSeconds}s on attempt ${attempt}`)
    process.exit(0)
  }

  const cause = result.aborted ? `aborted: ${result.reason}` : `exit code ${result.code}`
  console.warn(`${label} failed after ${elapsedSeconds}s (${cause})`)

  if (attempt === options.attempts) {
    console.error(`::error::${label} failed after ${options.attempts} attempts (${cause})`)
    process.exit(result.aborted ? 1 : result.code)
  }

  const retryDelaySeconds = attempt * 10
  console.warn(`retrying in ${retryDelaySeconds}s`)
  await delay(retryDelaySeconds * 1_000)
}
