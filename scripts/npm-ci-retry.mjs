import { spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const parsedAttempts = Number.parseInt(process.env.NPM_CI_ATTEMPTS ?? '3', 10)
const maxAttempts = Number.isFinite(parsedAttempts) && parsedAttempts > 0 ? parsedAttempts : 3
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  console.log(`npm ci attempt ${attempt}/${maxAttempts}`)
  const result = spawnSync(npmCommand, ['ci'], { stdio: 'inherit' })

  if (result.status === 0) {
    process.exit(0)
  }

  if (result.error) {
    console.error(result.error.message)
  }

  if (attempt < maxAttempts) {
    const retryDelayMs = attempt * 5_000
    console.warn(`npm ci failed; retrying in ${retryDelayMs / 1_000}s`)
    await delay(retryDelayMs)
  } else {
    process.exit(result.status ?? 1)
  }
}
