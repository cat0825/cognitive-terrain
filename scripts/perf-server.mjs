/**
 * Starts a preview server for the perf gate and guarantees teardown.
 *
 * The gate previously required an operator to run `npm run preview` in another
 * terminal, and the README documented that as a comment. A gate that depends on
 * a remembered manual step is indistinguishable from a missing gate: the audit
 * recorded a perf "failure" that was purely a forgotten server.
 *
 * Two details are not incidental:
 *
 * - The port is chosen by asking the OS for a free one. The old hardcoded 4174
 *   collides with long-lived local dev servers, which made the gate fail for
 *   reasons unrelated to performance.
 * - The host is pinned to 127.0.0.1. `vite preview` binds localhost/IPv6 by
 *   default, so a script targeting `127.0.0.1` gets ECONNREFUSED even though a
 *   server is running.
 */

import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const HOST = '127.0.0.1'

/**
 * Builds the app when `dist/` is missing.
 *
 * `vite preview` serves whatever is in `dist/`, and happily starts with nothing
 * there: it binds the port and answers 404. The readiness probe then failed with
 * "did not become ready (HTTP 404)" after the full timeout, which pointed at the
 * server rather than at the real cause. Other browser gates avoid this because
 * their Playwright `webServer` command is `npm run build && npm run preview`;
 * this gate owns its own server, so it has to own the build too.
 *
 * An existing `dist/` is reused rather than rebuilt, so a local run right after a
 * build does not pay for a second one.
 */
function ensureBuild() {
  if (existsSync(path.resolve('dist/index.html'))) return
  console.log('perf gate: dist/ missing, running npm run build')
  const result = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: false })
  if (result.status !== 0) {
    throw new Error(`perf gate could not build the app (npm run build exited with ${result.status})`)
  }
}

/** Asks the OS for a currently free TCP port. */
async function findFreePort() {
  const server = createServer()
  server.listen(0, HOST)
  await once(server, 'listening')
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve) => server.close(resolve))
  if (!port) throw new Error('Could not allocate a free port for the preview server')
  return port
}

async function waitForReady(url, { timeoutMs, isAlive }) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    if (!isAlive()) throw new Error(`Preview server exited before becoming ready${lastError ? `: ${lastError}` : ''}`)
    try {
      const response = await fetch(url, { method: 'GET' })
      if (response.ok) return
      // A persistent 404 means the server is up but has nothing to serve, which is
      // a build problem, not a startup problem. Say so instead of waiting out the
      // whole timeout and blaming the server.
      if (response.status === 404) {
        throw new Error(`Preview server returned 404: dist/ appears to be empty or missing (${url})`)
      }
      lastError = `HTTP ${response.status}`
    } catch (error) {
      if (error instanceof Error && error.message.includes('dist/ appears to be empty')) throw error
      lastError = error instanceof Error ? error.message : String(error)
    }
    await delay(250)
  }
  throw new Error(`Preview server did not become ready within ${timeoutMs}ms${lastError ? ` (${lastError})` : ''}`)
}

/**
 * Starts `vite preview` on a free IPv4 port.
 *
 * Returns the base URL and a `close()` that is safe to call more than once, so
 * both the normal path and a signal handler can invoke it.
 */
export async function startPreviewServer({ timeoutMs = 120_000 } = {}) {
  ensureBuild()
  const port = await findFreePort()
  const child = spawn(
    'npm',
    ['run', 'preview', '--', '--port', String(port), '--strictPort', '--host', HOST],
    { stdio: ['ignore', 'pipe', 'pipe'], shell: false },
  )

  let exited = false
  let exitInfo
  child.on('exit', (code, signal) => { exited = true; exitInfo = { code, signal } })

  // Captured rather than inherited so a failure can be reported with context,
  // instead of interleaving with the perf report on stdout.
  const logs = []
  const record = (chunk) => {
    logs.push(chunk.toString())
    if (logs.length > 200) logs.shift()
  }
  child.stdout.on('data', record)
  child.stderr.on('data', record)

  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    if (exited) return
    child.kill('SIGTERM')
    // Escalate: a preview server holding the port would make the next run fail
    // on --strictPort for reasons unrelated to the code under test.
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000)
    try {
      await once(child, 'exit')
    } finally {
      clearTimeout(timer)
    }
  }

  const baseUrl = `http://${HOST}:${port}/`
  try {
    await waitForReady(baseUrl, { timeoutMs, isAlive: () => !exited })
  } catch (error) {
    const detail = logs.join('').trim()
    await close()
    const suffix = exitInfo ? ` (exit code ${exitInfo.code}, signal ${exitInfo.signal})` : ''
    throw new Error(`${error instanceof Error ? error.message : String(error)}${suffix}${detail ? `\n${detail}` : ''}`)
  }

  return { baseUrl, port, close }
}
