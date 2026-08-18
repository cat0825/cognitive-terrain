import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const distDir = path.resolve('dist/assets')
const budget = {
  // Issues #24 and #25 add lazy write-back plus shared prerequisite-strata UI.
  main: 360 * 1024,
  totalJs: 2260 * 1024,
  css: 40 * 1024,
}

const entries = await readdir(distDir)
let totalJs = 0
let mainSize = 0
let cssSize = 0

for (const entry of entries) {
  const size = (await stat(path.join(distDir, entry))).size
  if (entry.endsWith('.js')) {
    totalJs += size
    if (entry.startsWith('index-')) mainSize = size
  } else if (entry.endsWith('.css')) {
    cssSize += size
  }
}

const failures = []
if (mainSize > budget.main) failures.push(`主包 ${format(mainSize)} 超过预算 ${format(budget.main)}`)
if (totalJs > budget.totalJs) failures.push(`JS 总量 ${format(totalJs)} 超过预算 ${format(budget.totalJs)}`)
if (cssSize > budget.css) failures.push(`CSS ${format(cssSize)} 超过预算 ${format(budget.css)}`)

console.log(`主包 ${format(mainSize)} | JS 总量 ${format(totalJs)} | CSS ${format(cssSize)}`)
if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('size budget ok')

function format(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`
}
