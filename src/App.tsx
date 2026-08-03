import { AlertCircle, LoaderCircle, X } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import './App.css'
import { visibleNotesFor } from './domain/project-view'
import { downloadProjectBundle, exportTerrainPng } from './export/project-files'
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
  const initialize = useAppStore((state) => state.initialize)
  const selectNote = useAppStore((state) => state.selectNote)
  const setImportOpen = useAppStore((state) => state.setImportOpen)
  const cancelAnalysis = useAppStore((state) => state.cancelAnalysis)
  const loadStudyPack = useAppStore((state) => state.loadStudyPack)
  const reportError = useAppStore((state) => state.reportError)
  const dismissError = useAppStore((state) => state.dismissError)

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

  const exportImage = async () => {
    const root = document.getElementById('terrain-export-source')
    if (!root) return
    try {
      await exportTerrainPng(root, project.name)
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
