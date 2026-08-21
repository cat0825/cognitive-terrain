import { AlertTriangle, FileJson, FolderOpen, FolderTree, UploadCloud, X } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import type { ImportLimitViolation, ParsedImport } from '../domain/types'
import { parseProjectBundleWithWarnings } from '../export/project-files'
import {
  DEFAULT_IMPORT_LIMITS,
  ImportLimitError,
  trimImportToLimits,
  validateProjectBundleSelection,
} from '../import/import-limits'
import { parseImportFiles } from '../import/parse'
import { useAppStore } from '../store/app-store'

type EmbeddingChoice = 'auto' | 'deterministic'

const noteExtensions = ['.md', '.markdown', '.txt']

/** React 的 input 类型没有目录选择属性，用索引签名 spread 进去。 */
const directoryAttributes: Record<string, string> = { webkitdirectory: '', directory: '' }

/** vault 里混着附件和 .obsidian 配置，只取笔记文件。 */
function markdownOnly(files: File[]): File[] {
  return files.filter((file) => {
    const relative = file.webkitRelativePath || file.name
    if (relative.split('/').some((segment) => segment.startsWith('.'))) return false
    return noteExtensions.some((extension) => file.name.toLowerCase().endsWith(extension))
  })
}

export function ImportPanel() {
  const open = useAppStore((state) => state.importOpen)
  const setOpen = useAppStore((state) => state.setImportOpen)
  const startAnalysis = useAppStore((state) => state.startAnalysis)
  const replaceProject = useAppStore((state) => state.replaceProject)
  const reportError = useAppStore((state) => state.reportError)
  const project = useAppStore((state) => state.project)
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [selectionIssues, setSelectionIssues] = useState<ImportLimitViolation[]>([])
  const [busy, setBusy] = useState(false)
  const [choice, setChoice] = useState<EmbeddingChoice>('auto')
  const inputRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  if (!open) return null

  const handleFiles = async (files: File[]) => {
    if (!files.length) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setParsed(null)
    setSelectionIssues([])
    setBusy(true)
    try {
      if (files.length === 1 && files[0].name.toLowerCase().endsWith('.terrain.json')) {
        validateProjectBundleSelection(files[0])
        const { project, futureActivityWarnings } = await parseProjectBundleWithWarnings(files[0], controller.signal)
        if (controller.signal.aborted) return
        await replaceProject(project)
        setOpen(false)
        setParsed(null)
        // Report after the import succeeds: the project still loaded, so this is a
        // warning about dropped activity rather than an import failure.
        if (futureActivityWarnings.length > 0) {
          reportError(
            `已忽略 ${futureActivityWarnings.length} 条晚于当前时间的活动记录（导出方时钟可能不准），其余数据已导入`,
          )
        }
        return
      }
      const nextParsed = await parseImportFiles(files, {
        signal: controller.signal,
        limits: DEFAULT_IMPORT_LIMITS,
        taxonomy: { workspaceId: project.id, nodes: project.taxonomyNodes ?? [] },
      })
      if (abortRef.current === controller) setParsed(nextParsed)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (abortRef.current === controller) setParsed(null)
        return
      }
      if (error instanceof ImportLimitError) {
        if (abortRef.current === controller) setSelectionIssues(error.issues)
        return
      }
      if (abortRef.current !== controller) return
      reportError(error instanceof Error ? error.message : '文件解析失败')
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setBusy(false)
      }
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    void handleFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => { abortRef.current?.abort(); setOpen(false) }}>
      <section
        className="import-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="panel-kicker">LOCAL-FIRST IMPORT</span>
            <h2 id="import-title">导入笔记</h2>
          </div>
          <button type="button" className="icon-button" aria-label="关闭导入" onClick={() => { abortRef.current?.abort(); setOpen(false) }}>
            <X size={18} />
          </button>
        </header>

        <div
          className="drop-zone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <UploadCloud size={25} />
          <strong>{busy ? '正在读取文件' : '选择笔记文件'}</strong>
          <span>JSON · CSV · Markdown · YAML · Terrain bundle</span>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".json,.csv,.tsv,.md,.markdown,.txt,.yaml,.yml,.terrain.json"
            onChange={(event) => void handleFiles(Array.from(event.target.files ?? []))}
          />
        </div>

        <div className="import-folder">
          <button
            type="button"
            className="focus-button"
            onClick={(event) => {
              event.stopPropagation()
              folderRef.current?.click()
            }}
          >
            <FolderTree size={14} />
            选择 Obsidian 文件夹
          </button>
          <small>按文件夹导入才能记下 vault 名称，回跳 Obsidian 更准确。文件仍只在本机解析。</small>
          <input
            ref={folderRef}
            type="file"
            multiple
            {...directoryAttributes}
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? [])
              if (!picked.length) return
              const notes = markdownOnly(picked)
              if (!notes.length) {
                reportError(`所选文件夹里没有 Markdown 笔记（已跳过 ${picked.length} 个文件）`)
                return
              }
              void handleFiles(notes)
            }}
          />
        </div>

        {busy && (
          <div className="import-reading" role="status">
            <span>正在预检与解析，取消后不会改动当前项目</span>
            <button type="button" className="focus-button" onClick={() => abortRef.current?.abort()}><X size={14} />取消读取</button>
          </div>
        )}

        {selectionIssues.length > 0 && (
          <div className="import-selection-error" role="alert" aria-label="导入资源限制">
            <AlertTriangle size={15} />
            <div>
              <strong>导入未开始：资源超过上限</strong>
              {selectionIssues.map((issue, index) => <p key={`${issue.file}-${issue.code}-${index}`}>{issue.message}</p>)}
            </div>
          </div>
        )}

        {parsed && (
          <div className="import-summary">
            <div className="import-count">
              <FileJson size={18} />
              <span>
                <strong>{parsed.notes.length}</strong> 条可分析笔记
              </span>
            </div>
            {parsed.issues.length > 0 && (
              <div className="import-issues">
                <AlertTriangle size={15} />
                <span>{parsed.issues.length} 条导入问题</span>
              </div>
            )}
            <button
              type="button"
              className="primary-button"
              disabled={!parsed.notes.length || Boolean(parsed.preflight?.blockingIssues.length)}
              onClick={() =>
                void startAnalysis(
                  parsed.name,
                  parsed.notes,
                  choice === 'deterministic' ? { embeddingStrategy: 'deterministic' } : undefined,
                )
              }
            >
              <FolderOpen size={16} />
              生成地形
            </button>
            {parsed.preflight && <ImportPreflightSummary parsed={parsed} onTrim={() => setParsed(trimImportToLimits(parsed))} />}
            <label className="embedding-choice">
              <span>向量模式</span>
              <select value={choice} onChange={(event) => setChoice(event.target.value as EmbeddingChoice)}>
                <option value="auto">本地模型（语义，需下载）</option>
                <option value="deterministic">快速模式（离线）</option>
              </select>
            </label>
          </div>
        )}
      </section>
    </div>
  )
}

function ImportPreflightSummary({ parsed, onTrim }: { parsed: ParsedImport; onTrim: () => void }) {
  const preflight = parsed.preflight
  if (!preflight) return null
  const hasBlocking = preflight.blockingIssues.length > 0
  return (
            <div className="import-preflight" role="region" aria-label="导入预检">
      <div className="import-preflight-heading">
        <strong>导入预检</strong>
        <span>{preflight.fileCount} 文件 · {preflight.recordCount} 条记录 · {formatBytes(preflight.totalBytes)}</span>
      </div>
      <div className="import-preflight-grid">
        <span>可分析 <b>{preflight.noteCount}</b></span>
        <span>正文 <b>{formatNumber(preflight.totalContentChars)} 字符</b></span>
        <span>快速模式约 <b>{preflight.estimatedSeconds.deterministic}s</b></span>
        <span>语义模式约 <b>{preflight.estimatedSeconds.semantic}s</b></span>
      </div>
      {hasBlocking && (
        <div className="import-preflight-blocking">
          <AlertTriangle size={14} />
          <div>
            <strong>{preflight.blockingIssues.length} 项必须处理</strong>
            {preflight.blockingIssues.slice(0, 4).map((issue, index) => <p key={`${issue.file}-${issue.row}-${index}`}>{issue.message}</p>)}
            {preflight.blockingIssues.length > 4 && <p>还有 {preflight.blockingIssues.length - 4} 项</p>}
          </div>
          <button type="button" className="focus-button" onClick={onTrim}>按上限整理</button>
        </div>
      )}
      {!hasBlocking && preflight.trimmed && <p className="import-preflight-trimmed">已整理：移除 {preflight.trimmed.records} 条记录、{preflight.trimmed.duplicateIds} 个重复 ID，截断 {formatNumber(preflight.trimmed.contentChars)} 个字符。</p>}
      {preflight.duplicateIds.length > 0 && <p className="import-preflight-warning">重复 ID：{preflight.duplicateIds.join('、')}</p>}
      {preflight.invalidTimestampCount > 0 && <p className="import-preflight-warning">{preflight.invalidTimestampCount} 条时间无效，导入问题中已标明字段。</p>}
      {preflight.futureTimestampCount > 0 && <p className="import-preflight-warning">{preflight.futureTimestampCount} 条时间晚于当前时间，请确认来源设备时钟。</p>}
      {preflight.unknownTaxonomyLabels.length > 0 && <p className="import-preflight-warning">未匹配领域：{preflight.unknownTaxonomyLabels.join('、')}</p>}
    </div>
  )
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}
