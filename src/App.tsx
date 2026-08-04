import { AlertCircle, LoaderCircle, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { visibleNotesFor } from './domain/project-view'
import { downloadProjectBundle, downloadProjectReport, exportTerrainPng } from './export/project-files'
import { TerrainCanvas } from './scene/TerrainCanvas'
import { useAppStore } from './store/app-store'
import { CameraRail } from './ui/CameraRail'
import { FilterPanel } from './ui/FilterPanel'
import { ImportPanel } from './ui/ImportPanel'
import { NoteDetail } from './ui/NoteDetail'
import { Timeline } from './ui/Timeline'
import { TopBar } from './ui/TopBar'

function App() {
  const project = useAppStore((state) => state.project)
  const selectedNoteId = useAppStore((state) => state.selectedNoteId)
  const search = useAppStore((state) => state.search)
  const activeTags = useAppStore((state) => state.activeTags)
  const timelineBucket = useAppStore((state) => Math.ceil(state.timeline))
  const viewMode = useAppStore((state) => state.viewMode)
  const quality = useAppStore((state) => state.quality)
  const cameraRevision = useAppStore((state) => state.cameraRevision)
  const cameraScale = useAppStore((state) => state.cameraScale)
  const isAnalyzing = useAppStore((state) => state.isAnalyzing)
  const progress = useAppStore((state) => state.progress)
  const error = useAppStore((state) => state.error)
  const lastAnalysis = useAppStore((state) => state.lastAnalysis)
  const initialize = useAppStore((state) => state.initialize)
  const selectNote = useAppStore((state) => state.selectNote)
  const setImportOpen = useAppStore((state) => state.setImportOpen)
  const cancelAnalysis = useAppStore((state) => state.cancelAnalysis)
  const loadStudyPack = useAppStore((state) => state.loadStudyPack)
  const reportError = useAppStore((state) => state.reportError)
  const dismissError = useAppStore((state) => state.dismissError)
  const firstRun = useAppStore((state) => state.firstRun)
  const dismissFirstRun = useAppStore((state) => state.dismissFirstRun)

  useEffect(() => {
    void initialize()
  }, [initialize])

  const visibleNotes = useMemo(
    () => visibleNotesFor(project, timelineBucket, search, activeTags),
    [activeTags, project, search, timelineBucket],
  )
  const filteredNotes = useMemo(
    () => visibleNotesFor(project, Math.max(0, project.snapshots.length - 1), search, activeTags),
    [activeTags, project, search],
  )
  const selectedNote = project.notes.find((note) => note.id === selectedNoteId)
  const progressValue = progress?.total ? Math.round((progress.completed / progress.total) * 100) : 0
  const [analysisToast, setAnalysisToast] = useState<typeof lastAnalysis>(null)
  const toastTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!lastAnalysis) return
    setAnalysisToast(lastAnalysis)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setAnalysisToast(null), 6000)
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [lastAnalysis])

  const exportImage = async () => {
    const root = document.getElementById('terrain-export-source')
    if (!root) return
    try {
      const index = Math.min(timelineBucket, project.snapshots.length - 1)
      const snapshot = project.snapshots[index]
      await exportTerrainPng(root, project, snapshot)
    } catch (exportError) {
      reportError(exportError instanceof Error ? exportError.message : '导出 PNG 失败')
    }
  }

  return (
    <div className="app-shell">
      <div className="app-window">
        <TopBar
          onImport={() => setImportOpen(true)}
          onLoadStudyPack={() => void loadStudyPack()}
          onExportProject={() => downloadProjectBundle(project)}
          onExportImage={() => void exportImage()}
          onExportReport={() => void downloadProjectReport(project)}
        />
        <main className="terrain-workspace">
          <section id="terrain-export-source" className="terrain-stage" aria-label="认知地形地图">
            <TerrainCanvas
              project={project}
              notes={filteredNotes}
              selectedNoteId={selectedNoteId}
              viewMode={viewMode}
              quality={quality}
              cameraRevision={cameraRevision}
              cameraScale={cameraScale}
              onSelectNote={selectNote}
            />
            <NoteDetail project={project} note={selectedNote} visibleCount={visibleNotes.length} />
            <CameraRail />
            <Timeline snapshots={project.snapshots} onExportImage={() => void exportImage()} />
            <FilterPanel />
          </section>
        </main>

        <ImportPanel />
        {project.notes.length > 0 && project.notes.length <= 5 && (
          <div className="small-data-hint" role="status">
            <span className="panel-kicker">SMALL SAMPLE</span>
            <strong>仅 {project.notes.length} 条笔记</strong>
            <p>笔记较少时地形较为平坦。导入更多笔记后，主题峰值会更清晰。</p>
            <button type="button" className="primary-button" onClick={() => setImportOpen(true)}>
              导入更多笔记
            </button>
          </div>
        )}
        {firstRun && (
          <div className="first-run-banner" role="status">
            <div>
              <span className="panel-kicker">GETTING STARTED</span>
              <strong>导入你的笔记，生成专属地形</strong>
              <p>当前展示的是演示数据。导入 JSON / CSV / Markdown 笔记，或用今天的阅读列表快速体验。</p>
            </div>
            <button type="button" className="primary-button" onClick={() => setImportOpen(true)}>
              导入我的笔记
            </button>
            <button type="button" className="icon-button first-run-close" aria-label="关闭欢迎提示" onClick={dismissFirstRun}>
              <X size={15} />
            </button>
          </div>
        )}
        {isAnalyzing && (
          <div className="processing-overlay" role="status" aria-live="polite">
            <LoaderCircle className="spin" size={24} />
            <div>
              <span className="panel-kicker">LOCAL ANALYSIS</span>
              <strong>{progress?.message ?? '正在分析笔记'}</strong>
              <div className="progress-track">
                <span style={{ width: `${progressValue}%` }} />
              </div>
            </div>
            <button type="button" onClick={cancelAnalysis}>取消</button>
          </div>
        )}
        {analysisToast && (
          <div className="analysis-toast" role="status">
            <strong>本地分析完成</strong>
            <span>
              {analysisToast.embeddingMode === 'semantic' ? '语义模式' : '降级模式'}
              {analysisToast.embeddingMode === 'fallback' && '（模型不可用，使用确定性向量）'}
               · {analysisToast.device} · {analysisToast.elapsedMs / 1000}s
            </span>
            <span className="analysis-toast-model">{analysisToast.modelId}</span>
          </div>
        )}
        {error && (
          <div className="error-toast" role="alert">
            <AlertCircle size={17} />
            <span>{error}</span>
            <button type="button" aria-label="关闭错误提示" onClick={dismissError}>
              <X size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
