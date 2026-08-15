import { lazy, memo, Suspense, useEffect, useState } from 'react'
import type { QualityLevel, TerrainNote, TerrainProject, ViewMode, VisualDimension } from '../domain/types'
import { interpolateSnapshots, mixHeightValues } from '../pipeline/terrain'
import { Terrain2D } from '../fallback/Terrain2D'
import { useAppStore } from '../store/app-store'

const Terrain3D = lazy(() => import('./Terrain3D'))

interface TerrainCanvasProps {
  project: TerrainProject
  notes: TerrainNote[]
  selectedNoteId: string | null
  viewMode: ViewMode
  quality: QualityLevel
  visualDimension: VisualDimension
  cameraRevision: number
  cameraScale: number
  onSelectNote: (id: string | null) => void
}

export const TerrainCanvas = memo(function TerrainCanvas({
  project,
  notes,
  selectedNoteId,
  viewMode,
  quality,
  visualDimension,
  cameraRevision,
  cameraScale,
  onSelectNote,
}: TerrainCanvasProps) {
  const use2d = viewMode === '2d' || !supportsWebgl()
  const [webglReady, setWebglReady] = useState(false)
  const focusRequest = useAppStore((state) => state.focusRequest)
  const activePeakId = useAppStore((state) => state.activePeakId)
  useEffect(() => {
    if (use2d) return
    const timer = window.setTimeout(() => setWebglReady(true), 60)
    return () => window.clearTimeout(timer)
  }, [use2d])

  if (use2d || !webglReady) {
    return (
      <AnimatedTerrain2D
        project={project}
        notes={notes}
        selectedNoteId={selectedNoteId}
        visualDimension={visualDimension}
        onSelectNote={onSelectNote}
      />
    )
  }

  return (
    <Suspense
      fallback={
        <AnimatedTerrain2D
          project={project}
          notes={notes}
          selectedNoteId={selectedNoteId}
          visualDimension={visualDimension}
          onSelectNote={onSelectNote}
        />
      }
    >
      <Terrain3D
        project={project}
        notes={notes}
        selectedNoteId={selectedNoteId}
        quality={quality}
        visualDimension={visualDimension}
        cameraRevision={cameraRevision}
        cameraScale={cameraScale}
        focusRequest={focusRequest}
        activePeakId={activePeakId}
        onSelectNote={onSelectNote}
      />
    </Suspense>
  )
})

function AnimatedTerrain2D({
  project,
  notes,
  selectedNoteId,
  visualDimension,
  onSelectNote,
}: Pick<TerrainCanvasProps, 'project' | 'notes' | 'selectedNoteId' | 'visualDimension' | 'onSelectNote'>) {
  const timeline = useAppStore((state) => Math.round(state.timeline * 4) / 4)
  const pair = interpolateSnapshots(project.snapshots, timeline)
  const values = pair.mix === 0 ? pair.a.values : mixHeightValues(pair.a.values, pair.b.values, pair.mix)
  return (
    <Terrain2D
      values={values}
      gridSize={project.gridSize}
      notes={notes}
      peaks={project.peaks}
      selectedNoteId={selectedNoteId}
      visualDimension={visualDimension}
      onSelectNote={onSelectNote}
    />
  )
}

let webglSupport: boolean | undefined

function supportsWebgl(): boolean {
  if (webglSupport !== undefined) return webglSupport
  try {
    const canvas = document.createElement('canvas')
    webglSupport = Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    webglSupport = false
  }
  return webglSupport
}
