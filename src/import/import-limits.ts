import type {
  ImportIssue,
  ImportLimitViolation,
  ImportPreflightReport,
  NoteInput,
  ParsedImport,
  TaxonomyNode,
} from '../domain/types'
import { unresolvedTaxonomyAliases } from '../domain/taxonomy'

export interface ImportLimits {
  maxFileBytes: number
  maxProjectBundleBytes: number
  maxFiles: number
  maxTotalBytes: number
  maxRecords: number
  maxContentChars: number
  parseConcurrency: number
}

export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  maxFileBytes: 4 * 1024 * 1024,
  maxProjectBundleBytes: 64 * 1024 * 1024,
  maxFiles: 500,
  maxTotalBytes: 32 * 1024 * 1024,
  maxRecords: 2_000,
  maxContentChars: 64 * 1024,
  parseConcurrency: 4,
}

export interface ImportTaxonomyContext {
  workspaceId: string
  nodes: readonly TaxonomyNode[]
}

export class ImportLimitError extends Error {
  readonly issues: ImportLimitViolation[]

  constructor(issues: ImportLimitViolation[]) {
    super(issues.map((issue) => issue.message).join('\n'))
    this.name = 'ImportLimitError'
    this.issues = issues
  }
}

export function importLimits(overrides: Partial<ImportLimits> = {}): ImportLimits {
  const limits = { ...DEFAULT_IMPORT_LIMITS, ...overrides }
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`导入限制 ${key} 必须是正整数`)
  }
  return limits
}

export function validateImportSelection(files: readonly File[], limits: ImportLimits): void {
  const issues: ImportLimitViolation[] = []
  if (files.length > limits.maxFiles) {
    issues.push(limitIssue('file-count', '所选文件', files.length, limits.maxFiles, '个文件'))
  }
  for (const file of files) {
    if (file.size > limits.maxFileBytes) {
      issues.push(limitIssue('file-bytes', file.name, file.size, limits.maxFileBytes, 'bytes'))
    }
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  if (totalBytes > limits.maxTotalBytes) {
    issues.push(limitIssue('total-bytes', '所选批次', totalBytes, limits.maxTotalBytes, 'bytes'))
  }
  if (issues.length) throw new ImportLimitError(issues)
}

export function validateProjectBundleSelection(file: File, limits = DEFAULT_IMPORT_LIMITS): void {
  if (file.size <= limits.maxProjectBundleBytes) return
  throw new ImportLimitError([
    limitIssue('file-bytes', file.name, file.size, limits.maxProjectBundleBytes, 'bytes'),
  ])
}

export function duplicateNoteInputIds(notes: readonly NoteInput[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const note of notes) {
    const id = note.id?.trim()
    if (!id) continue
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
  }
  return [...duplicates].sort()
}

export function buildImportPreflight(input: {
  files: readonly File[]
  notes: readonly NoteInput[]
  issues: readonly ImportIssue[]
  recordCount: number
  contentViolations: ImportLimitViolation[]
  limits: ImportLimits
  taxonomy?: ImportTaxonomyContext
  now?: number
}): ImportPreflightReport {
  const now = input.now ?? Date.now()
  const duplicateIds = duplicateNoteInputIds(input.notes)
  const blockingIssues = [...input.contentViolations]
  if (input.recordCount > input.limits.maxRecords) {
    blockingIssues.push(limitIssue('record-count', '导入批次', input.recordCount, input.limits.maxRecords, '条记录'))
  }
  for (const id of duplicateIds) {
    blockingIssues.push({
      code: 'duplicate-id',
      file: '导入批次',
      field: 'id',
      actual: input.notes.filter((note) => note.id?.trim() === id).length,
      allowed: 1,
      message: `重复笔记 ID「${id}」出现 ${input.notes.filter((note) => note.id?.trim() === id).length} 次；每个 ID 只允许 1 次`,
    })
  }
  const labels = input.notes.flatMap(declaredAreas)
  const unknownTaxonomyLabels = input.taxonomy
    ? unresolvedTaxonomyAliases(labels, input.taxonomy.nodes, input.taxonomy.workspaceId)
    : []
  const totalContentChars = input.notes.reduce((sum, note) => sum + note.content.length, 0)
  return {
    fileCount: input.files.length,
    totalBytes: input.files.reduce((sum, file) => sum + file.size, 0),
    recordCount: input.recordCount,
    noteCount: input.notes.length,
    totalContentChars,
    duplicateIds,
    invalidTimestampCount: input.issues.filter((issue) => issue.field === 'createdAt').length,
    futureTimestampCount: input.notes.filter((note) => Date.parse(note.createdAt) > now).length,
    unknownTaxonomyLabels,
    estimatedSeconds: estimateAnalysisSeconds(input.notes.length, totalContentChars),
    blockingIssues,
  }
}

export function trimImportToLimits(parsed: ParsedImport, limits = DEFAULT_IMPORT_LIMITS): ParsedImport {
  const seen = new Set<string>()
  let duplicateIds = 0
  let contentChars = 0
  const deduped = parsed.notes.flatMap((note) => {
    const id = note.id?.trim()
    if (id && seen.has(id)) {
      duplicateIds += 1
      return []
    }
    if (id) seen.add(id)
    const content = note.content.slice(0, limits.maxContentChars)
    contentChars += note.content.length - content.length
    return [{ ...note, content }]
  })
  const notes = deduped.slice(0, limits.maxRecords)
  const records = Math.max(0, (parsed.preflight?.recordCount ?? parsed.recordCount ?? deduped.length) - notes.length)
  const preflight = parsed.preflight
    ? {
        ...parsed.preflight,
        noteCount: notes.length,
        recordCount: notes.length,
        totalContentChars: notes.reduce((sum, note) => sum + note.content.length, 0),
        duplicateIds: [],
        blockingIssues: [],
        estimatedSeconds: estimateAnalysisSeconds(notes.length, notes.reduce((sum, note) => sum + note.content.length, 0)),
        trimmed: { records, duplicateIds, contentChars },
      }
    : undefined
  const blockedKeys = new Set((parsed.limitViolations ?? []).map((issue) => `${issue.file}\n${issue.row ?? ''}\n${issue.message}`))
  const issues = parsed.issues.filter((issue) => !blockedKeys.has(`${issue.file}\n${issue.row ?? ''}\n${issue.message}`))
  return { ...parsed, notes, issues, issueCount: issues.length, recordCount: notes.length, limitViolations: [], preflight }
}

function declaredAreas(note: NoteInput): string[] {
  return note.declaredAreas ?? note.areas ?? (note.area ? [note.area] : [])
}

function estimateAnalysisSeconds(noteCount: number, contentChars: number): ImportPreflightReport['estimatedSeconds'] {
  const textUnits = Math.ceil(contentChars / 50_000)
  return {
    deterministic: Math.max(1, Math.ceil(noteCount / 250) + textUnits),
    semantic: Math.max(5, Math.ceil(noteCount / 25) + textUnits * 2),
  }
}

function limitIssue(
  code: ImportLimitViolation['code'],
  file: string,
  actual: number,
  allowed: number,
  unit: string,
  row?: number,
): ImportLimitViolation {
  return {
    code,
    file,
    row,
    actual,
    allowed,
    message: `${file} 超出${limitLabel(code)}：实际 ${formatNumber(actual)} ${unit}，允许 ${formatNumber(allowed)} ${unit}`,
  }
}

function limitLabel(code: ImportLimitViolation['code']): string {
  if (code === 'file-count') return '文件数上限'
  if (code === 'file-bytes') return '单文件大小上限'
  if (code === 'total-bytes') return '批次总大小上限'
  if (code === 'record-count') return '记录数上限'
  if (code === 'content-length') return '单条正文长度上限'
  return '唯一 ID 限制'
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value)
}

export function contentLengthViolation(file: string, row: number, actual: number, allowed: number): ImportLimitViolation {
  return limitIssue('content-length', file, actual, allowed, '字符', row)
}
