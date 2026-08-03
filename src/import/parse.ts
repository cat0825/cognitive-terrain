import Papa from 'papaparse'
import { parse as parseYaml } from 'yaml'
import type { ImportIssue, NoteInput, ParsedImport } from '../domain/types'

export async function parseImportFile(file: File): Promise<ParsedImport> {
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? ''
  const text = await file.text()
  if (extension === 'csv' || extension === 'tsv') {
    return parseDelimited(text, file.name, extension === 'tsv' ? '\t' : undefined)
  }
  if (extension === 'json') return parseStructured(text, file.name, 'json')
  if (extension === 'yaml' || extension === 'yml') return parseStructured(text, file.name, 'yaml')
  return parseTextDocument(text, file.name, file.lastModified || Date.now())
}

export async function parseImportFiles(files: File[]): Promise<ParsedImport> {
  const results = await Promise.all(files.map((file) => parseImportFile(file)))
  const notes = results.flatMap((result) => result.notes)
  const issues = results.flatMap((result) => result.issues)
  const name = files.length === 1 ? results[0]?.name ?? '未命名项目' : `${files.length} 个文件导入`
  return { notes, issues, name }
}

export function normalizeNoteInputs(values: unknown[], fileName = 'import'): { notes: NoteInput[]; issues: ImportIssue[] } {
  const notes: NoteInput[] = []
  const issues: ImportIssue[] = []
  for (const [index, value] of values.entries()) {
    const result = normalizeNote(value)
    if (result.note) notes.push(result.note)
    if (result.issue) issues.push({ ...result.issue, file: fileName, row: index + 1 })
  }
  return { notes, issues }
}

function parseDelimited(text: string, fileName: string, delimiter?: string): ParsedImport {
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    delimiter,
  })
  const normalized = normalizeNoteInputs(result.data, fileName)
  for (const error of result.errors) {
    normalized.issues.push({
      file: fileName,
      row: typeof error.row === 'number' ? error.row + 1 : undefined,
      message: error.message,
    })
  }
  return { ...normalized, name: fileName.replace(/\.[^.]+$/, '') }
}

function parseStructured(text: string, fileName: string, format: 'json' | 'yaml'): ParsedImport {
  try {
    const parsed: unknown = format === 'json' ? JSON.parse(text) : parseYaml(text)
    const values = extractRecords(parsed)
    const normalized = normalizeNoteInputs(values, fileName)
    return { ...normalized, name: fileName.replace(/\.[^.]+$/, '') }
  } catch (error) {
    return {
      notes: [],
      issues: [{ file: fileName, message: `无法解析${format.toUpperCase()}：${errorMessage(error)}` }],
      name: fileName,
    }
  }
}

function parseTextDocument(text: string, fileName: string, modifiedAt: number): ParsedImport {
  const { frontmatter, body } = splitFrontmatter(text)
  const title = stringValue(frontmatter.title) ?? fileName.replace(/\.[^.]+$/, '')
  const createdAt = stringValue(frontmatter.createdAt) ?? new Date(modifiedAt).toISOString()
  const tags = normalizeTags(frontmatter.tags)
  return {
    notes: [{ title, content: body.trim() || text.trim(), createdAt, tags, source: fileName }],
    issues: body.trim() || text.trim() ? [] : [{ file: fileName, message: '文件内容为空' }],
    name: title,
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
      title: stringValue(record.title) ?? stringValue(record.name) ?? content.slice(0, 48),
      content: content.trim(),
      createdAt: new Date(createdAt).toISOString(),
      tags: normalizeTags(record.tags),
      source: stringValue(record.source) ?? stringValue(record.url),
      weight: numberValue(record.weight) ?? 1,
    },
  }
}

function splitFrontmatter(text: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!text.startsWith('---')) return { frontmatter: {}, body: text }
  const end = text.indexOf('\n---', 3)
  if (end < 0) return { frontmatter: {}, body: text }
  try {
    const frontmatter = parseYaml(text.slice(3, end)) as Record<string, unknown>
    return { frontmatter: frontmatter && typeof frontmatter === 'object' ? frontmatter : {}, body: text.slice(end + 4) }
  } catch {
    return { frontmatter: {}, body: text }
  }
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeTags(value: unknown): string[] | string | undefined {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  return stringValue(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
