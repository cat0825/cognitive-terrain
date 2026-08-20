import { AlertCircle, LoaderCircle, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { visibleNotesFor } from './domain/project-view'
import { buildPlateCollisions } from './domain/knowledge-plates'
import { buildProjectReferenceGapReport } from './domain/reference-gaps'
import { evaluationTimeForProject } from './domain/evaluation-time'
import { vaultWritebackCandidates, type VaultWritebackCandidate } from './domain/vault-writeback-candidates'
import { TerrainCanvas } from './scene/TerrainCanvas'
import { useAppStore } from './store/app-store'
import { CameraRail } from './ui/CameraRail'
import { FilterPanel } from './ui/FilterPanel'
import { NoteDetail } from './ui/NoteDetail'
import { ReferenceGapMapOverlay } from './ui/ReferenceGapMapOverlay'
import { Timeline } from './ui/Timeline'
import { TopBar } from './ui/TopBar'
import { TerrainSemanticsLegend } from './ui/TerrainSemanticsLegend'

const ImportPanel = lazy(async () => import('./ui/ImportPanel').then((module) => ({ default: module.ImportPanel })))
const VaultSyncPanel = lazy(() => import('./ui/VaultSyncPanel'))
const VaultWritebackPanel = lazy(() => import('./ui/VaultWritebackPanel'))

function App() {
  const project = useAppStore((state) => state.project)
  const selectedNoteId = useAppStore((state) => state.selectedNoteId)
  const search = useAppStore((state) => state.search)
  const activeTags = useAppStore((state) => state.activeTags)
  const activeAreas = useAppStore((state) => state.activeAreas)
  const activeCollisionId = useAppStore((state) => state.activeCollisionId)
  const activePeak = useAppStore((state) => state.activePeak)
  const activeGapNodeId = useAppStore((state) => state.activeGapNodeId)
  const timelineBucket = useAppStore((state) => Math.ceil(state.timeline))
  const viewMode = useAppStore((state) => state.viewMode)
  const quality = useAppStore((state) => state.quality)
  const visualDimension = useAppStore((state) => state.visualDimension)
  const cameraRevision = useAppStore((state) => state.cameraRevision)
  const cameraScale = useAppStore((state) => state.cameraScale)
  const isAnalyzing = useAppStore((state) => state.isAnalyzing)
  const progress = useAppStore((state) => state.progress)
  const error = useAppStore((state) => state.error)
  const lastAnalysis = useAppStore((state) => state.lastAnalysis)
  const initialize = useAppStore((state) => state.initialize)
  const selectNote = useAppStore((state) => state.selectNote)
  const selectGap = useAppStore((state) => state.selectGap)
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

  useEffect(() => {
    if (!firstRun) return
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      dismissFirstRun()
      focusTerrainStage()
    }
    document.addEventListener('keydown', dismissWithEscape)
    return () => document.removeEventListener('keydown', dismissWithEscape)
  }, [dismissFirstRun, firstRun])

  const visibleNotes = useMemo(
    () => visibleNotesFor(project, timelineBucket, search, activeTags, activeAreas),
    [activeAreas, activeTags, project, search, timelineBucket],
  )
  const filteredNotes = useMemo(
    () => visibleNotesFor(project, Math.max(0, project.snapshots.length - 1), search, activeTags, activeAreas),
    [activeAreas, activeTags, project, search],
  )
  const selectedNote = project.notes.find((note) => note.id === selectedNoteId)
  const collisions = useMemo(() => buildPlateCollisions(filteredNotes), [filteredNotes])
  const activeCollision = collisions.find((collision) => collision.id === activeCollisionId)
  const progressValue = progress?.total ? Math.round((progress.completed / progress.total) * 100) : 0
  const [analysisToast, setAnalysisToast] = useState<typeof lastAnalysis>(null)
  // Derived from the project rather than frozen at page load, so activity the
  // user records during the session is actually reflected. See #42.
  const gapEvaluatedAt = useMemo(() => evaluationTimeForProject(project.updatedAt), [project.updatedAt])
  const [syncOpen, setSyncOpen] = useState(false)
  const [writebackCandidates, setWritebackCandidates] = useState<VaultWritebackCandidate[] | null>(null)
  const toastTimer = useRef<number | null>(null)
  const referenceGapReport = useMemo(
    () => buildProjectReferenceGapReport(project, project.activeReferenceAtlasId ?? '', gapEvaluatedAt),
    [gapEvaluatedAt, project],
  )
  const activeReferenceAtlas = project.referenceAtlases?.find((atlas) => atlas.id === referenceGapReport.referenceAtlasId)

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
      const { exportTerrainPng } = await import('./export/project-files')
      const index = Math.min(timelineBucket, project.snapshots.length - 1)
      const snapshot = project.snapshots[index]
      await exportTerrainPng(root, project, snapshot, referenceGapReport)
    } catch (exportError) {
      reportError(exportError instanceof Error ? exportError.message : '导出 PNG 失败')
    }
  }

  const exportProject = async () => {
    try {
      const { downloadProjectBundle } = await import('./export/project-files')
      downloadProjectBundle(project)
    } catch (exportError) {
      reportError(exportError instanceof Error ? exportError.message : '导出项目失败')
    }
  }

  const exportReport = async () => {
    try {
      const { downloadProjectReport } = await import('./export/project-files')
      await downloadProjectReport(project)
    } catch (exportError) {
      reportError(exportError instanceof Error ? exportError.message : '导出报告失败')
    }
  }

  return (
    <div className="app-shell">
      <div className="app-window">
        <TopBar
          onImport={() => setImportOpen(true)}
          onSync={() => setSyncOpen(true)}
          onWriteback={() => setWritebackCandidates(vaultWritebackCandidates(project))}
          onLoadStudyPack={() => void loadStudyPack()}
          onExportProject={() => void exportProject()}
          onExportImage={() => void exportImage()}
          onExportReport={() => void exportReport()}
        />
        <main className="terrain-workspace">
          <section
            id="terrain-export-source"
            className="terrain-stage"
            aria-label="认知地形地图"
            data-selected-note-id={selectedNoteId ?? ''}
            tabIndex={-1}
          >
            <TerrainCanvas
              project={project}
              notes={filteredNotes}
              selectedNoteId={selectedNoteId}
              viewMode={viewMode}
              quality={quality}
              visualDimension={visualDimension}
              cameraRevision={cameraRevision}
              cameraScale={cameraScale}
              onSelectNote={selectNote}
            />
            <TerrainSemanticsLegend
              project={project}
              visualDimension={visualDimension}
              viewMode={viewMode}
              evaluatedAt={gapEvaluatedAt}
            />
            {activeReferenceAtlas && (
              <ReferenceGapMapOverlay
                atlasLabel={activeReferenceAtlas.label}
                report={referenceGapReport}
                selectedNodeId={activeGapNodeId}
                onSelectGap={selectGap}
              />
            )}
            <NoteDetail
              project={project}
              note={selectedNote}
              peak={activePeak ?? undefined}
              collision={activeCollision}
              gapReport={referenceGapReport}
              gapNodeId={activeGapNodeId ?? undefined}
              visibleCount={visibleNotes.length}
              onWriteback={setWritebackCandidates}
            />
            <CameraRail />
            <Timeline snapshots={project.snapshots} onExportImage={() => void exportImage()} />
            <FilterPanel />
          </section>
        </main>

        <Suspense fallback={null}>
          <ImportPanel />
        </Suspense>
        {syncOpen && (
          <Suspense fallback={<div className="processing-overlay" role="status">正在加载 vault 同步</div>}>
            <VaultSyncPanel open onClose={() => setSyncOpen(false)} />
          </Suspense>
        )}
        {writebackCandidates && (
          <Suspense fallback={<div className="processing-overlay" role="status">正在加载 vault 写回</div>}>
            <VaultWritebackPanel
              open
              seedCandidates={writebackCandidates}
              onClose={() => setWritebackCandidates(null)}
            />
          </Suspense>
        )}
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
              <p>当前为演示数据。支持 JSON、CSV 与 Markdown。</p>
            </div>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                dismissFirstRun()
                setImportOpen(true)
              }}
            >
              导入我的笔记
            </button>
            <button
              type="button"
              className="icon-button first-run-close"
              aria-label="关闭欢迎提示"
              onClick={() => {
                dismissFirstRun()
                focusTerrainStage()
              }}
            >
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

function focusTerrainStage(): void {
  window.requestAnimationFrame(() => document.getElementById('terrain-export-source')?.focus())
}

export default App
