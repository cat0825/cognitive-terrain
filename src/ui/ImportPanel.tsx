import { AlertTriangle, FileJson, FolderOpen, UploadCloud, X } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import type { ParsedImport } from '../domain/types'
import { parseProjectBundle } from '../export/project-files'
import { parseImportFiles } from '../import/parse'
import { useAppStore } from '../store/app-store'

type EmbeddingChoice = 'auto' | 'deterministic'

export function ImportPanel() {
  const open = useAppStore((state) => state.importOpen)
  const setOpen = useAppStore((state) => state.setImportOpen)
  const startAnalysis = useAppStore((state) => state.startAnalysis)
  const replaceProject = useAppStore((state) => state.replaceProject)
  const reportError = useAppStore((state) => state.reportError)
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [busy, setBusy] = useState(false)
  const [choice, setChoice] = useState<EmbeddingChoice>('auto')
  const inputRef = useRef<HTMLInputElement>(null)

  if (!open) return null

  const handleFiles = async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    try {
      if (files.length === 1 && files[0].name.endsWith('.terrain.json')) {
        const project = await parseProjectBundle(files[0])
        await replaceProject(project)
        setOpen(false)
        setParsed(null)
        return
      }
      setParsed(await parseImportFiles(files))
    } catch (error) {
      reportError(error instanceof Error ? error.message : '文件解析失败')
    } finally {
      setBusy(false)
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    void handleFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
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
          <button type="button" className="icon-button" aria-label="关闭导入" onClick={() => setOpen(false)}>
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
                <span>{parsed.issues.length} 条记录未导入</span>
              </div>
            )}
            <button
              type="button"
              className="primary-button"
              disabled={!parsed.notes.length}
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
