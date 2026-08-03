import { Canvas } from '@react-three/fiber'
import { memo } from 'react'
import { ACESFilmicToneMapping, SRGBColorSpace } from 'three'
import type { QualityLevel, TerrainNote, TerrainProject, ViewMode } from '../domain/types'
import { interpolateSnapshots, mixHeightValues } from '../pipeline/terrain'
import { Terrain2D } from '../fallback/Terrain2D'
import { useAppStore } from '../store/app-store'
import { TERRAIN_CAMERA_POSITION } from './terrain-config'
import { TERRAIN_PREPARE_EXPORT_EVENT } from './terrain-events'
import { TerrainScene } from './TerrainScene'

interface TerrainCanvasProps {
  project: TerrainProject
  notes: TerrainNote[]
  selectedNoteId: string | null
  viewMode: ViewMode
  quality: QualityLevel
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
  cameraRevision,
  cameraScale,
  onSelectNote,
}: TerrainCanvasProps) {
  const use2d = viewMode === '2d' || !supportsWebgl()
  if (use2d) {
    return (
      <AnimatedTerrain2D
        project={project}
        notes={notes}
        selectedNoteId={selectedNoteId}
        onSelectNote={onSelectNote}
      />
    )
  }

  const dpr: number | [number, number] = quality === 'high' ? [1, 1.5] : quality === 'medium' ? [1, 1.25] : 1
  return (
    <Canvas
      dpr={dpr}
      camera={{ position: TERRAIN_CAMERA_POSITION, fov: 34, near: 0.1, far: 40 }}
      gl={{ antialias: quality === 'high', alpha: false, powerPreference: 'high-performance' }}
      raycaster={{
        params: {
          Mesh: {},
          Line: { threshold: 1 },
          LOD: {},
          Points: { threshold: 0.045 },
          Sprite: {},
        },
      }}
      onCreated={({ camera, gl, scene }) => {
        gl.outputColorSpace = SRGBColorSpace
        gl.toneMapping = ACESFilmicToneMapping
        gl.toneMappingExposure = 1.08
        gl.domElement.addEventListener(TERRAIN_PREPARE_EXPORT_EVENT, () => {
          gl.render(scene, camera)
        })
      }}
      onPointerMissed={() => onSelectNote(null)}
      fallback={
        <AnimatedTerrain2D
          project={project}
          notes={notes}
          selectedNoteId={selectedNoteId}
          onSelectNote={onSelectNote}
        />
      }
    >
      <TerrainScene
        snapshots={project.snapshots}
        gridSize={project.gridSize}
        notes={notes}
        peaks={project.peaks}
        selectedNoteId={selectedNoteId}
        quality={quality}
        cameraRevision={cameraRevision}
        cameraScale={cameraScale}
        onSelectNote={onSelectNote}
      />
    </Canvas>
  )
})

function AnimatedTerrain2D({
  project,
  notes,
  selectedNoteId,
  onSelectNote,
}: Pick<TerrainCanvasProps, 'project' | 'notes' | 'selectedNoteId' | 'onSelectNote'>) {
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
