import { Html, OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '../store/app-store'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  FloatType,
  Group,
  LinearFilter,
  MathUtils,
  MeshBasicMaterial,
  RedFormat,
  ShaderMaterial,
  Sphere,
  SphereGeometry,
  SpriteMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
} from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { QualityLevel, TerrainNote, TerrainPeak, TerrainSnapshot } from '../domain/types'
import { sampleHeight } from '../pipeline/terrain'
import { getLiveTimeline } from '../store/app-store'
import {
  TERRAIN_CAMERA_POSITION,
  TERRAIN_CAMERA_TARGET,
  TERRAIN_DEPTH,
  TERRAIN_HEIGHT,
  TERRAIN_WIDTH,
} from './terrain-config'

interface TerrainSceneProps {
  snapshots: TerrainSnapshot[]
  gridSize: number
  notes: TerrainNote[]
  peaks: TerrainPeak[]
  selectedNoteId: string | null
  quality: QualityLevel
  cameraRevision: number
  cameraScale: number
  focusRequest: { noteId: string; revision: number } | null
  activePeakId: string | null
  onSelectNote: (id: string | null) => void
}

interface SnapshotFrame {
  aIndex: number
  bIndex: number
  mix: number
  a: TerrainSnapshot
  b: TerrainSnapshot
}

interface HeightAtlas {
  texture: DataTexture
  columns: number
  width: number
  height: number
  frameCount: number
  gridSize: number
}

const POINT_LOW = new Color('#9b9a95')
const POINT_HIGH = new Color('#bcb8a8')
const POINT_SELECTED = new Color('#fff2b8')

const HEIGHT_ATLAS_SHADER = `
  uniform sampler2D uHeightAtlas;
  uniform vec2 uHeightAtlasSize;
  uniform float uAtlasColumns;
  uniform float uHeightGridSize;
  uniform float uHeightFrameCount;
  uniform float uTimeline;

  float sampleHeightFrame(vec2 normalizedPosition, float frameIndex) {
    float safeFrame = clamp(frameIndex, 0.0, uHeightFrameCount - 1.0);
    vec2 tile = vec2(mod(safeFrame, uAtlasColumns), floor(safeFrame / uAtlasColumns));
    vec2 gridPixel = clamp(normalizedPosition, 0.0, 1.0) * (uHeightGridSize - 1.0);
    vec2 atlasPixel = tile * uHeightGridSize + gridPixel + vec2(0.5);
    return texture2D(uHeightAtlas, atlasPixel / uHeightAtlasSize).r;
  }

  float sampleTimelineHeight(vec2 normalizedPosition) {
    float safeTimeline = clamp(uTimeline, 0.0, uHeightFrameCount - 1.0);
    float frameA = floor(safeTimeline);
    float frameB = min(uHeightFrameCount - 1.0, frameA + 1.0);
    return mix(
      sampleHeightFrame(normalizedPosition, frameA),
      sampleHeightFrame(normalizedPosition, frameB),
      fract(safeTimeline)
    );
  }
`

export function TerrainScene(props: TerrainSceneProps) {
  const { cameraRevision, cameraScale, quality, focusRequest, activePeakId } = props
  const controls = useRef<OrbitControlsImpl>(null)
  const previousScale = useRef(cameraScale)
  const previousRevision = useRef<number | null>(null)
  const previousViewportScale = useRef<number | null>(null)
  const focusStart = useRef<number | null>(null)
  const focusFlight = useRef<{
    fromPosition: Vector3
    toPosition: Vector3
    fromTarget: Vector3
    toTarget: Vector3
  } | null>(null)
  const handledFocusRevision = useRef<number | null>(null)
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const viewportScale = Math.min(1.45, Math.max(1, 828 / size.width))
  const compactLabels = viewportScale > 1.1
  const cameraTarget = useMemo(() => {
    const [, y, z] = TERRAIN_CAMERA_TARGET
    return new Vector3(compactLabels ? 0 : TERRAIN_CAMERA_TARGET[0], y, z)
  }, [compactLabels])
  const homePosition = useMemo(() => {
    const baseOffset = new Vector3(...TERRAIN_CAMERA_POSITION).sub(new Vector3(...TERRAIN_CAMERA_TARGET))
    return baseOffset.multiplyScalar(viewportScale).add(cameraTarget)
  }, [cameraTarget, viewportScale])
  const peakLabelLimit = quality === 'high' ? (compactLabels ? 18 : 30) : quality === 'medium' ? 18 : 0

  useEffect(() => {
    if (cameraRevision !== previousRevision.current || viewportScale !== previousViewportScale.current) {
      camera.position.copy(homePosition)
      controls.current?.target.copy(cameraTarget)
      controls.current?.update()
      previousRevision.current = cameraRevision
      previousViewportScale.current = viewportScale
      previousScale.current = cameraScale
      focusStart.current = null
      focusFlight.current = null
      handledFocusRevision.current = null
      return
    }
    if (cameraScale === previousScale.current) return
    const target = controls.current?.target ?? cameraTarget
    const offset = camera.position.clone().sub(target)
    const distance = MathUtils.clamp(
      offset.length() * (previousScale.current / cameraScale),
      4.2,
      18,
    )
    camera.position.copy(target).add(offset.setLength(distance))
    controls.current?.update()
    previousScale.current = cameraScale
  }, [camera, cameraRevision, cameraScale, cameraTarget, homePosition, viewportScale])

  useFrame((_, delta) => {
    const controlsInstance = controls.current
    const request = focusRequest
    if (!request || !controlsInstance) {
      focusStart.current = null
      focusFlight.current = null
      return
    }
    if (handledFocusRevision.current === request.revision) return

    const note = props.notes.find((candidate) => candidate.id === request.noteId)
    if (focusFlight.current === null) {
      if (!note) {
        handledFocusRevision.current = request.revision
        return
      }
      const frame = resolveSnapshotFrame(props.snapshots, getLiveTimeline())
      const height = MathUtils.lerp(
        sampleHeight(frame.a.values, props.gridSize, note.x, note.y),
        sampleHeight(frame.b.values, props.gridSize, note.x, note.y),
        frame.mix,
      )
      const world = new Vector3(
        note.x * (TERRAIN_WIDTH / 2),
        height * TERRAIN_HEIGHT,
        -note.y * (TERRAIN_DEPTH / 2),
      )
      const currentTarget = controlsInstance.target.clone()
      const currentPosition = camera.position.clone()
      const offset = currentPosition.clone().sub(currentTarget)
      const distance = MathUtils.clamp(offset.length() * 0.42, 3.0, 9.5)
      focusFlight.current = {
        fromPosition: currentPosition,
        toPosition: world.clone().add(offset.setLength(distance)),
        fromTarget: currentTarget,
        toTarget: world,
      }
      focusStart.current = 0
      return
    }

    focusStart.current = (focusStart.current ?? 0) + Math.min(delta, 0.05)
    const progress = Math.min(1, (focusStart.current ?? 0) / 0.85)
    const eased = 1 - Math.pow(1 - progress, 3)
    camera.position.lerpVectors(focusFlight.current.fromPosition, focusFlight.current.toPosition, eased)
    controlsInstance.target.lerpVectors(focusFlight.current.fromTarget, focusFlight.current.toTarget, eased)
    controlsInstance.update()
    if (progress >= 1) {
      handledFocusRevision.current = request.revision
      focusFlight.current = null
      focusStart.current = null
    }
  })

  return (
    <>
      <color attach="background" args={['#141414']} />
      <fog attach="fog" args={['#141414', 9.2, 15.5]} />
      <TerrainField />
      <TerrainSurface {...props} compactLabels={compactLabels} peakLabelLimit={peakLabelLimit} />
      <PeakPath
        snapshots={props.snapshots}
        gridSize={props.gridSize}
        notes={props.notes}
        peaks={props.peaks}
        activePeakId={activePeakId}
      />
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.075}
        minDistance={4.2}
        maxDistance={18}
        minPolarAngle={0.42}
        maxPolarAngle={1.34}
        target={[cameraTarget.x, cameraTarget.y, cameraTarget.z]}
      />
      {quality !== 'low' && (
        <EffectComposer multisampling={0}>
          <Bloom intensity={quality === 'high' ? 0.42 : 0.32} luminanceThreshold={0.62} luminanceSmoothing={0.7} />
          <Vignette eskil={false} offset={0.26} darkness={0.34} />
        </EffectComposer>
      )}
    </>
  )
}

function TerrainField() {
  const crosses = useMemo(() => buildCrossFieldGeometry(), [])
  useEffect(() => () => crosses.dispose(), [crosses])

  return (
    <group>
      <lineSegments geometry={crosses} position={[0, -0.125, 0]}>
        <lineBasicMaterial color="#3a3a39" transparent opacity={0.5} />
      </lineSegments>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.145, 0]}>
        <planeGeometry args={[18, 18]} />
        <meshBasicMaterial color="#141414" />
      </mesh>
    </group>
  )
}

function TerrainSurface({
  snapshots,
  gridSize,
  notes,
  peaks,
  selectedNoteId,
  quality,
  compactLabels,
  peakLabelLimit,
  onSelectNote,
}: TerrainSceneProps & { compactLabels: boolean; peakLabelLimit: number }) {
  const heightAtlas = useMemo(() => buildHeightAtlas(snapshots, gridSize), [gridSize, snapshots])
  const geometry = useMemo(() => buildSurfaceGeometry(gridSize), [gridSize])
  const material = useMemo(() => makeTerrainMaterial(quality, heightAtlas), [heightAtlas, quality])
  const visiblePeaks = selectVisiblePeaks(peaks, peakLabelLimit, compactLabels)

  useFrame(() => {
    material.uniforms.uTimeline.value = getLiveTimeline()
  })

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => () => heightAtlas.texture.dispose(), [heightAtlas])

  return (
    <group>
      <mesh geometry={geometry}>
        <primitive object={material} attach="material" />
      </mesh>
      <NotePoints
        snapshots={snapshots}
        gridSize={gridSize}
        notes={notes}
        heightAtlas={heightAtlas}
        selectedNoteId={selectedNoteId}
        onSelectNote={onSelectNote}
      />
      <SelectedMarker
        snapshots={snapshots}
        gridSize={gridSize}
        note={notes.find((note) => note.id === selectedNoteId)}
      />
      {quality !== 'low' && (
        <PeakField
          snapshots={snapshots}
          gridSize={gridSize}
          peaks={visiblePeaks}
          compact={compactLabels}
          onSelectNote={onSelectNote}
        />
      )}
    </group>
  )
}

function NotePoints({
  snapshots,
  gridSize,
  notes,
  heightAtlas,
  selectedNoteId,
  onSelectNote,
}: Pick<TerrainSceneProps, 'snapshots' | 'gridSize' | 'notes' | 'selectedNoteId' | 'onSelectNote'> & {
  heightAtlas: HeightAtlas
}) {
  const initialFrame = useMemo(
    () => resolveSnapshotFrame(snapshots, getLiveTimeline()),
    [snapshots],
  )
  const heightFrames = useMemo(
    () => snapshots.map((snapshot) => sampleNoteHeights(snapshot.values, gridSize, notes)),
    [gridSize, notes, snapshots],
  )
  const birthFrames = useMemo(() => resolveNoteBirthFrames(notes, snapshots), [notes, snapshots])
  const geometry = useMemo(
    () =>
      buildNoteGeometry(
        notes,
        heightFrames[initialFrame.aIndex],
        heightFrames[initialFrame.bIndex],
        initialFrame.mix,
        birthFrames,
      ),
    [birthFrames, heightFrames, initialFrame.aIndex, initialFrame.bIndex, initialFrame.mix, notes],
  )
  const material = useMemo(() => makeNoteMaterial(heightAtlas), [heightAtlas])
  const lastRaycastBucket = useRef(Number.NaN)

  useFrame(({ gl, size }) => {
    const timeline = getLiveTimeline()
    material.uniforms.uTimeline.value = timeline
    material.uniforms.uVisibleBucket.value = Math.ceil(timeline)
    material.uniforms.uScale.value = size.height * gl.getPixelRatio() * 0.5

    // The shader interpolates point height every frame. CPU positions only back raycasting,
    // so updating them per whole time bucket avoids rewriting the full point buffer while scrubbing.
    const visibleBucket = Math.ceil(timeline)
    if (visibleBucket === lastRaycastBucket.current) return
    const frame = resolveSnapshotFrame(snapshots, timeline)
    const heightsA = heightFrames[frame.aIndex]
    const heightsB = heightFrames[frame.bIndex]
    const positions = (geometry.getAttribute('position') as BufferAttribute).array as Float32Array
    for (let index = 0; index < notes.length; index += 1) {
      if (birthFrames[index] > visibleBucket) {
        positions[index * 3 + 1] = -100
        continue
      }
      const height = MathUtils.lerp(heightsA[index], heightsB[index], frame.mix)
      positions[index * 3 + 1] = height * TERRAIN_HEIGHT - 0.055
    }
    lastRaycastBucket.current = visibleBucket
  })

  useEffect(() => {
    const selected = (geometry.getAttribute('selected') as BufferAttribute).array as Float32Array
    for (let index = 0; index < notes.length; index += 1) {
      selected[index] = notes[index].id === selectedNoteId ? 1 : 0
    }
    const selectedAttribute = geometry.getAttribute('selected') as BufferAttribute
    selectedAttribute.needsUpdate = true
  }, [geometry, notes, selectedNoteId])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  return (
    <points
      geometry={geometry}
      material={material}
      onClick={(event) => {
        event.stopPropagation()
        if (
          event.index !== undefined &&
          birthFrames[event.index] <= Math.ceil(getLiveTimeline())
        ) {
          onSelectNote(notes[event.index]?.id ?? null)
        }
      }}
    />
  )
}

function PeakPath({
  snapshots,
  gridSize,
  notes,
  peaks,
  activePeakId,
}: {
  snapshots: TerrainSnapshot[]
  gridSize: number
  notes: TerrainNote[]
  peaks: TerrainPeak[]
  activePeakId: string | null
}) {
  const group = useRef<Group>(null)
  const line = useRef<Group>(null)
  const geometry = useMemo(() => new BufferGeometry(), [])
  const positions = useMemo(() => new Float32Array(0), [])
  const activePeak = peaks.find((peak) => peak.id === activePeakId)

  const peakNotes = useMemo(() => {
    if (!activePeak) return []
    const byId = new Map(notes.map((note) => [note.id, note]))
    return activePeak.noteIds.map((id) => byId.get(id)).filter((note): note is TerrainNote => Boolean(note))
  }, [activePeak, notes])

  const positionAttribute = useMemo(() => {
    const attribute = new BufferAttribute(positions, 3)
    attribute.setUsage(DynamicDrawUsage)
    return attribute
  }, [positions])
  geometry.setAttribute('position', positionAttribute)

  useFrame(() => {
    const target = group.current
    if (!target) return
    target.visible = Boolean(activePeak) && peakNotes.length >= 2
    if (!target.visible) return
    const frame = resolveSnapshotFrame(snapshots, getLiveTimeline())
    const pairCount = Math.max(0, peakNotes.length - 1)
    const needed = pairCount * 6
    if (geometry.getAttribute('position')?.count !== needed) {
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(needed), 3))
    }
    const array = (geometry.getAttribute('position') as BufferAttribute).array as Float32Array
    for (let index = 0; index < pairCount; index += 1) {
      const a = peakNotes[index]
      const b = peakNotes[index + 1]
      if (!a || !b) continue
      const heightA = MathUtils.lerp(
        sampleHeight(frame.a.values, gridSize, a.x, a.y),
        sampleHeight(frame.b.values, gridSize, a.x, a.y),
        frame.mix,
      )
      const heightB = MathUtils.lerp(
        sampleHeight(frame.a.values, gridSize, b.x, b.y),
        sampleHeight(frame.b.values, gridSize, b.x, b.y),
        frame.mix,
      )
      const offset = index * 6
      array[offset] = a.x * (TERRAIN_WIDTH / 2)
      array[offset + 1] = heightA * TERRAIN_HEIGHT + 0.02
      array[offset + 2] = -a.y * (TERRAIN_DEPTH / 2)
      array[offset + 3] = b.x * (TERRAIN_WIDTH / 2)
      array[offset + 4] = heightB * TERRAIN_HEIGHT + 0.02
      array[offset + 5] = -b.y * (TERRAIN_DEPTH / 2)
    }
    ;(geometry.getAttribute('position') as BufferAttribute).needsUpdate = true
  })

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <group ref={group}>
      <lineSegments ref={line} geometry={geometry}>
        <lineBasicMaterial color="#d7c27e" transparent opacity={0.5} />
      </lineSegments>
    </group>
  )
}

function SelectedMarker({
  snapshots,
  gridSize,
  note,
}: {
  snapshots: TerrainSnapshot[]
  gridSize: number
  note: TerrainNote | undefined
}) {
  const marker = useRef<Group>(null)

  useFrame(() => {
    if (!marker.current || !note) return
    const frame = resolveSnapshotFrame(snapshots, getLiveTimeline())
    const height = MathUtils.lerp(
      sampleHeight(frame.a.values, gridSize, note.x, note.y),
      sampleHeight(frame.b.values, gridSize, note.x, note.y),
      frame.mix,
    )
    marker.current.position.set(
      note.x * (TERRAIN_WIDTH / 2),
      height * TERRAIN_HEIGHT - 0.047,
      -note.y * (TERRAIN_DEPTH / 2),
    )
  })

  if (!note) return null
  return (
    <group ref={marker}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.043, 0.058, 32]} />
        <meshBasicMaterial color="#d7c27e" transparent opacity={0.86} />
      </mesh>
      <mesh position={[0, 0.008, 0]}>
        <sphereGeometry args={[0.012, 10, 8]} />
        <meshBasicMaterial color="#fff0b0" />
      </mesh>
    </group>
  )
}

function PeakField({
  snapshots,
  gridSize,
  peaks,
  compact,
  onSelectNote,
}: {
  snapshots: TerrainSnapshot[]
  gridSize: number
  peaks: TerrainPeak[]
  compact: boolean
  onSelectNote: (id: string | null) => void
}) {
  const groups = useRef<Array<Group | null>>([])
  const labels = useRef<Array<HTMLDivElement | null>>([])
  const projected = useMemo(() => new Vector3(), [])
  const glowTexture = useMemo(() => makeGlowTexture(), [])
  const beaconGeometry = useMemo(() => new SphereGeometry(0.012, 12, 10), [])
  const beaconMaterial = useMemo(() => new MeshBasicMaterial({ color: '#f1ead2' }), [])
  const setActivePeak = useAppStore((state) => state.setActivePeak)
  const activePeakId = useAppStore((state) => state.activePeakId)
  const peakPositions = useMemo(() => new Float32Array(peaks.length * 3), [peaks])
  const lastTimeline = useRef(Number.NaN)
  const nextLabelUpdate = useRef(0)
  const projectedView = useRef({
    cameraX: Number.NaN,
    cameraY: Number.NaN,
    cameraZ: Number.NaN,
    quaternionX: Number.NaN,
    quaternionY: Number.NaN,
    quaternionZ: Number.NaN,
    quaternionW: Number.NaN,
    width: 0,
    height: 0,
    timeline: Number.NaN,
  })
  const glowMaterial = useMemo(
    () =>
      new SpriteMaterial({
        map: glowTexture,
        color: '#e6dfc6',
        transparent: true,
        opacity: 0.23,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [glowTexture],
  )

  useFrame(({ camera, clock, size }) => {
    const timeline = getLiveTimeline()
    if (timeline !== lastTimeline.current) {
      const frame = resolveSnapshotFrame(snapshots, timeline)
      for (let index = 0; index < peaks.length; index += 1) {
        const peak = peaks[index]
        const height = MathUtils.lerp(
          sampleHeight(frame.a.values, gridSize, peak.x, peak.y),
          sampleHeight(frame.b.values, gridSize, peak.x, peak.y),
          frame.mix,
        )
        const offset = index * 3
        peakPositions[offset] = peak.x * (TERRAIN_WIDTH / 2)
        peakPositions[offset + 1] = height * TERRAIN_HEIGHT - 0.035
        peakPositions[offset + 2] = -peak.y * (TERRAIN_DEPTH / 2)
        groups.current[index]?.position.set(
          peakPositions[offset],
          peakPositions[offset + 1],
          peakPositions[offset + 2],
        )
      }
      lastTimeline.current = timeline
    }

    const previousView = projectedView.current
    const projectionChanged =
      previousView.timeline !== timeline ||
      previousView.cameraX !== camera.position.x ||
      previousView.cameraY !== camera.position.y ||
      previousView.cameraZ !== camera.position.z ||
      previousView.quaternionX !== camera.quaternion.x ||
      previousView.quaternionY !== camera.quaternion.y ||
      previousView.quaternionZ !== camera.quaternion.z ||
      previousView.quaternionW !== camera.quaternion.w ||
      previousView.width !== size.width ||
      previousView.height !== size.height
    if (!projectionChanged || clock.elapsedTime < nextLabelUpdate.current) return

    for (let index = 0; index < peaks.length; index += 1) {
      const offset = index * 3
      const label = labels.current[index]
      if (!label) continue
      projected
        .set(peakPositions[offset], peakPositions[offset + 1] + 0.22, peakPositions[offset + 2])
        .project(camera)
      const visible = projected.z >= -1 && projected.z <= 1
      const display = visible ? 'block' : 'none'
      if (label.style.display !== display) label.style.display = display
      if (!visible) continue
      const transform = `translate3d(${(projected.x * 0.5 + 0.5) * size.width}px, ${(-projected.y * 0.5 + 0.5) * size.height}px, 0) translate(-50%, -50%)`
      if (label.style.transform !== transform) label.style.transform = transform
    }
    projectedView.current = {
      cameraX: camera.position.x,
      cameraY: camera.position.y,
      cameraZ: camera.position.z,
      quaternionX: camera.quaternion.x,
      quaternionY: camera.quaternion.y,
      quaternionZ: camera.quaternion.z,
      quaternionW: camera.quaternion.w,
      width: size.width,
      height: size.height,
      timeline,
    }
    nextLabelUpdate.current = clock.elapsedTime + 1 / 60
  })

  useEffect(
    () => () => {
      glowTexture.dispose()
      beaconGeometry.dispose()
      beaconMaterial.dispose()
      glowMaterial.dispose()
    },
    [beaconGeometry, beaconMaterial, glowMaterial, glowTexture],
  )

  const edgeThreshold = compact ? 0.3 : 0.55
  return (
    <>
      {peaks.map((peak, index) => (
        <group
          key={peak.id}
          ref={(element) => {
            groups.current[index] = element
          }}
        >
          <sprite scale={[0.36, 0.36, 1]} position={[0, 0.055, 0]} material={glowMaterial} />
          <mesh position={[0, 0.028, 0]} geometry={beaconGeometry} material={beaconMaterial} />
        </group>
      ))}
      <Html fullscreen zIndexRange={[24, 0]} style={{ pointerEvents: 'none' }}>
        <div className="peak-label-layer">
          {peaks.map((peak, index) => (
            <div
              key={peak.id}
              className="peak-label-anchor"
              ref={(element) => {
                labels.current[index] = element
              }}
            >
              <button
                type="button"
                className={`peak-label${activePeakId === peak.id ? ' peak-label--active' : ''}${compact ? ' peak-label--compact' : ''}${peak.x < -edgeThreshold ? ' peak-label--left' : peak.x > edgeThreshold ? ' peak-label--right' : ''}`}
                onClick={(event) => {
                  event.stopPropagation()
                  if (activePeakId === peak.id) {
                    setActivePeak(null)
                    onSelectNote(null)
                    return
                  }
                  setActivePeak(peak.id)
                  onSelectNote(peak.noteIds[0] ?? null)
                }}
              >
                <span>{peak.label}</span>
                <small>{peak.noteIds.length}</small>
              </button>
            </div>
          ))}
        </div>
      </Html>
    </>
  )
}

function resolveSnapshotFrame(snapshots: TerrainSnapshot[], timeline: number): SnapshotFrame {
  const lastIndex = Math.max(0, snapshots.length - 1)
  const safeTimeline = Math.max(0, Math.min(lastIndex, timeline))
  const aIndex = Math.floor(safeTimeline)
  const bIndex = Math.min(lastIndex, aIndex + 1)
  return {
    aIndex,
    bIndex,
    mix: safeTimeline - aIndex,
    a: snapshots[aIndex],
    b: snapshots[bIndex],
  }
}

function resolveTimelineCutoff(snapshots: TerrainSnapshot[], timeline: number): number {
  if (!snapshots.length) return Number.POSITIVE_INFINITY
  const index = Math.min(snapshots.length - 1, Math.max(0, Math.ceil(timeline)))
  const bucket = snapshots[index].bucket
  if (bucket === 'empty') return Number.POSITIVE_INFINITY
  const [year, month] = bucket.split('-').map(Number)
  return Date.UTC(year, month, 1) - 1
}

function buildHeightAtlas(snapshots: TerrainSnapshot[], gridSize: number): HeightAtlas {
  const frameCount = Math.max(1, snapshots.length)
  const columns = Math.ceil(Math.sqrt(frameCount))
  const rows = Math.ceil(frameCount / columns)
  const width = columns * gridSize
  const height = rows * gridSize
  const data = new Float32Array(width * height)

  for (let frameIndex = 0; frameIndex < snapshots.length; frameIndex += 1) {
    const tileX = (frameIndex % columns) * gridSize
    const tileY = Math.floor(frameIndex / columns) * gridSize
    const values = snapshots[frameIndex].values
    for (let row = 0; row < gridSize; row += 1) {
      const sourceStart = row * gridSize
      const targetStart = (tileY + row) * width + tileX
      data.set(values.subarray(sourceStart, sourceStart + gridSize), targetStart)
    }
  }

  const texture = new DataTexture(data, width, height, RedFormat, FloatType)
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return { texture, columns, width, height, frameCount, gridSize }
}

function buildSurfaceGeometry(size: number): BufferGeometry {
  const geometry = new BufferGeometry()
  const positions = new Float32Array(size * size * 3)
  const indices: number[] = []
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 3
      positions[offset] = (x / (size - 1) - 0.5) * TERRAIN_WIDTH
      positions[offset + 2] = -(y / (size - 1) - 0.5) * TERRAIN_DEPTH
    }
  }
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const a = y * size + x
      const b = a + 1
      const c = a + size
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.boundingSphere = new Sphere(
    new Vector3(0, TERRAIN_HEIGHT * 0.5, 0),
    Math.hypot(TERRAIN_WIDTH * 0.5, TERRAIN_DEPTH * 0.5, TERRAIN_HEIGHT * 0.5) + 0.25,
  )
  return geometry
}

function makeTerrainMaterial(quality: QualityLevel, atlas: HeightAtlas): ShaderMaterial {
  return new ShaderMaterial({
    side: DoubleSide,
    fog: true,
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        ...heightAtlasUniforms(atlas),
        uTerrainHeight: { value: TERRAIN_HEIGHT },
        uContourLevels: { value: quality === 'high' ? 28 : quality === 'medium' ? 22 : 16 },
        uContourOpacity: { value: quality === 'low' ? 0.08 : 0.14 },
        uLow: { value: new Color('#141414') },
        uMiddle: { value: new Color('#1a1a19') },
        uHigh: { value: new Color('#24231f') },
        uContour: { value: new Color('#858580') },
      },
    ]),
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      uniform float uTerrainHeight;
      varying float vHeight;
      ${HEIGHT_ATLAS_SHADER}

      void main() {
        vec2 terrainPosition = vec2(
          position.x / ${TERRAIN_WIDTH.toFixed(1)} + 0.5,
          -position.z / ${TERRAIN_DEPTH.toFixed(1)} + 0.5
        );
        vHeight = sampleTimelineHeight(terrainPosition);
        vec3 transformed = position;
        transformed.y = vHeight * uTerrainHeight - 0.09;
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uContourLevels;
      uniform float uContourOpacity;
      uniform vec3 uLow;
      uniform vec3 uMiddle;
      uniform vec3 uHigh;
      uniform vec3 uContour;
      varying float vHeight;

      void main() {
        vec3 base = mix(uLow, uMiddle, smoothstep(0.02, 0.58, vHeight));
        base = mix(base, uHigh, smoothstep(0.58, 1.0, vHeight));
        float contourCoordinate = vHeight * uContourLevels;
        float contourDistance = abs(fract(contourCoordinate + 0.5) - 0.5);
        float contourWidth = max(fwidth(contourCoordinate) * 0.82, 0.004);
        float contour = 1.0 - smoothstep(contourWidth, contourWidth * 2.4, contourDistance);
        gl_FragColor = vec4(mix(base, uContour, contour * uContourOpacity), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
}

function heightAtlasUniforms(atlas: HeightAtlas) {
  return {
    uHeightAtlas: { value: atlas.texture },
    uHeightAtlasSize: { value: new Vector2(atlas.width, atlas.height) },
    uAtlasColumns: { value: atlas.columns },
    uHeightGridSize: { value: atlas.gridSize },
    uHeightFrameCount: { value: atlas.frameCount },
    uTimeline: { value: getLiveTimeline() },
  }
}

function buildNoteGeometry(
  notes: TerrainNote[],
  heightsA: Float32Array,
  heightsB: Float32Array,
  mix: number,
  birthFrames: Float32Array,
): BufferGeometry {
  const geometry = new BufferGeometry()
  const positions = new Float32Array(notes.length * 3)
  const selected = new Float32Array(notes.length)
  for (let index = 0; index < notes.length; index += 1) {
    const offset = index * 3
    const height = MathUtils.lerp(heightsA[index], heightsB[index], mix)
    positions[offset] = notes[index].x * (TERRAIN_WIDTH / 2)
    positions[offset + 1] = height * TERRAIN_HEIGHT - 0.055
    positions[offset + 2] = -notes[index].y * (TERRAIN_DEPTH / 2)
  }
  const selectedAttribute = new BufferAttribute(selected, 1)
  selectedAttribute.setUsage(DynamicDrawUsage)
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('birthFrame', new BufferAttribute(birthFrames, 1))
  geometry.setAttribute('selected', selectedAttribute)
  geometry.boundingSphere = new Sphere(
    new Vector3(0, TERRAIN_HEIGHT * 0.5, 0),
    Math.hypot(TERRAIN_WIDTH * 0.5, TERRAIN_DEPTH * 0.5, TERRAIN_HEIGHT * 0.5) + 0.25,
  )
  return geometry
}

function sampleNoteHeights(values: Float32Array, gridSize: number, notes: TerrainNote[]): Float32Array {
  const heights = new Float32Array(notes.length)
  for (let index = 0; index < notes.length; index += 1) {
    heights[index] = sampleHeight(values, gridSize, notes[index].x, notes[index].y)
  }
  return heights
}

function resolveNoteBirthFrames(notes: TerrainNote[], snapshots: TerrainSnapshot[]): Float32Array {
  const cutoffs = snapshots.map((_, index) => resolveTimelineCutoff(snapshots, index))
  const birthFrames = new Float32Array(notes.length)
  for (let noteIndex = 0; noteIndex < notes.length; noteIndex += 1) {
    const createdAt = notes[noteIndex].createdAtMs
    let frameIndex = Math.max(0, snapshots.length - 1)
    for (let snapshotIndex = 0; snapshotIndex < cutoffs.length; snapshotIndex += 1) {
      if (createdAt <= cutoffs[snapshotIndex]) {
        frameIndex = snapshotIndex
        break
      }
    }
    birthFrames[noteIndex] = frameIndex
  }
  return birthFrames
}

function makeNoteMaterial(atlas: HeightAtlas): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: true,
    fog: true,
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        ...heightAtlasUniforms(atlas),
        uVisibleBucket: { value: 0 },
        uTerrainHeight: { value: TERRAIN_HEIGHT },
        uPointSize: { value: 0.032 },
        uScale: { value: 480 },
        uLow: { value: POINT_LOW },
        uHigh: { value: POINT_HIGH },
        uSelected: { value: POINT_SELECTED },
      },
    ]),
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      attribute float birthFrame;
      attribute float selected;
      uniform float uVisibleBucket;
      uniform float uTerrainHeight;
      uniform float uPointSize;
      uniform float uScale;
      varying float vHeight;
      varying float vSelected;
      varying float vVisible;
      ${HEIGHT_ATLAS_SHADER}

      void main() {
        vec2 terrainPosition = vec2(
          position.x / ${TERRAIN_WIDTH.toFixed(1)} + 0.5,
          -position.z / ${TERRAIN_DEPTH.toFixed(1)} + 0.5
        );
        vHeight = sampleTimelineHeight(terrainPosition);
        vSelected = selected;
        vVisible = step(birthFrame, uVisibleBucket);
        vec3 transformed = position;
        transformed.y = vHeight * uTerrainHeight - 0.055;
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = vVisible * uPointSize * (uScale / max(0.1, -mvPosition.z));
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uLow;
      uniform vec3 uHigh;
      uniform vec3 uSelected;
      varying float vHeight;
      varying float vSelected;
      varying float vVisible;

      void main() {
        if (vVisible < 0.5) discard;
        float distanceToCenter = length(gl_PointCoord - vec2(0.5));
        float edge = max(fwidth(distanceToCenter), 0.012);
        float alpha = 1.0 - smoothstep(0.46 - edge, 0.5 + edge, distanceToCenter);
        if (alpha < 0.02) discard;
        float heightMix = smoothstep(0.34, 0.78, vHeight);
        vec3 color = mix(uLow, uHigh, heightMix);
        color = mix(color, uSelected, vSelected);
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
}

function selectVisiblePeaks(peaks: TerrainPeak[], limit: number, compact: boolean): TerrainPeak[] {
  const candidates = compact ? peaks.filter((peak) => Math.abs(peak.x) <= 0.58) : peaks
  if (candidates.length <= limit) return candidates
  return Array.from({ length: limit }, (_, index) => {
    const candidateIndex = Math.round((index * (candidates.length - 1)) / (limit - 1))
    return candidates[candidateIndex]
  })
}

function buildCrossFieldGeometry(): BufferGeometry {
  const positions: number[] = []
  const extent = 5.2
  const spacing = 0.42
  const armX = 0.035
  const armZ = 0.065
  for (let x = -extent; x <= extent; x += spacing) {
    for (let z = -extent; z <= extent; z += spacing) {
      positions.push(x - armX, 0, z, x + armX, 0, z)
      positions.push(x, 0, z - armZ, x, 0, z + armZ)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  return geometry
}

function makeGlowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 62)
    gradient.addColorStop(0, 'rgba(255, 250, 224, 1)')
    gradient.addColorStop(0.12, 'rgba(244, 231, 190, 0.8)')
    gradient.addColorStop(0.48, 'rgba(216, 204, 168, 0.22)')
    gradient.addColorStop(1, 'rgba(194, 184, 151, 0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, 128, 128)
  }
  const texture = new CanvasTexture(canvas)
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  return texture
}
