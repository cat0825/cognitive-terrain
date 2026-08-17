import {
  buildVaultSyncPreview,
  invalidFieldsForIssues,
  type VaultScanFile,
  type VaultSyncPreview,
} from '../domain/vault-sync'
import type { ImportIssue, TerrainProject, VaultSourceState } from '../domain/types'
import { parseTextDocument, vaultLocation } from './parse'

const MARKDOWN_EXTENSIONS = ['.md', '.markdown']

export async function scanVaultFiles(
  values: File[],
  project: TerrainProject,
  scannedAt = new Date().toISOString(),
): Promise<VaultSyncPreview> {
  if (!Number.isFinite(Date.parse(scannedAt))) throw new Error('vault 扫描时间无效')
  const candidates = values.filter(isMarkdownFile)
  if (!candidates.length) throw new Error('所选目录中没有 Markdown 笔记')
  const locations = candidates.map((file) => ({ file, ...vaultLocation(file) }))
  const vaultNames = [...new Set(locations.flatMap((entry) => entry.vault ? [entry.vault] : []))]
  const existingVault = findExistingVault(project, vaultNames[0])
  const vaultName = vaultNames[0] ?? existingVault?.displayName ?? 'Obsidian Vault'
  const vaultId = existingVault?.vaultId ?? createVaultId(project.id, vaultName)
  const baselineByPath = new Map(
    (project.vaultSync?.sources ?? [])
      .filter((source) => source.vaultId === vaultId && source.status === 'present')
      .map((source) => [normalizePath(source.relativePath), source]),
  )
  const issues: ImportIssue[] = []
  if (vaultNames.length > 1) {
    issues.push({
      file: vaultNames.join(', '),
      message: '一次同步只能处理一个 vault 根目录；本次扫描不会推断删除',
    })
  }
  const settled = await Promise.all(locations.map(async ({ file, path }) => {
    try {
      const text = await file.text()
      const rawContentHash = await sha256(text)
      const baseline = baselineForFile(baselineByPath, project.vaultSync?.sources ?? [], path, rawContentHash)
      if (baseline && normalizePath(baseline.relativePath) === normalizePath(path)
        && baseline.relativePath === path && baseline.rawContentHash === rawContentHash) {
        return {
          path,
          rawContentHash,
          lastModifiedMs: validModifiedTime(file.lastModified, scannedAt),
          size: file.size,
          invalidFields: [],
          issues: [],
        } satisfies VaultScanFile
      }
      const parsed = parseTextDocument(
        text,
        file.name,
        file.lastModified || Date.parse(scannedAt),
        { vault: vaultName, path },
        baseline?.acceptedNote.createdAt,
      )
      const fileIssues = parsed.issues.map((issue) => ({ ...issue, file: path }))
      return {
        path,
        rawContentHash,
        lastModifiedMs: validModifiedTime(file.lastModified, scannedAt),
        size: file.size,
        note: parsed.notes[0],
        invalidFields: invalidFieldsForIssues(fileIssues),
        issues: fileIssues,
      } satisfies VaultScanFile
    } catch (error) {
      const issue = {
        file: path,
        message: `文件读取失败：${error instanceof Error ? error.message : String(error)}`,
      }
      issues.push(issue)
      return undefined
    }
  }))
  const files: VaultScanFile[] = settled.flatMap((file) => file ? [file as VaultScanFile] : [])
  for (const file of files) issues.push(...file.issues)
  return buildVaultSyncPreview(project, {
    vaultId,
    vaultName,
    accessMode: 'reselect-files',
    scannedAt,
    complete: issues.every((issue) => !issue.message.startsWith('文件读取失败')) && vaultNames.length <= 1,
    files,
    issues,
  })
}

export async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('当前环境不支持 SHA-256，无法安全比较文件修订')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function baselineForFile(
  byPath: ReadonlyMap<string, VaultSourceState>,
  sources: readonly VaultSourceState[],
  path: string,
  rawContentHash: string,
): VaultSourceState | undefined {
  const exact = byPath.get(normalizePath(path))
  if (exact) return exact
  const hashMatches = sources.filter((source) => source.status === 'present' && source.rawContentHash === rawContentHash)
  return hashMatches.length === 1 ? hashMatches[0] : undefined
}

function findExistingVault(project: TerrainProject, displayName: string | undefined) {
  if (!displayName) return project.vaultSync?.vaults.length === 1 ? project.vaultSync.vaults[0] : undefined
  const normalized = displayName.normalize('NFKC').trim().toLocaleLowerCase()
  return project.vaultSync?.vaults.find(
    (vault) => vault.displayName.normalize('NFKC').trim().toLocaleLowerCase() === normalized,
  )
}

function isMarkdownFile(file: File): boolean {
  const location = file.webkitRelativePath || file.name
  if (location.split('/').some((segment) => segment.startsWith('.'))) return false
  return MARKDOWN_EXTENSIONS.some((extension) => file.name.toLocaleLowerCase().endsWith(extension))
}

function validModifiedTime(value: number, scannedAt: string): number | undefined {
  return Number.isFinite(value) && value > 0 && value <= Date.parse(scannedAt) ? Math.floor(value) : undefined
}

function normalizePath(value: string): string {
  return value.normalize('NFKC').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/').toLocaleLowerCase()
}

function createVaultId(projectId: string, vaultName: string): string {
  const random = globalThis.crypto?.randomUUID?.()
  if (random) return `vault-${random}`
  let hash = 2166136261
  const value = `${projectId}\n${vaultName}`
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `vault-${(hash >>> 0).toString(16).padStart(8, '0')}`
}
