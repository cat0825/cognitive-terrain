import { isMap, parseDocument, stringify } from 'yaml'
import type { TerrainNote, TerrainProject, VaultSourceState } from './types'

export const VAULT_WRITEBACK_FIELDS = [
  'mastery',
  'confidence',
  'exploration',
  'status',
  'areas',
  'reviewedAt',
] as const

export type VaultWritebackField = (typeof VAULT_WRITEBACK_FIELDS)[number]

export type VaultWritebackRequest =
  | { id: string; sourceId: string; kind: 'field'; field: VaultWritebackField }
  | { id: string; sourceId: string; kind: 'wikilink'; targetSourceId: string }

export interface VaultWritebackReadFile {
  sourceId: string
  path: string
  bytes: Uint8Array
  text: string
  byteHash: string
}

export type VaultWritebackStatus = 'ready' | 'noop' | 'blocked'

export type VaultWritebackBlockCode =
  | 'missing-source'
  | 'source-revision-mismatch'
  | 'invalid-utf8'
  | 'nul-byte'
  | 'unclosed-frontmatter'
  | 'invalid-yaml'
  | 'duplicate-key'
  | 'non-map-frontmatter'
  | 'flow-map-insert'
  | 'ambiguous-area-alias'
  | 'unsafe-range'
  | 'missing-target'
  | 'ambiguous-target-path'
  | 'cross-vault-target'
  | 'unsafe-markdown-tail'
  | 'unsupported-value'

export interface VaultWritebackEntry {
  requestId: string
  sourceId: string
  itemId: string
  path: string
  kind: VaultWritebackRequest['kind']
  field?: VaultWritebackField
  targetSourceId?: string
  status: VaultWritebackStatus
  blockCode?: VaultWritebackBlockCode
  detail?: string
  beforeText: string
  afterText: string
  beforeByteHash: string
  afterByteHash?: string
  unifiedDiff: string
}

export interface VaultWritebackPreview {
  id: string
  projectId: string
  baseProjectUpdatedAt: string
  vaultId: string
  createdAt: string
  entries: VaultWritebackEntry[]
}

export interface VaultWritebackFileResult {
  requestId: string
  sourceId: string
  path: string
  status: 'succeeded' | 'failed' | 'not-attempted'
  backupId?: string
  error?: string
}

export async function buildVaultWritebackPreview(
  project: TerrainProject,
  files: readonly VaultWritebackReadFile[],
  requests: readonly VaultWritebackRequest[],
  createdAt: string,
): Promise<VaultWritebackPreview> {
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('写回预览时间无效')
  const vaults = project.vaultSync?.vaults ?? []
  const sourceById = new Map((project.vaultSync?.sources ?? []).map((source) => [source.sourceId, source]))
  const noteById = new Map(project.notes.map((note) => [note.id, note]))
  const fileBySource = new Map(files.map((file) => [file.sourceId, file]))
  const workingBySource = new Map(files.map((file) => [file.sourceId, {
    text: file.text,
    byteHash: file.byteHash,
  }]))
  const entries: VaultWritebackEntry[] = []
  const seen = new Set<string>()

  for (const request of requests) {
    if (seen.has(request.id)) continue
    seen.add(request.id)
    const source = sourceById.get(request.sourceId)
    const note = source ? noteById.get(source.itemId) : undefined
    const file = source ? fileBySource.get(source.sourceId) : undefined
    const working = source ? workingBySource.get(source.sourceId) : undefined
    const common = {
      requestId: request.id,
      sourceId: request.sourceId,
      itemId: source?.itemId ?? '',
      path: file?.path ?? source?.relativePath ?? '',
      kind: request.kind,
      field: request.kind === 'field' ? request.field : undefined,
      targetSourceId: request.kind === 'wikilink' ? request.targetSourceId : undefined,
      beforeText: working?.text ?? file?.text ?? '',
      afterText: working?.text ?? file?.text ?? '',
      beforeByteHash: working?.byteHash ?? file?.byteHash ?? '',
      unifiedDiff: '',
    }
    if (!source || !note || !file || source.status !== 'present') {
      entries.push({ ...common, status: 'blocked', blockCode: 'missing-source', detail: '同步 source 不存在或已移除' })
      continue
    }
    if (!vaults.some((vault) => vault.vaultId === source.vaultId)) {
      entries.push({ ...common, status: 'blocked', blockCode: 'missing-source', detail: 'source 所属 vault 不存在' })
      continue
    }
    if (normalizePath(file.path) !== normalizePath(source.relativePath) || file.byteHash !== source.rawContentHash) {
      entries.push({ ...common, status: 'blocked', blockCode: 'source-revision-mismatch', detail: '文件已被外部修改，请重新同步后再写回' })
      continue
    }
    if (file.bytes.includes(0)) {
      entries.push({ ...common, status: 'blocked', blockCode: 'nul-byte', detail: '文件包含 NUL 字节，拒绝改写' })
      continue
    }

    const result = request.kind === 'field'
      ? patchField(working?.text ?? file.text, request.field, fieldValue(note, request.field))
      : patchWikiLink(project, source, working?.text ?? file.text, request.targetSourceId)
    if (result.status === 'blocked') {
      entries.push({ ...common, ...result })
      continue
    }
    const beforeText = working?.text ?? file.text
    const afterByteHash = await sha256Bytes(new TextEncoder().encode(result.text))
    workingBySource.set(source.sourceId, { text: result.text, byteHash: afterByteHash })
    entries.push({
      ...common,
      status: result.text === beforeText ? 'noop' : 'ready',
      afterText: result.text,
      afterByteHash,
      unifiedDiff: result.text === beforeText ? '' : unifiedDiff(file.path, beforeText, result.text),
      detail: result.detail,
    })
  }

  return {
    id: `writeback:${project.id}:${stableHash(`${createdAt}\n${requests.map((request) => request.id).join('|')}`)}`,
    projectId: project.id,
    baseProjectUpdatedAt: project.updatedAt,
    vaultId: uniqueRequestVaultId(requests, sourceById),
    createdAt,
    entries,
  }
}

function uniqueRequestVaultId(
  requests: readonly VaultWritebackRequest[],
  sourceById: ReadonlyMap<string, VaultSourceState>,
): string {
  const vaultIds = new Set(requests.flatMap((request) => {
    const vaultId = sourceById.get(request.sourceId)?.vaultId
    return vaultId ? [vaultId] : []
  }))
  return vaultIds.size === 1 ? [...vaultIds][0] : ''
}

function fieldValue(note: TerrainNote, field: VaultWritebackField): number | string | string[] | undefined {
  if (field === 'areas') return note.areas?.length ? [...note.areas] : note.area ? [note.area] : undefined
  return note[field]
}

function patchField(text: string, field: VaultWritebackField, value: unknown):
  | { status: 'ready'; text: string; detail?: string }
  | { status: 'blocked'; blockCode: VaultWritebackBlockCode; detail: string; beforeText?: string; afterText?: string; unifiedDiff?: string } {
  if (value === undefined || (field === 'areas' && (!Array.isArray(value) || value.length === 0))) {
    return { status: 'blocked', blockCode: 'unsupported-value', detail: `应用内没有可写回的 ${field} 值` }
  }
  const serialized = serializeFieldValue(value)
  if (!serialized) return { status: 'blocked', blockCode: 'unsupported-value', detail: `${field} 的值不在写回 allowlist 范围内` }
  const boundary = frontmatterBoundary(text)
  if (boundary.kind === 'invalid') return { status: 'blocked', blockCode: 'unclosed-frontmatter', detail: 'YAML frontmatter 没有闭合' }
  const key = field === 'areas' ? 'areas' : field
  if (boundary.kind === 'none') {
    const eol = detectEol(text)
    const bom = text.startsWith('\ufeff') ? '\ufeff' : ''
    const body = bom ? text.slice(1) : text
    return { status: 'ready', text: `${bom}---${eol}${key}: ${serialized}${eol}---${eol}${body}` }
  }
  const parsed = parseDocument(text.slice(boundary.yamlStart, boundary.yamlEnd), { keepSourceTokens: true, strict: true, uniqueKeys: true })
  if (parsed.errors.length) {
    const duplicate = parsed.errors.some((error) => error.code === 'DUPLICATE_KEY')
    return { status: 'blocked', blockCode: duplicate ? 'duplicate-key' : 'invalid-yaml', detail: parsed.errors[0]?.message ?? 'YAML 无法解析' }
  }
  if (!isMap(parsed.contents)) return { status: 'blocked', blockCode: 'non-map-frontmatter', detail: 'frontmatter 根节点必须是键值映射' }
  if (parsed.contents.srcToken?.type === 'flow-collection') return { status: 'blocked', blockCode: 'flow-map-insert', detail: 'flow map 不允许安全插入 cognitive 字段' }
  const aliases = field === 'areas' ? ['area', 'areas'] : [field]
  const pairs = parsed.contents.items.filter((pair) => {
    const key = pair.key && typeof pair.key === 'object' && 'value' in pair.key ? pair.key.value : undefined
    return typeof key === 'string' && aliases.includes(key)
  })
  if (pairs.length > 1) return { status: 'blocked', blockCode: 'ambiguous-area-alias', detail: 'area 与 areas 同时存在，无法安全决定写回目标' }
  const pair = pairs[0]
  if (!pair) {
    const prefix = text.slice(0, boundary.yamlEnd)
    const insertion = `${prefix.endsWith(boundary.eol) ? '' : boundary.eol}${key}: ${serialized}${boundary.eol}`
    return { status: 'ready', text: `${prefix}${insertion}${text.slice(boundary.yamlEnd)}` }
  }
  const range = pair.value?.range
  if (!range || range[0] > range[1]) return { status: 'blocked', blockCode: 'unsafe-range', detail: '无法定位 frontmatter 目标值' }
  const start = boundary.yamlStart + range[0]
  const end = boundary.yamlStart + range[1]
  return { status: 'ready', text: `${text.slice(0, start)}${serialized}${text.slice(end)}` }
}

function patchWikiLink(
  project: TerrainProject,
  source: VaultSourceState,
  text: string,
  targetSourceId: string,
): { status: 'ready'; text: string; detail?: string } | { status: 'blocked'; blockCode: VaultWritebackBlockCode; detail: string } {
  const target = project.vaultSync?.sources.find((candidate) => candidate.sourceId === targetSourceId)
  const targetNote = target ? project.notes.find((candidate) => candidate.id === target.itemId) : undefined
  if (!target || !targetNote || target.status !== 'present') return { status: 'blocked', blockCode: 'missing-target', detail: '目标 source 不存在或已移除' }
  if (target.vaultId !== source.vaultId) return { status: 'blocked', blockCode: 'cross-vault-target', detail: 'WikiLink 目标不属于同一个 vault' }
  const targetPath = target.relativePath.replace(/\.(?:md|markdown)$/i, '')
  const duplicatePath = (project.vaultSync?.sources ?? []).filter((candidate) => candidate.vaultId === source.vaultId && candidate.status === 'present' && normalizePath(candidate.relativePath) === normalizePath(target.relativePath))
  if (duplicatePath.length !== 1) return { status: 'blocked', blockCode: 'ambiguous-target-path', detail: '目标路径不是唯一 source' }
  if (!markdownTailSafe(text)) return { status: 'blocked', blockCode: 'unsafe-markdown-tail', detail: '文件尾部处于未闭合代码、注释或 WikiLink 状态' }
  const body = markdownBody(text)
  const normalizedTarget = normalizeLinkKey(targetPath)
  const existing = wikiLinkTargets(body).some((value) => normalizeLinkKey(value) === normalizedTarget || normalizeLinkKey(value) === normalizeLinkKey(targetNote.title) && !hasDuplicateTitle(project, targetNote.title))
  if (existing) return { status: 'ready', text, detail: '目标 WikiLink 已存在' }
  const eol = detectEol(text)
  const tail = text.endsWith(eol) ? '' : eol
  return { status: 'ready', text: `${text}${tail}[[${targetPath}]]`, detail: `追加 [[${targetPath}]]` }
}

function hasDuplicateTitle(project: TerrainProject, title: string): boolean {
  const normalized = normalizeLinkKey(title)
  return project.notes.filter((note) => normalizeLinkKey(note.title) === normalized).length > 1
}

function serializeFieldValue(value: unknown): string | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 1 ? stringify(value).trim() : undefined
  if (typeof value === 'string') return value.trim() ? JSON.stringify(value) : undefined
  if (Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim())) return stringify(value, { collectionStyle: 'flow' }).trim()
  return undefined
}

function frontmatterBoundary(text: string):
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'valid'; yamlStart: number; yamlEnd: number; eol: string }
{
  const offset = text.startsWith('\ufeff') ? 1 : 0
  const firstLineEnd = lineEnd(text, offset)
  const firstLine = text.slice(offset, firstLineEnd.start)
  if (!/^---[ \t]*$/.test(firstLine)) return { kind: 'none' }
  const eol = firstLineEnd.eol || detectEol(text)
  let cursor = firstLineEnd.end
  while (cursor <= text.length) {
    const current = lineEnd(text, cursor)
    if (/^---[ \t]*$/.test(text.slice(cursor, current.start))) return { kind: 'valid', yamlStart: firstLineEnd.end, yamlEnd: cursor, eol }
    if (current.end === cursor) break
    cursor = current.end
  }
  return { kind: 'invalid' }
}

function markdownBody(text: string): string {
  const boundary = frontmatterBoundary(text)
  return boundary.kind === 'valid' ? text.slice(boundary.yamlEnd) : text
}

function markdownTailSafe(text: string): boolean {
  const body = markdownBody(text).replace(/<!--[\s\S]*?-->/g, '')
  let fence: MarkdownFence | undefined
  for (const line of body.split(/\r?\n/)) {
    fence = nextMarkdownFence(fence, line)
  }
  if (fence || /<!--[\s\S]*$/.test(body) || hasUnclosedWikiLink(body)) return false
  return true
}

function wikiLinkTargets(value: string): string[] {
  const lines = value.split(/\r?\n/)
  let fence: MarkdownFence | undefined
  const targets: string[] = []
  for (const line of lines) {
    const nextFence = nextMarkdownFence(fence, line)
    if (nextFence !== fence) {
      fence = nextFence
      continue
    }
    if (fence) continue
    const clean = line.replace(/`[^`]*`/g, '').replace(/<!--.*?-->/g, '')
    for (const match of clean.matchAll(/(?<!\\)\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
      if (match[1]) targets.push(match[1].trim())
    }
  }
  return targets
}

interface MarkdownFence {
  marker: '`' | '~'
  length: number
}

function nextMarkdownFence(current: MarkdownFence | undefined, line: string): MarkdownFence | undefined {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
  if (!match?.[1]) return current
  const marker = match[1][0] as MarkdownFence['marker']
  if (!current) return { marker, length: match[1].length }
  const closingTail = match[2] ?? ''
  return marker === current.marker && match[1].length >= current.length && !closingTail.trim()
    ? undefined
    : current
}

function hasUnclosedWikiLink(value: string): boolean {
  let open = false
  for (let index = 0; index < value.length - 1; index += 1) {
    if (value[index] === '\\') {
      index += 1
      continue
    }
    const token = value.slice(index, index + 2)
    if (!open && token === '[[') {
      open = true
      index += 1
    } else if (open && token === ']]') {
      open = false
      index += 1
    }
  }
  return open
}

function unifiedDiff(path: string, before: string, after: string): string {
  const oldLines = before.split(/\r?\n/)
  const newLines = after.split(/\r?\n/)
  let start = 0
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start += 1
  let oldEnd = oldLines.length - 1
  let newEnd = newLines.length - 1
  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd -= 1
    newEnd -= 1
  }
  const contextStart = Math.max(0, start - 2)
  const contextOldEnd = Math.min(oldLines.length - 1, oldEnd + 2)
  const contextNewEnd = Math.min(newLines.length - 1, newEnd + 2)
  const lines = [`--- a/${path}`, `+++ b/${path}`, `@@ -${contextStart + 1},${Math.max(0, contextOldEnd - contextStart + 1)} +${contextStart + 1},${Math.max(0, contextNewEnd - contextStart + 1)} @@`]
  for (let index = contextStart; index <= Math.max(contextOldEnd, contextNewEnd); index += 1) {
    if (index < start || (index > oldEnd && index > newEnd)) lines.push(` ${oldLines[index] ?? newLines[index] ?? ''}`)
    else {
      if (index <= oldEnd) lines.push(`-${oldLines[index] ?? ''}`)
      if (index <= newEnd) lines.push(`+${newLines[index] ?? ''}`)
    }
  }
  return lines.join('\n')
}

function detectEol(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function lineEnd(text: string, start: number): { start: number; end: number; eol: string } {
  const index = text.indexOf('\n', start)
  if (index < 0) return { start: text.length, end: text.length, eol: '' }
  const hasCr = index > start && text[index - 1] === '\r'
  return { start: hasCr ? index - 1 : index, end: index + 1, eol: hasCr ? '\r\n' : '\n' }
}

function normalizePath(value: string): string {
  return value.normalize('NFKC').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/').toLocaleLowerCase()
}

function normalizeLinkKey(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\.(?:md|markdown)$/i, '').replace(/^\.\//, '').toLocaleLowerCase()
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('当前环境不支持 SHA-256')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.slice().buffer)
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
