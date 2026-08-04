import { Canvas } from '@react-three/fiber'
import { ACESFilmicToneMapping, SRGBColorSpace } from 'three'
import type { QualityLevel, TerrainNote, TerrainProject } from '../domain/types'
import { TERRAIN_PREPARE_EXPORT_EVENT } from './terrain-events'
import { TerrainScene } from './TerrainScene'
import { TERRAIN_CAMERA_POSITION } from './terrain-config'

interface Terrain3DProps {
  project: TerrainProject
  notes: TerrainNote[]
  selectedNoteId: string | null
  quality: QualityLevel
  cameraRevision: number
  cameraScale: number
  focusRequest: { noteId: string; revision: number } | null
  activePeakId: string | null
  onSelectNote: (id: string | null) => void
}

export default function Terrain3D({
  project,
  notes,
  selectedNoteId,
  quality,
  cameraRevision,
  cameraScale,
  focusRequest,
  activePeakId,
  onSelectNote,
}: Terrain3DProps) {
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
        focusRequest={focusRequest}
        activePeakId={activePeakId}
        onSelectNote={onSelectNote}
      />
    </Canvas>
  )
}
