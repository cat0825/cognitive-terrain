import Papa from 'papaparse'
import { parse as parseYaml } from 'yaml'
import type { ImportIssue, ImportLimitViolation, NoteInput, NoteStatus, ParsedImport } from '../domain/types'
import {
  buildImportPreflight,
  contentLengthViolation,
  DEFAULT_IMPORT_LIMITS,
  ImportLimitError,
  importLimits,
  type ImportLimits,
  type ImportTaxonomyContext,
  validateImportSelection,
} from './import-limits'
import { parseObsidianCognitiveFields } from './obsidian-frontmatter'

export async function parseImportFile(
  file: File,
  options: { signal?: AbortSignal; limits?: ImportLimits } = {},
): Promise<ParsedImport> {
  throwIfAborted(options.signal)
  const limits = options.limits ?? DEFAULT_IMPORT_LIMITS
  if (file.size > limits.maxFileBytes) {
    throw new ImportLimitError([{
      code: 'file-bytes',
      file: file.name,
      actual: file.size,
      allowed: limits.maxFileBytes,
      message: `${file.name} 超出单文件大小上限：实际 ${formatBytes(file.size)}，允许 ${formatBytes(limits.maxFileBytes)}`,
    }])
  }
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? ''
  const text = await file.text()
  throwIfAborted(options.signal)
  if (extension === 'csv' || extension === 'tsv') {
    return parseDelimited(text, file.name, extension === 'tsv' ? '\t' : undefined, limits)
  }
  if (extension === 'json') return parseStructured(text, file.name, 'json', limits)
  if (extension === 'yaml' || extension === 'yml') return parseStructured(text, file.name, 'yaml', limits)
  return parseTextDocument(text, file.name, file.lastModified || Date.now(), vaultLocation(file), undefined, limits)
}

/**
 * 目录导入时浏览器会填 webkitRelativePath，首段即 vault 根目录名。
 * 单文件导入拿不到 vault，只能退回文件名。
 */
export function vaultLocation(file: Pick<File, 'name'> & { webkitRelativePath?: string }): { vault?: string; path: string } {
  const relative = file.webkitRelativePath?.replace(/\\/g, '/').replace(/^\.?\//, '') ?? ''
  const segments = relative.split('/').filter(Boolean)
  if (segments.length < 2) return { path: file.name }
  return { vault: segments[0], path: segments.slice(1).join('/') }
}

export async function parseImportFiles(
  files: File[],
  options: {
    signal?: AbortSignal
    limits?: Partial<ImportLimits>
    taxonomy?: ImportTaxonomyContext
    now?: number
  } = {},
): Promise<ParsedImport> {
  const limits = importLimits(options.limits)
  validateImportSelection(files, limits)
  const notes: NoteInput[] = []
  const issues: ImportIssue[] = []
  const contentViolations: ImportLimitViolation[] = []
  const sampleLimit = limits.maxRecords + 1
  const issueDetailLimit = limits.maxRecords + limits.maxFiles
  let issueCount = 0
  let recordCount = 0
  let singleFileName = '未命名项目'

  // Parse one bounded batch at a time. Results inside each batch run in
  // parallel, then merge in picker order so the retained pre-flight sample is
  // deterministic. Crucially, later files contribute only counts after the
  // global sample is full instead of each retaining maxRecords + 1 objects.
  for (let offset = 0; offset < files.length; offset += limits.parseConcurrency) {
    throwIfAborted(options.signal)
    const batch = await Promise.all(
      files.slice(offset, offset + limits.parseConcurrency).map(async (file) => {
        const result = await parseImportFile(file, { signal: options.signal, limits })
        await yieldToBrowser()
        return result
      }),
    )
    throwIfAborted(options.signal)
    for (const result of batch) {
      if (offset === 0 && result === batch[0]) singleFileName = result.name
      recordCount += result.recordCount ?? result.notes.length
      issueCount += result.issueCount ?? result.issues.length

      const remainingNotes = Math.max(0, sampleLimit - notes.length)
      if (remainingNotes > 0) {
        notes.push(...result.notes.slice(0, remainingNotes))
      }
      const remainingViolations = Math.max(0, issueDetailLimit - contentViolations.length)
      if (remainingViolations > 0) contentViolations.push(...(result.limitViolations ?? []).slice(0, remainingViolations))

      const remainingIssues = Math.max(0, issueDetailLimit - issues.length)
      if (remainingIssues > 0) issues.push(...result.issues.slice(0, remainingIssues))
    }
  }
  const name = files.length === 1 ? singleFileName : `${files.length} 个文件导入`
  const preflight = buildImportPreflight({
    files,
    notes,
    issues,
    recordCount,
    contentViolations,
    limits,
    taxonomy: options.taxonomy,
    now: options.now,
  })
  return { notes, issues, issueCount, name, recordCount, limitViolations: contentViolations, preflight }
}

export function normalizeNoteInputs(
  values: unknown[],
  fileName = 'import',
  limits = DEFAULT_IMPORT_LIMITS,
): { notes: NoteInput[]; issues: ImportIssue[]; limitViolations: ReturnType<typeof contentLengthViolation>[] } {
  const notes: NoteInput[] = []
  const issues: ImportIssue[] = []
  const limitViolations: ReturnType<typeof contentLengthViolation>[] = []
  for (const [index, value] of values.entries()) {
    const result = normalizeNote(value)
    if (result.note) {
      notes.push(result.note)
      if (result.note.content.length > limits.maxContentChars) {
        const violation = contentLengthViolation(fileName, index + 1, result.note.content.length, limits.maxContentChars)
        limitViolations.push(violation)
        issues.push(violation)
      }
    }
    if (result.issue) issues.push({ ...result.issue, file: fileName, row: index + 1 })
  }
  return { notes, issues, limitViolations }
}

function parseDelimited(text: string, fileName: string, delimiter?: string, limits = DEFAULT_IMPORT_LIMITS): ParsedImport {
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    delimiter,
  })
  const normalized = normalizeNoteInputs(result.data.slice(0, limits.maxRecords + 1), fileName, limits)
  for (const error of result.errors) {
    normalized.issues.push({
      file: fileName,
      row: typeof error.row === 'number' ? error.row + 1 : undefined,
      message: error.message,
    })
  }
  return { ...normalized, name: fileName.replace(/\.[^.]+$/, ''), recordCount: result.data.length }
}

function parseStructured(text: string, fileName: string, format: 'json' | 'yaml', limits = DEFAULT_IMPORT_LIMITS): ParsedImport {
  try {
    const parsed: unknown = format === 'json' ? JSON.parse(text) : parseYaml(text)
    const values = extractRecords(parsed)
    const normalized = normalizeNoteInputs(values.slice(0, limits.maxRecords + 1), fileName, limits)
    const embeddedName =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? stringValue((parsed as Record<string, unknown>).name)
        : undefined
    return {
      ...normalized,
      name: embeddedName ?? fileName.replace(/\.[^.]+$/, ''),
      recordCount: values.length,
    }
  } catch (error) {
    return {
      notes: [],
      issues: [{ file: fileName, message: `无法解析${format.toUpperCase()}：${errorMessage(error)}` }],
      name: fileName,
      recordCount: 0,
    }
  }
}

export function parseTextDocument(
  text: string,
  fileName: string,
  modifiedAt: number,
  location: { vault?: string; path: string } = { path: fileName },
  fallbackCreatedAt?: string,
  limits = DEFAULT_IMPORT_LIMITS,
): ParsedImport {
  const { frontmatter, body, issue: frontmatterIssue } = splitFrontmatter(text)
  const cognitive = parseObsidianCognitiveFields(frontmatter)
  const title = stringValue(frontmatter.title) ?? fileName.replace(/\.[^.]+$/, '')
  const requestedCreatedAt = stringValue(frontmatter.createdAt) ?? fallbackCreatedAt
  const createdAtMs = requestedCreatedAt ? Date.parse(requestedCreatedAt) : modifiedAt
  const createdAt = Number.isFinite(createdAtMs) ? new Date(createdAtMs).toISOString() : new Date(modifiedAt).toISOString()
  const tags = normalizeTags(frontmatter.tags)
  const content = body.trim() || text.trim()
  const limitViolations = content.length > limits.maxContentChars
    ? [contentLengthViolation(fileName, 1, content.length, limits.maxContentChars)]
    : []
  const issues: ImportIssue[] = [
    ...(frontmatterIssue ? [{ file: fileName, message: frontmatterIssue }] : []),
    ...cognitive.issues.map((item) => ({ file: fileName, field: item.field, message: item.message })),
    ...(requestedCreatedAt && !Number.isFinite(createdAtMs)
      ? [{ file: fileName, field: 'createdAt', message: `日期无效：${requestedCreatedAt}` }]
      : []),
    ...limitViolations,
  ]
  if (!content) issues.push({ file: fileName, message: '文件内容为空' })
  return {
    notes: [{
      sourceKey: stringValue(frontmatter.id) ?? stringValue(frontmatter.uid),
      title,
      content,
      createdAt,
      tags,
      source: fileName,
      sourcePath: stringValue(frontmatter.sourcePath) ?? location.path,
      vault: stringValue(frontmatter.vault) ?? location.vault,
      mastery: cognitive.fields.mastery,
      confidence: cognitive.fields.confidence,
      exploration: cognitive.fields.exploration,
      status: cognitive.fields.status,
      area: cognitive.fields.area,
      areas: cognitive.fields.areas,
      declaredAreas: cognitive.fields.declaredAreas,
      reviewedAt: cognitive.fields.reviewedAt,
      cognitiveStateProvenance: Object.keys(cognitive.fields).length ? 'yaml' : undefined,
      links: [...new Set([...parseWikiLinks(content), ...normalizeLinks(frontmatter.links)])],
      prerequisites: cognitive.fields.prerequisites,
    }],
    issues,
    name: title,
    recordCount: 1,
    limitViolations,
  }
}

function extractRecords(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['notes', 'items', 'data', 'entries', 'records']) {
      if (Array.isArray(record[key])) return record[key]
    }
    return [value]
  }
  return []
}

function normalizeNote(value: unknown): { note?: NoteInput; issue?: Omit<ImportIssue, 'file' | 'row'> } {
  if (typeof value === 'string') {
    return {
      note: {
        content: value,
        title: value.slice(0, 48),
        createdAt: new Date().toISOString(),
      },
    }
  }
  if (!value || typeof value !== 'object') return { issue: { message: '记录不是对象或文本' } }
  const record = value as Record<string, unknown>
  const content = stringValue(record.content) ?? stringValue(record.body) ?? stringValue(record.text) ?? stringValue(record.description)
  if (!content?.trim()) return { issue: { field: 'content', message: '缺少内容字段' } }
  const createdAt =
    stringValue(record.createdAt) ??
    stringValue(record.created_at) ??
    stringValue(record.date) ??
    stringValue(record.time) ??
    new Date().toISOString()
  if (Number.isNaN(Date.parse(createdAt))) return { issue: { field: 'createdAt', message: `日期无效：${createdAt}` } }
  return {
    note: {
      id: stringValue(record.id),
      sourceId: stringValue(record.sourceId) ?? stringValue(record.source_id),
      sourceKey: stringValue(record.sourceKey) ?? stringValue(record.source_key) ?? stringValue(record.uid),
      title: stringValue(record.title) ?? stringValue(record.name) ?? content.slice(0, 48),
      content: content.trim(),
      createdAt: new Date(createdAt).toISOString(),
      tags: normalizeTags(record.tags),
      source: stringValue(record.source) ?? stringValue(record.url),
      sourcePath: stringValue(record.sourcePath) ?? stringValue(record.source_path) ?? stringValue(record.path),
      vault: stringValue(record.vault),
      weight: numberValue(record.weight) ?? 1,
      mastery: numberValue(record.mastery),
      confidence: numberValue(record.confidence),
      exploration: numberValue(record.exploration),
      status: statusValue(record.status),
      area: stringValue(record.area) ?? stringArray(record.area)?.[0] ?? stringArray(record.areas)?.[0],
      areas: mergeStringArrays(stringArray(record.area), stringArray(record.areas)),
      declaredAreas: mergeStringArrays(
        typeof record.area === 'string' && record.area.trim() ? [record.area] : declaredStringArray(record.area),
        declaredStringArray(record.areas),
      ),
      reviewedAt: stringValue(record.reviewedAt) ?? stringValue(record.reviewed_at),
      links: [...new Set([...parseWikiLinks(content), ...normalizeLinks(record.links)])],
      prerequisites: normalizePrerequisites(record),
    },
  }
}

function splitFrontmatter(text: string): { frontmatter: Record<string, unknown>; body: string; issue?: string } {
  if (!text.startsWith('---')) return { frontmatter: {}, body: text }
  const end = text.indexOf('\n---', 3)
  if (end < 0) return { frontmatter: {}, body: text, issue: 'YAML frontmatter 未闭合' }
  try {
    const frontmatter = parseYaml(text.slice(3, end)) as Record<string, unknown>
    return { frontmatter: frontmatter && typeof frontmatter === 'object' ? frontmatter : {}, body: text.slice(end + 4) }
  } catch (error) {
    return {
      frontmatter: {},
      body: text.slice(end + 4),
      issue: `YAML frontmatter 无法解析：${errorMessage(error)}`,
    }
  }
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
  return values.length ? values : undefined
}

function declaredStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value.flatMap((item) => typeof item === 'string' && item.trim() ? [item] : [])
  return values.length ? values : undefined
}

function mergeStringArrays(...values: Array<string[] | undefined>): string[] | undefined {
  const merged = [...new Set(values.flatMap((value) => value ?? []))]
  return merged.length ? merged : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeTags(value: unknown): string[] | string | undefined {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  return stringValue(value)
}

function normalizeLinks(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => typeof item === 'string' ? [item.trim()] : []).filter(Boolean)
  return typeof value === 'string'
    ? value.split(/[\n,|]+/).map((item) => item.trim()).filter(Boolean)
    : []
}

function normalizePrerequisites(record: Record<string, unknown>): NoteInput['prerequisites'] {
  return ([
    ['prerequisites', record.prerequisites],
    ['buildsOn', record.buildsOn ?? record.builds_on ?? record['builds-on']],
  ] as const).flatMap(([sourceField, value]) => normalizeLinks(value).map((target) => ({
    target,
    provenance: 'yaml' as const,
    sourceField,
  })))
}

export function parseWikiLinks(value: string): string[] {
  return [...value.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)]
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean)
}

function statusValue(value: unknown): NoteStatus | undefined {
  return value === 'seed' || value === 'growing' || value === 'stable' || value === 'gap' || value === 'archived'
    ? value
    : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw new DOMException('导入已取消', 'AbortError')
}

async function yieldToBrowser(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}
