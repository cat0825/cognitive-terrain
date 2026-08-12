#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

const DEFAULT_OBSIDIAN_CONFIG = path.join(
  os.homedir(),
  'Library/Application Support/obsidian/obsidian.json',
)
const DEFAULT_TOLARIA_CONFIG = path.join(
  os.homedir(),
  'Library/Application Support/com.tolaria.app/vaults.json',
)
const DEFAULT_OUTPUT_DIR = path.resolve('output/migration')
const DEFAULT_PREVIEW_LIMIT = 2200
const DEFAULT_PREVIEW_CONTENT_LIMIT = 50_000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const READ_CONCURRENCY = 24

const IGNORED_DIRECTORIES = new Set([
  '.astro',
  '.cache',
  '.git',
  '.github',
  '.next',
  '.obsidian',
  '.trash',
  '.venv',
  '__pycache__',
  '_migration',
  'attachments',
  'blob-report',
  'build',
  'coverage',
  'dist',
  'logs',
  'node_modules',
  'output',
  'playwright-report',
  'target',
  'template',
  'templates',
  'test-results',
  'vendor',
  'venv',
  'views',
  '模板',
])

const SYSTEM_FILENAMES = new Set([
  'agents.md',
  'changelog.md',
  'claude.md',
  'contributing.md',
  'license.md',
  'migration.md',
  'readme.md',
  'tolaria_workflow.md',
  'type.md',
])

const GENERIC_FOLDER_TAGS = new Set([
  'content',
  'docs',
  'documents',
  'markdown',
  'notes',
  'pages',
  'src',
  'vault',
])

const FRONTMATTER_DATE_KEYS = [
  'createdAt',
  'created_at',
  'created',
  'date',
  'publishedAt',
  'published_at',
  'published',
]

const options = parseArguments(process.argv.slice(2))

if (options.help) {
  printHelp()
  process.exit(0)
}

const discovered = await discoverSources(options)
if (discovered.scanRoots.length === 0) {
  throw new Error('没有找到可读取的 Tolaria 或 Obsidian vault')
}

await assertOutputOutsideSources(options.outputDir, discovered.scanRoots)
const migration = await migrateNotes(discovered)
const previewRecords = selectPreviewRecords(migration.records, options.previewLimit)
const preview = previewRecords.map((record) =>
  toOutputNote(record, options.previewContentLimit),
)
const full = migration.records.map((record) => toOutputNote(record))
const projectName =
  options.projectName ?? inferProjectName(discovered.logicalRoots)
const report = buildReport(
  discovered,
  migration,
  previewRecords,
  options,
  projectName,
)

await fs.mkdir(options.outputDir, { recursive: true })
await Promise.all([
  writeJsonAtomic(
    path.join(options.outputDir, 'tolaria-obsidian.full.json'),
    {
      name: projectName,
      generatedAt: report.generatedAt,
      notes: full,
    },
  ),
  writeJsonAtomic(
    path.join(options.outputDir, 'tolaria-obsidian.preview.json'),
    {
      name: projectName,
      generatedAt: report.generatedAt,
      notes: preview,
    },
  ),
  writeJsonAtomic(path.join(options.outputDir, 'migration-report.json'), report, 2),
])

console.log(
  [
    `候选 Markdown: ${report.scan.markdownCandidates}`,
    `唯一笔记: ${report.result.uniqueNotes}`,
    `精确重复已合并: ${report.result.exactDuplicatesRemoved}`,
    `预览笔记: ${report.result.previewNotes}`,
    `输出目录: ${options.outputDir}`,
  ].join('\n'),
)

async function discoverSources(cliOptions) {
  const tolAriaRoots = cliOptions.tolariaRoots.length
    ? cliOptions.tolariaRoots
    : await readTolariaRoots(cliOptions.tolariaConfig)
  const obsidianRoots = cliOptions.obsidianRoots.length
    ? cliOptions.obsidianRoots
    : await readObsidianRoots(cliOptions.obsidianConfig)

  const tolAriaLogicalRoots = await normalizeLogicalRoots(tolAriaRoots, 'tolaria')
  const obsidianLogicalRoots = await normalizeLogicalRoots(obsidianRoots, 'obsidian')
  const scanRoots = [
    ...collapseScanRoots(tolAriaLogicalRoots),
    ...collapseScanRoots(obsidianLogicalRoots),
  ]

  return {
    excludeDirectories: new Set(
      cliOptions.excludeDirectories.map((directory) =>
        directory.toLocaleLowerCase(),
      ),
    ),
    logicalRoots: [...tolAriaLogicalRoots, ...obsidianLogicalRoots],
    scanRoots,
  }
}

async function readTolariaRoots(configPath) {
  const config = await readJson(configPath)
  if (!config || typeof config !== 'object') return []
  const roots = []
  if (typeof config.active_vault === 'string') roots.push(config.active_vault)
  if (Array.isArray(config.vaults)) {
    for (const vault of config.vaults) {
      if (
        vault &&
        typeof vault === 'object' &&
        vault.mounted !== false &&
        typeof vault.path === 'string'
      ) {
        roots.push(vault.path)
      }
    }
  }
  return uniqueStrings(roots)
}

async function readObsidianRoots(configPath) {
  const config = await readJson(configPath)
  if (!config || typeof config !== 'object' || !config.vaults) return []
  return uniqueStrings(
    Object.values(config.vaults)
      .map((vault) =>
        vault && typeof vault === 'object' && typeof vault.path === 'string'
          ? vault.path
          : '',
      )
      .filter(Boolean),
  )
}

async function normalizeLogicalRoots(roots, kind) {
  const result = []
  for (const root of roots) {
    try {
      const absolutePath = await fs.realpath(path.resolve(expandHome(root)))
      const stat = await fs.stat(absolutePath)
      if (!stat.isDirectory()) continue
      result.push({
        kind,
        path: absolutePath,
        label: path.basename(absolutePath) || kind,
      })
    } catch {
      // Stale vault registrations are expected and are omitted.
    }
  }
  return dedupeRoots(result)
}

function collapseScanRoots(logicalRoots) {
  const sorted = [...logicalRoots].sort(
    (a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path),
  )
  const result = []
  for (const root of sorted) {
    if (result.some((parent) => isPathInside(root.path, parent.path))) continue
    result.push({ ...root, logicalRoots })
  }
  return result
}

async function migrateNotes(discoveredSources) {
  const records = []
  const byFingerprint = new Map()
  const byBodyFingerprint = new Map()
  const scan = {
    markdownCandidates: 0,
    parsedNotes: 0,
    malformedFrontmatter: 0,
    exactDuplicatesRemoved: 0,
    suspectedDuplicates: 0,
    skipped: {},
    readErrors: 0,
  }

  for (const scanRoot of discoveredSources.scanRoots) {
    const files = await collectMarkdownFiles(
      scanRoot.path,
      discoveredSources.excludeDirectories,
    )
    scan.markdownCandidates += files.length
    const results = await mapWithConcurrency(
      files,
      READ_CONCURRENCY,
      (filePath) => readNoteRecord(filePath, scanRoot),
    )
    for (const result of results) {
      if (!result.record) {
        increment(scan.skipped, result.reason ?? 'unknown')
        if (result.reason === 'read-error') scan.readErrors += 1
        if (result.malformedFrontmatter) scan.malformedFrontmatter += 1
        continue
      }

      if (result.malformedFrontmatter) scan.malformedFrontmatter += 1
      scan.parsedNotes += 1
      const existing = byFingerprint.get(result.record.fingerprint)
      if (existing) {
        existing.tags = uniqueStrings([...existing.tags, ...result.record.tags]).slice(0, 16)
        existing.duplicateCount += 1
        scan.exactDuplicatesRemoved += 1
        continue
      }

      const sameBody = byBodyFingerprint.get(result.record.bodyFingerprint)
      if (sameBody && sameBody.fingerprint !== result.record.fingerprint) {
        scan.suspectedDuplicates += 1
      } else if (!sameBody) {
        byBodyFingerprint.set(result.record.bodyFingerprint, result.record)
      }
      byFingerprint.set(result.record.fingerprint, result.record)
      records.push(result.record)
    }
    console.error(
      `已扫描 ${scanRoot.kind === 'tolaria' ? 'Tolaria' : 'Obsidian'} · ${scanRoot.label}: ${files.length} 个 Markdown`,
    )
  }

  records.sort(
    (a, b) =>
      Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id),
  )
  canonicalizeTags(records)
  return { records, scan }
}

async function collectMarkdownFiles(rootPath, excludedDirectories = new Set()) {
  const files = []
  const pending = [rootPath]
  while (pending.length) {
    const directory = pending.pop()
    let entries
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (!shouldIgnoreDirectory(entry.name, excludedDirectories)) {
          pending.push(entryPath)
        }
        continue
      }
      if (
        entry.isFile() &&
        /\.md(?:own)?$/i.test(entry.name) &&
        !SYSTEM_FILENAMES.has(entry.name.toLocaleLowerCase())
      ) {
        files.push(entryPath)
      }
    }
  }
  return files.sort((a, b) => a.localeCompare(b))
}

async function readNoteRecord(filePath, scanRoot) {
  let stat
  let raw
  try {
    stat = await fs.stat(filePath)
    if (stat.size === 0) return { reason: 'empty-file' }
    if (stat.size > MAX_FILE_BYTES) return { reason: 'oversized-file' }
    raw = await fs.readFile(filePath, 'utf8')
  } catch {
    return { reason: 'read-error' }
  }

  if (raw.includes('\0')) return { reason: 'binary-content' }
  const document = parseMarkdownDocument(raw)
  const frontmatter = document.frontmatter
  const typeValues = toScalarStrings(frontmatter.type).map((value) =>
    value.toLocaleLowerCase(),
  )
  if (typeValues.includes('type')) {
    return {
      reason: 'type-definition',
      malformedFrontmatter: document.malformedFrontmatter,
    }
  }
  if (typeValues.includes('template')) {
    return {
      reason: 'template-note',
      malformedFrontmatter: document.malformedFrontmatter,
    }
  }

  const content = normalizeLineEndings(document.body).trim()
  if (!content) {
    return {
      reason: 'empty-content',
      malformedFrontmatter: document.malformedFrontmatter,
    }
  }

  const logicalRoot = findDeepestLogicalRoot(
    filePath,
    scanRoot.logicalRoots ?? [scanRoot],
  )
  const relativePath = path.relative(logicalRoot.path, filePath)
  const title =
    firstScalar(frontmatter.title) ??
    extractFirstHeading(content) ??
    path.basename(filePath).replace(/\.md(?:own)?$/i, '')
  const normalizedBody = normalizeForFingerprint(content)
  const normalizedTitle = normalizeForFingerprint(title)
  const fingerprint = sha256(`${normalizedTitle}\n${normalizedBody}`)
  const bodyFingerprint = sha256(normalizedBody)
  const folderTags = extractFolderTags(relativePath)
  const tags = uniqueStrings([
    ...toScalarStrings(frontmatter.tags),
    ...toScalarStrings(frontmatter.keywords),
    ...meaningfulFrontmatterTags(frontmatter),
    ...extractInlineTags(content),
    ...folderTags,
  ])
    .map(normalizeTag)
    .filter(Boolean)
    .slice(0, 16)
  const effectiveTags = tags.length ? tags : [logicalRoot.label]
  const primaryTopic = folderTags[0] ?? effectiveTags[0] ?? logicalRoot.label

  return {
    malformedFrontmatter: document.malformedFrontmatter,
    record: {
      id: `note-${fingerprint.slice(0, 20)}`,
      fingerprint,
      bodyFingerprint,
      title: normalizeTitle(title),
      content,
      createdAt: resolveCreatedAt(frontmatter, stat),
      tags: effectiveTags,
      source: `${logicalRoot.kind === 'tolaria' ? 'Tolaria' : 'Obsidian'} · ${logicalRoot.label}`,
      weight: noteWeight(content.length),
      sourceKind: logicalRoot.kind,
      sourceLabel: logicalRoot.label,
      primaryTopic,
      duplicateCount: 1,
    },
  }
}

function parseMarkdownDocument(raw) {
  const text = raw.replace(/^\uFEFF/, '')
  if (!/^---\r?\n/.test(text)) {
    return { frontmatter: {}, body: text, malformedFrontmatter: false }
  }
  const lines = text.split(/\r?\n/)
  let closingLine = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---' || lines[index] === '...') {
      closingLine = index
      break
    }
  }
  if (closingLine < 0) {
    return { frontmatter: {}, body: text, malformedFrontmatter: true }
  }
  try {
    const parsed = parseYaml(lines.slice(1, closingLine).join('\n'))
    return {
      frontmatter: parsed && typeof parsed === 'object' ? parsed : {},
      body: lines.slice(closingLine + 1).join('\n'),
      malformedFrontmatter: false,
    }
  } catch {
    return { frontmatter: {}, body: text, malformedFrontmatter: true }
  }
}

function meaningfulFrontmatterTags(frontmatter) {
  const type = toScalarStrings(frontmatter.type).filter(
    (value) => !['note', 'type', 'template'].includes(value.toLocaleLowerCase()),
  )
  const category = toScalarStrings(frontmatter.category).filter(
    (value) => value.toLocaleLowerCase() !== 'system',
  )
  return [...type, ...category]
}

function extractInlineTags(content) {
  const searchable = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
  const tags = []
  for (const match of searchable.matchAll(
    /(?:^|[^\p{L}\p{N}_])#([\p{L}\p{N}_/-]{2,48})/gu,
  )) {
    tags.push(match[1])
    if (tags.length >= 10) break
  }
  return tags
}

function extractFolderTags(relativePath) {
  const directory = path.dirname(relativePath)
  if (directory === '.') return []
  return directory
    .split(path.sep)
    .filter(
      (segment) =>
        segment &&
        !segment.startsWith('.') &&
        !GENERIC_FOLDER_TAGS.has(segment.toLocaleLowerCase()),
    )
    .slice(-2)
    .reverse()
}

function resolveCreatedAt(frontmatter, stat) {
  for (const key of FRONTMATTER_DATE_KEYS) {
    const timestamp = parseTimestamp(frontmatter[key])
    if (timestamp !== null) return new Date(timestamp).toISOString()
  }
  const candidates = [stat.birthtimeMs, stat.mtimeMs].filter(
    (value) => Number.isFinite(value) && value > 0,
  )
  return new Date(Math.min(...candidates)).toISOString()
}

function parseTimestamp(value) {
  const scalar = value instanceof Date ? value.toISOString() : firstScalar(value)
  if (!scalar) return null
  const timestamp = Date.parse(scalar)
  if (!Number.isFinite(timestamp)) return null
  const upperBound = Date.now() + 24 * 60 * 60 * 1000
  return timestamp >= Date.UTC(1900, 0, 1) && timestamp <= upperBound
    ? timestamp
    : null
}

function selectPreviewRecords(records, limit) {
  if (records.length <= limit) return [...records]

  const selected = []
  const selectedIds = new Set()
  const tolAriaRecords = records.filter((record) => record.sourceKind === 'tolaria')
  const tolAriaLimit = Math.min(tolAriaRecords.length, Math.floor(limit * 0.35))
  for (const record of deterministicOrder(tolAriaRecords).slice(0, tolAriaLimit)) {
    selected.push(record)
    selectedIds.add(record.id)
  }

  const groups = new Map()
  for (const record of records) {
    if (selectedIds.has(record.id)) continue
    const key = `${record.sourceLabel}\0${record.primaryTopic}`
    const group = groups.get(key) ?? { key, records: [], cursor: 0 }
    group.records.push(record)
    groups.set(key, group)
  }

  const orderedGroups = [...groups.values()]
    .map((group) => ({ ...group, records: deterministicOrder(group.records) }))
    .sort((a, b) => a.key.localeCompare(b.key))
  let remaining = limit - selected.length

  for (const group of orderedGroups) {
    if (remaining <= 0) break
    const record = group.records[group.cursor]
    if (!record) continue
    selected.push(record)
    selectedIds.add(record.id)
    group.cursor += 1
    remaining -= 1
  }

  while (remaining > 0) {
    const available = orderedGroups.filter(
      (group) => group.cursor < group.records.length,
    )
    if (!available.length) break
    available.sort((a, b) => {
      const aPriority = a.records.length / (a.cursor + 1)
      const bPriority = b.records.length / (b.cursor + 1)
      return bPriority - aPriority || a.key.localeCompare(b.key)
    })
    const group = available[0]
    const record = group.records[group.cursor]
    selected.push(record)
    selectedIds.add(record.id)
    group.cursor += 1
    remaining -= 1
  }

  return selected.sort(
    (a, b) =>
      Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id),
  )
}

function deterministicOrder(records) {
  return [...records].sort(
    (a, b) =>
      sha256(`preview:${a.id}`).localeCompare(sha256(`preview:${b.id}`)) ||
      a.id.localeCompare(b.id),
  )
}

function toOutputNote(record, contentLimit = Number.POSITIVE_INFINITY) {
  const truncated = record.content.length > contentLimit
  const content = truncated
    ? `${record.content.slice(0, contentLimit).trimEnd()}\n\n[预览数据已截断，完整正文保留在全量迁移文件中]`
    : record.content
  return {
    id: record.id,
    title: record.title,
    content,
    createdAt: record.createdAt,
    tags: record.tags,
    source: record.source,
    weight: record.weight,
  }
}

function buildReport(
  discoveredSources,
  migration,
  previewRecords,
  cliOptions,
  projectName,
) {
  const sourceCounts = countBy(migration.records, (record) => record.source)
  const previewSourceCounts = countBy(previewRecords, (record) => record.source)
  const tagCounts = countNested(migration.records, (record) => record.tags)
  const timestamps = migration.records
    .map((record) => Date.parse(record.createdAt))
    .filter(Number.isFinite)
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputs: discoveredSources.logicalRoots.map((root) => ({
      kind: root.kind,
      label: root.label,
      path: root.path,
    })),
    settings: {
      projectName,
      previewLimit: cliOptions.previewLimit,
      previewContentLimit: cliOptions.previewContentLimit,
      maximumFileBytes: MAX_FILE_BYTES,
    },
    scan: {
      markdownCandidates: migration.scan.markdownCandidates,
      parsedNotes: migration.scan.parsedNotes,
      malformedFrontmatter: migration.scan.malformedFrontmatter,
      readErrors: migration.scan.readErrors,
      skipped: sortObject(migration.scan.skipped),
    },
    result: {
      uniqueNotes: migration.records.length,
      previewNotes: previewRecords.length,
      exactDuplicatesRemoved: migration.scan.exactDuplicatesRemoved,
      suspectedDuplicatesKept: migration.scan.suspectedDuplicates,
      previewTruncatedNotes: previewRecords.filter(
        (record) => record.content.length > cliOptions.previewContentLimit,
      ).length,
      dateRange: timestamps.length
        ? {
            first: new Date(Math.min(...timestamps)).toISOString(),
            last: new Date(Math.max(...timestamps)).toISOString(),
          }
        : null,
    },
    sources: sortObject(sourceCounts),
    previewSources: sortObject(previewSourceCounts),
    topTags: Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 30)
      .map(([tag, count]) => ({ tag, count })),
  }
}

async function assertOutputOutsideSources(outputDir, scanRoots) {
  const absoluteOutput = path.resolve(outputDir)
  for (const root of scanRoots) {
    if (isPathInside(absoluteOutput, root.path)) {
      throw new Error(`输出目录不能位于源 vault 内：${absoluteOutput}`)
    }
  }
}

function findDeepestLogicalRoot(filePath, logicalRoots) {
  return (
    logicalRoots
      .filter((root) => isPathInside(filePath, root.path))
      .sort((a, b) => b.path.length - a.path.length)[0] ?? logicalRoots[0]
  )
}

function dedupeRoots(roots) {
  const seen = new Set()
  return roots.filter((root) => {
    const key = `${root.kind}\0${root.path}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function shouldIgnoreDirectory(name, excludedDirectories = new Set()) {
  const normalized = name.toLocaleLowerCase()
  return (
    name.startsWith('.') ||
    IGNORED_DIRECTORIES.has(normalized) ||
    excludedDirectories.has(normalized)
  )
}

function normalizeTag(value) {
  const normalized = String(value)
    .replace(/^\s*#/, '')
    .replace(/^\[\[|\]\]$/g, '')
    .replace(/\|.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48)
  if (/^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(normalized)) return ''
  if (['note', 'notes'].includes(normalized.toLocaleLowerCase())) return ''
  return normalized
}

function normalizeTitle(value) {
  return String(value)
    .replace(/^\s*#+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}

function extractFirstHeading(content) {
  return content.match(/^#\s+(.+?)\s*$/m)?.[1]
}

function normalizeLineEndings(value) {
  return value.replace(/\r\n?/g, '\n')
}

function normalizeForFingerprint(value) {
  return normalizeLineEndings(String(value))
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase()
}

function toScalarStrings(value) {
  if (Array.isArray(value)) return value.flatMap(toScalarStrings)
  if (typeof value === 'string') {
    return value
      .split(/[,;\n]/)
      .map((part) => part.trim())
      .filter(Boolean)
  }
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (value instanceof Date) return [value.toISOString()]
  return []
}

function firstScalar(value) {
  return toScalarStrings(value)[0]
}

function noteWeight(contentLength) {
  const weight =
    0.75 + Math.min(0.85, Math.log2(1 + contentLength / 700) * 0.18)
  return Number(weight.toFixed(2))
}

function countBy(records, keyOf) {
  const counts = {}
  for (const record of records) increment(counts, keyOf(record))
  return counts
}

function countNested(records, valuesOf) {
  const counts = {}
  for (const record of records) {
    for (const value of valuesOf(record)) increment(counts, value)
  }
  return counts
}

function increment(record, key) {
  record[key] = (record[key] ?? 0) + 1
}

function sortObject(record) {
  return Object.fromEntries(
    Object.entries(record).sort((a, b) => a[0].localeCompare(b[0])),
  )
}

function uniqueStrings(values) {
  const result = []
  const seen = new Set()
  for (const value of values) {
    const normalized = String(value).trim()
    const key = normalized.toLocaleLowerCase()
    if (!normalized || seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }
  return result
}

function canonicalizeTags(records) {
  const variants = new Map()
  for (const record of records) {
    for (const tag of record.tags) {
      const key = canonicalTagKey(tag)
      const counts = variants.get(key) ?? new Map()
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
      variants.set(key, counts)
    }
  }
  const canonical = new Map(
    [...variants.entries()].map(([key, counts]) => [
      key,
      [...counts.entries()].sort(
        (a, b) =>
          b[1] - a[1] ||
          tagPresentationScore(b[0]) - tagPresentationScore(a[0]) ||
          a[0].localeCompare(b[0]),
      )[0][0],
    ]),
  )
  for (const record of records) {
    record.tags = uniqueStrings(
      record.tags.map((tag) => canonical.get(canonicalTagKey(tag)) ?? tag),
    ).slice(0, 16)
  }
}

function canonicalTagKey(tag) {
  return tag
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s_-]+/g, '')
}

function tagPresentationScore(tag) {
  let score = 0
  if (/^[A-Z0-9]{2,6}$/.test(tag)) score += 3
  if (/[A-Z]/.test(tag) && /[a-z]/.test(tag)) score += 2
  if (tag.includes(' ')) score += 1
  return score
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function isPathInside(candidate, parent) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function expandHome(value) {
  if (value === '~') return os.homedir()
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value
}

function inferProjectName(logicalRoots) {
  const labels = uniqueStrings(logicalRoots.map((root) => root.label))
  return labels.length === 1
    ? `${labels[0]} 知识地形`
    : 'Tolaria + Obsidian 知识地形'
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(expandHome(filePath), 'utf8'))
  } catch {
    return null
  }
}

async function writeJsonAtomic(filePath, value, indentation = 0) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, indentation)}\n`, {
    mode: 0o600,
  })
  await fs.rename(temporaryPath, filePath)
}

async function mapWithConcurrency(values, concurrency, worker) {
  const results = new Array(values.length)
  let cursor = 0
  const runners = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor
        cursor += 1
        results[index] = await worker(values[index])
      }
    },
  )
  await Promise.all(runners)
  return results
}

function parseArguments(args) {
  const parsed = {
    help: false,
    excludeDirectories: [],
    obsidianConfig: DEFAULT_OBSIDIAN_CONFIG,
    obsidianRoots: [],
    tolariaConfig: DEFAULT_TOLARIA_CONFIG,
    tolariaRoots: [],
    outputDir: DEFAULT_OUTPUT_DIR,
    previewLimit: DEFAULT_PREVIEW_LIMIT,
    previewContentLimit: DEFAULT_PREVIEW_CONTENT_LIMIT,
    projectName: null,
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    const value = args[index + 1]
    if (argument === '--help' || argument === '-h') {
      parsed.help = true
      continue
    }
    if (!value || value.startsWith('--')) {
      throw new Error(`参数缺少值：${argument}`)
    }
    if (argument === '--obsidian-config') parsed.obsidianConfig = value
    else if (argument === '--exclude-dir') parsed.excludeDirectories.push(value)
    else if (argument === '--obsidian-root') parsed.obsidianRoots.push(value)
    else if (argument === '--tolaria-config') parsed.tolariaConfig = value
    else if (argument === '--tolaria-root') parsed.tolariaRoots.push(value)
    else if (argument === '--output') parsed.outputDir = path.resolve(value)
    else if (argument === '--project-name') parsed.projectName = value.trim()
    else if (argument === '--preview-limit') parsed.previewLimit = positiveInteger(value, argument)
    else if (argument === '--preview-content-limit') {
      parsed.previewContentLimit = positiveInteger(value, argument)
    } else {
      throw new Error(`未知参数：${argument}`)
    }
    index += 1
  }
  return parsed
}

function positiveInteger(value, argument) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${argument} 必须是正整数`)
  }
  return parsed
}

function printHelp() {
  console.log(`Usage: npm run migrate:local-notes -- [options]

Options:
  --tolaria-root PATH          Add a Tolaria vault root (repeatable)
  --obsidian-root PATH         Add an Obsidian vault root (repeatable)
  --exclude-dir NAME           Ignore a directory name (repeatable)
  --tolaria-config PATH        Tolaria vaults.json path
  --obsidian-config PATH       Obsidian obsidian.json path
  --output PATH                Output directory (default: output/migration)
  --project-name NAME          Project name embedded in generated JSON
  --preview-limit NUMBER       Maximum preview notes (default: 2200)
  --preview-content-limit N    Maximum characters per preview note (default: 50000)
  --help                       Show this help
`)
}
