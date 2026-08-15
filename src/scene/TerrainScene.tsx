import { Html, OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/app-store'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  FloatType,
  Group,
  LinearFilter,
  MathUtils,
  MOUSE,
  NormalBlending,
  RedFormat,
  ShaderMaterial,
  Sphere,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  TOUCH,
} from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { QualityLevel, TerrainNote, TerrainPeak, TerrainSnapshot, VisualDimension } from '../domain/types'
import { temperatureColor, type NoteActivitySummary } from '../domain/activity-temperature'
import { buildPlateCollisions, plateColor, primaryAreaForNote, type PlateBridge, type PlateCollision } from '../domain/knowledge-plates'
import { sampleHeight } from '../pipeline/terrain'
import { linkedNotes } from '../domain/knowledge-maintenance'
import { getLiveTimeline } from '../store/app-store'
import {
  TERRAIN_CAMERA_POSITION,
  TERRAIN_CAMERA_TARGET,
  TERRAIN_DEPTH,
  TERRAIN_HEIGHT,
  TERRAIN_WIDTH,
} from './terrain-config'
import { TerrainMist } from './TerrainMist'
import { getTerrainQualityProfile, TERRAIN_VISUAL_PROFILE } from './terrain-visual-profile'

interface TerrainSceneProps {
  snapshots: TerrainSnapshot[]
  gridSize: number
  notes: TerrainNote[]
  peaks: TerrainPeak[]
  selectedNoteId: string | null
  quality: QualityLevel
  cameraRevision: number
  cameraScale: number
  cameraInteractionMode: 'rotate' | 'pan'
  visualDimension: VisualDimension
  activityByNote: ReadonlyMap<string, NoteActivitySummary>
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

const POINT_LOW = new Color(TERRAIN_VISUAL_PROFILE.colors.pointLow)
const POINT_HIGH = new Color(TERRAIN_VISUAL_PROFILE.colors.pointHigh)
const POINT_SELECTED = new Color(TERRAIN_VISUAL_PROFILE.colors.selected)

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

function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return reducedMotion
}

export function TerrainScene(props: TerrainSceneProps) {
  const { cameraRevision, cameraScale, cameraInteractionMode, quality, focusRequest, activePeakId } = props
  const reducedMotion = usePrefersReducedMotion()
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
  const mouseButtons = useMemo(
    () => cameraInteractionMode === 'pan'
      ? { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }
      : { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN },
    [cameraInteractionMode],
  )
  const touches = useMemo(
    () => cameraInteractionMode === 'pan'
      ? { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE }
      : { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN },
    [cameraInteractionMode],
  )

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
      <color attach="background" args={[TERRAIN_VISUAL_PROFILE.colors.background]} />
      <fog attach="fog" args={[TERRAIN_VISUAL_PROFILE.colors.background, 8.7, 15.2]} />
      <TerrainField />
      <TerrainSurface
        {...props}
        compactLabels={compactLabels}
        peakLabelLimit={peakLabelLimit}
        reducedMotion={reducedMotion}
      />
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
        mouseButtons={mouseButtons}
        touches={touches}
        screenSpacePanning
        target={[cameraTarget.x, cameraTarget.y, cameraTarget.z]}
      />
      {quality !== 'low' && (
        <EffectComposer multisampling={0}>
          <Bloom
            intensity={TERRAIN_VISUAL_PROFILE.post.bloomIntensity[quality]}
            luminanceThreshold={TERRAIN_VISUAL_PROFILE.post.bloomThreshold}
            luminanceSmoothing={TERRAIN_VISUAL_PROFILE.post.bloomSmoothing}
          />
          <Vignette
            eskil={false}
            offset={TERRAIN_VISUAL_PROFILE.post.vignetteOffset}
            darkness={TERRAIN_VISUAL_PROFILE.post.vignetteDarkness}
          />
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
        <lineBasicMaterial color={TERRAIN_VISUAL_PROFILE.colors.fieldGrid} transparent opacity={0.42} />
      </lineSegments>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.145, 0]}>
        <planeGeometry args={[18, 18]} />
        <meshBasicMaterial color={TERRAIN_VISUAL_PROFILE.colors.field} />
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
  reducedMotion,
  visualDimension,
  activityByNote,
}: TerrainSceneProps & { compactLabels: boolean; peakLabelLimit: number; reducedMotion: boolean }) {
  const heightAtlas = useMemo(() => buildHeightAtlas(snapshots, gridSize), [gridSize, snapshots])
  const heightAtlasSize = useMemo(
    () => new Vector2(heightAtlas.width, heightAtlas.height),
    [heightAtlas],
  )
  const geometry = useMemo(() => buildSurfaceGeometry(gridSize), [gridSize])
  const material = useMemo(() => makeTerrainMaterial(quality, heightAtlas), [heightAtlas, quality])
  const visiblePeaks = selectVisiblePeaks(peaks, peakLabelLimit, compactLabels)

  useFrame(({ clock }) => {
    material.uniforms.uTimeline.value = getLiveTimeline()
    material.uniforms.uTime.value = reducedMotion ? 0 : clock.elapsedTime
  })

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => () => heightAtlas.texture.dispose(), [heightAtlas])

  return (
    <group>
      <mesh geometry={geometry}>
        <primitive object={material} attach="material" />
      </mesh>
      {getTerrainQualityProfile(quality).useMist && (
        <TerrainMist
          heightTexture={heightAtlas.texture}
          heightAtlasSize={heightAtlasSize}
          atlasColumns={heightAtlas.columns}
          heightGridSize={heightAtlas.gridSize}
          heightFrameCount={heightAtlas.frameCount}
          quality={quality}
          reducedMotion={reducedMotion}
        />
      )}
      <NotePoints
        snapshots={snapshots}
        gridSize={gridSize}
        notes={notes}
        heightAtlas={heightAtlas}
        peaks={peaks}
        quality={quality}
        reducedMotion={reducedMotion}
        selectedNoteId={selectedNoteId}
        onSelectNote={onSelectNote}
        visualDimension={visualDimension}
        activityByNote={activityByNote}
      />
      <SelectedMarker
        snapshots={snapshots}
        gridSize={gridSize}
        note={notes.find((note) => note.id === selectedNoteId)}
      />
      {visualDimension === 'area' && <PlateBridgeLines snapshots={snapshots} gridSize={gridSize} notes={notes} />}
      <SelectedRelationLines snapshots={snapshots} gridSize={gridSize} notes={notes} selectedNoteId={selectedNoteId} />
      {quality !== 'low' && (
        <PeakField
          snapshots={snapshots}
          gridSize={gridSize}
          notes={notes}
          peaks={visiblePeaks}
          compact={compactLabels}
          reducedMotion={reducedMotion}
          onSelectNote={onSelectNote}
        />
      )}
    </group>
  )
}

function PlateBridgeLines({ snapshots, gridSize, notes }: { snapshots: TerrainSnapshot[]; gridSize: number; notes: TerrainNote[] }) {
  const collisions = useMemo(() => buildPlateCollisions(notes), [notes])
  const bridges = collisions.filter((collision) => collision.mode === 'lines').flatMap((collision) => collision.bridges)
  const bands = collisions.filter((collision) => collision.mode === 'band')
  const activeCollisionId = useAppStore((state) => state.activeCollisionId)
  const selectCollision = useAppStore((state) => state.selectCollision)
  return <>
    <PlateBridgeLayer bridges={bridges} snapshots={snapshots} gridSize={gridSize} notes={notes} />
    {bands.map((collision) => (
      <PlateCollisionBand
        key={collision.id}
        collision={collision}
        snapshots={snapshots}
        gridSize={gridSize}
        active={collision.id === activeCollisionId}
        onSelect={() => selectCollision(collision.id)}
      />
    ))}
  </>
}

const COLLISION_BAND_SEGMENTS = 12

function PlateCollisionBand({
  collision,
  snapshots,
  gridSize,
  active,
  onSelect,
}: {
  collision: PlateCollision
  snapshots: TerrainSnapshot[]
  gridSize: number
  active: boolean
  onSelect: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const tooltip = useRef<Group>(null)
  const geometry = useMemo(() => {
    const value = new BufferGeometry()
    value.setAttribute('position', new BufferAttribute(new Float32Array((COLLISION_BAND_SEGMENTS + 1) * 6), 3))
    const indices: number[] = []
    for (let index = 0; index < COLLISION_BAND_SEGMENTS; index += 1) {
      const offset = index * 2
      indices.push(offset, offset + 1, offset + 2, offset + 2, offset + 1, offset + 3)
    }
    value.setIndex(indices)
    return value
  }, [])
  useFrame(() => {
    const frame = resolveSnapshotFrame(snapshots, getLiveTimeline())
    const attribute = geometry.getAttribute('position') as BufferAttribute
    const positions = attribute.array as Float32Array
    const fromX = collision.firstAnchor.x * (TERRAIN_WIDTH / 2)
    const fromZ = -collision.firstAnchor.y * (TERRAIN_DEPTH / 2)
    const toX = collision.secondAnchor.x * (TERRAIN_WIDTH / 2)
    const toZ = -collision.secondAnchor.y * (TERRAIN_DEPTH / 2)
    const length = Math.max(0.001, Math.hypot(toX - fromX, toZ - fromZ))
    const halfWidth = 0.005 + collision.strength * 0.012
    const perpendicularX = (-(toZ - fromZ) / length) * halfWidth
    const perpendicularZ = ((toX - fromX) / length) * halfWidth
    for (let index = 0; index <= COLLISION_BAND_SEGMENTS; index += 1) {
      const ratio = index / COLLISION_BAND_SEGMENTS
      const normalizedX = MathUtils.lerp(collision.firstAnchor.x, collision.secondAnchor.x, ratio)
      const normalizedY = MathUtils.lerp(collision.firstAnchor.y, collision.secondAnchor.y, ratio)
      const height = MathUtils.lerp(
        sampleHeight(frame.a.values, gridSize, normalizedX, normalizedY),
        sampleHeight(frame.b.values, gridSize, normalizedX, normalizedY),
        frame.mix,
      ) * TERRAIN_HEIGHT + 0.018
      const centerX = MathUtils.lerp(fromX, toX, ratio)
      const centerZ = MathUtils.lerp(fromZ, toZ, ratio)
      const offset = index * 6
      positions[offset] = centerX + perpendicularX
      positions[offset + 1] = height
      positions[offset + 2] = centerZ + perpendicularZ
      positions[offset + 3] = centerX - perpendicularX
      positions[offset + 4] = height
      positions[offset + 5] = centerZ - perpendicularZ
      if (index === Math.floor(COLLISION_BAND_SEGMENTS / 2) && tooltip.current) {
        tooltip.current.position.set(centerX, height + 0.08, centerZ)
      }
    }
    attribute.needsUpdate = true
    geometry.computeBoundingSphere()
  })
  useEffect(() => () => {
    geometry.dispose()
    document.body.style.cursor = ''
  }, [geometry])
  return <>
    <mesh
      geometry={geometry}
      renderOrder={4}
      onPointerOver={(event) => {
        event.stopPropagation()
        setHovered(true)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        setHovered(false)
        document.body.style.cursor = ''
      }}
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
    >
      <meshBasicMaterial color={active ? '#fff0a8' : '#d7c27e'} transparent opacity={active ? 0.56 : hovered ? 0.42 : 0.22} side={DoubleSide} depthWrite={false} />
    </mesh>
    <group ref={tooltip}>
      {hovered && <Html center className="collision-tooltip"><strong>{collision.firstArea} × {collision.secondArea}</strong><span>{collision.relationCount} 条跨域 WikiLink</span></Html>}
    </group>
  </>
}

function PlateBridgeLayer({
  bridges,
  snapshots,
  gridSize,
  notes,
}: {
  bridges: PlateBridge[]
  snapshots: TerrainSnapshot[]
  gridSize: number
  notes: TerrainNote[]
}) {
  const geometry = useMemo(() => new BufferGeometry(), [])
  const notesById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes])
  const positions = useMemo(() => new Float32Array(bridges.length * 6), [bridges.length])
  useFrame(() => {
    const attribute = geometry.getAttribute('position') as BufferAttribute | undefined
    if (!attribute) {
      geometry.setAttribute('position', new BufferAttribute(positions, 3))
      return
    }
    const frame = resolveSnapshotFrame(snapshots, getLiveTimeline())
    for (let index = 0; index < bridges.length; index += 1) {
      const bridge = bridges[index]
      const from = notesById.get(bridge.fromId)
      const to = notesById.get(bridge.toId)
      if (!from || !to) continue
      const fromHeight = MathUtils.lerp(sampleHeight(frame.a.values, gridSize, from.x, from.y), sampleHeight(frame.b.values, gridSize, from.x, from.y), frame.mix)
      const toHeight = MathUtils.lerp(sampleHeight(frame.a.values, gridSize, to.x, to.y), sampleHeight(frame.b.values, gridSize, to.x, to.y), frame.mix)
      const offset = index * 6
      positions[offset] = from.x * (TERRAIN_WIDTH / 2)
      positions[offset + 1] = fromHeight * TERRAIN_HEIGHT + 0.012
      positions[offset + 2] = -from.y * (TERRAIN_DEPTH / 2)
      positions[offset + 3] = to.x * (TERRAIN_WIDTH / 2)
      positions[offset + 4] = toHeight * TERRAIN_HEIGHT + 0.012
      positions[offset + 5] = -to.y * (TERRAIN_DEPTH / 2)
    }
    attribute.needsUpdate = true
    geometry.computeBoundingSphere()
  })
  useEffect(() => () => geometry.dispose(), [geometry])
  if (!bridges.length) return null
  return <lineSegments geometry={geometry}><lineBasicMaterial color="#d7c27e" transparent opacity={0.72} depthWrite={false} /></lineSegments>
}

function SelectedRelationLines({ snapshots, gridSize, notes, selectedNoteId }: { snapshots: TerrainSnapshot[]; gridSize: number; notes: TerrainNote[]; selectedNoteId: string | null }) {
  const geometry = useMemo(() => new BufferGeometry(), [])
  const related = useMemo(() => selectedNoteId ? linkedNotes(notes, selectedNoteId) : [], [notes, selectedNoteId])
  const positions = useMemo(() => new Float32Array(Math.max(0, related.length) * 6), [related.length])
  useFrame(() => {
    const line = geometry.getAttribute('position') as BufferAttribute | undefined
    if (!line) {
      geometry.setAttribute('position', new BufferAttribute(positions, 3))
      return
    }
    const frame = resolveSnapshotFrame(snapshots, getLiveTimeline())
    const origin = notes.find((note) => note.id === selectedNoteId)
    if (!origin) return
    for (let index = 0; index < related.length; index += 1) {
      const target = related[index]
      const originHeight = MathUtils.lerp(sampleHeight(frame.a.values, gridSize, origin.x, origin.y), sampleHeight(frame.b.values, gridSize, origin.x, origin.y), frame.mix)
      const targetHeight = MathUtils.lerp(sampleHeight(frame.a.values, gridSize, target.x, target.y), sampleHeight(frame.b.values, gridSize, target.x, target.y), frame.mix)
      const offset = index * 6
      positions[offset] = origin.x * (TERRAIN_WIDTH / 2)
      positions[offset + 1] = originHeight * TERRAIN_HEIGHT - 0.015
      positions[offset + 2] = -origin.y * (TERRAIN_DEPTH / 2)
      positions[offset + 3] = target.x * (TERRAIN_WIDTH / 2)
      positions[offset + 4] = targetHeight * TERRAIN_HEIGHT - 0.015
      positions[offset + 5] = -target.y * (TERRAIN_DEPTH / 2)
    }
    line.needsUpdate = true
    geometry.computeBoundingSphere()
  })
  useEffect(() => () => geometry.dispose(), [geometry])
  if (!selectedNoteId || !related.length) return null
  return <lineSegments geometry={geometry}><lineBasicMaterial color="#9b8ad9" transparent opacity={0.62} depthWrite={false} /></lineSegments>
}

function NotePoints({
  snapshots,
  gridSize,
  notes,
  heightAtlas,
  peaks,
  quality,
  reducedMotion,
  selectedNoteId,
  onSelectNote,
  visualDimension,
  activityByNote,
}: Pick<TerrainSceneProps, 'snapshots' | 'gridSize' | 'notes' | 'selectedNoteId' | 'onSelectNote' | 'quality' | 'visualDimension' | 'activityByNote'> & {
  heightAtlas: HeightAtlas
  peaks: TerrainPeak[]
  reducedMotion: boolean
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
        peaks,
        visualDimension,
        activityByNote,
      ),
    [activityByNote, birthFrames, heightFrames, initialFrame.aIndex, initialFrame.bIndex, initialFrame.mix, notes, peaks, visualDimension],
  )
  const material = useMemo(() => makeNoteMaterial(heightAtlas, quality), [heightAtlas, quality])
  const lastRaycastBucket = useRef(Number.NaN)

  useFrame(({ gl, size, clock }) => {
    const timeline = getLiveTimeline()
    material.uniforms.uTimeline.value = timeline
    material.uniforms.uVisibleBucket.value = Math.ceil(timeline)
    material.uniforms.uScale.value = size.height * gl.getPixelRatio() * 0.5
    material.uniforms.uTime.value = reducedMotion ? 0 : clock.elapsedTime

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
        <meshBasicMaterial color={TERRAIN_VISUAL_PROFILE.colors.selected} transparent opacity={0.86} />
      </mesh>
      <mesh position={[0, 0.008, 0]}>
        <sphereGeometry args={[0.012, 10, 8]} />
        <meshBasicMaterial color={TERRAIN_VISUAL_PROFILE.colors.selected} />
      </mesh>
    </group>
  )
}

function PeakField({
  snapshots,
  gridSize,
  notes,
  peaks,
  compact,
  reducedMotion,
  onSelectNote,
}: {
  snapshots: TerrainSnapshot[]
  gridSize: number
  notes: TerrainNote[]
  peaks: TerrainPeak[]
  compact: boolean
  reducedMotion: boolean
  onSelectNote: (id: string | null) => void
}) {
  const labels = useRef<Array<HTMLDivElement | null>>([])
  const projected = useMemo(() => new Vector3(), [])
  const setActivePeak = useAppStore((state) => state.setActivePeak)
  const activePeakId = useAppStore((state) => state.activePeakId)
  const geometry = useMemo(() => buildPeakGeometry(peaks, notes), [notes, peaks])
  const coreMaterial = useMemo(() => makePeakMaterial(false), [])
  const glowMaterial = useMemo(() => makePeakMaterial(true), [])
  const peakPositions = useMemo(
    () => (geometry.getAttribute('position') as BufferAttribute).array as Float32Array,
    [geometry],
  )
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
  useFrame(({ camera, clock, gl, size }) => {
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
      }
      ;(geometry.getAttribute('position') as BufferAttribute).needsUpdate = true
      lastTimeline.current = timeline
    }

    const pixelScale = size.height * gl.getPixelRatio() * 0.5
    coreMaterial.uniforms.uScale.value = pixelScale
    glowMaterial.uniforms.uScale.value = pixelScale
    coreMaterial.uniforms.uTime.value = reducedMotion ? 0 : clock.elapsedTime
    glowMaterial.uniforms.uTime.value = reducedMotion ? 0 : clock.elapsedTime

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
    const hasUnpositionedLabel = labels.current.some(
      (label) => label !== null && label.style.transform.length === 0,
    )
    if ((!projectionChanged && !hasUnpositionedLabel) || clock.elapsedTime < nextLabelUpdate.current) return

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
    nextLabelUpdate.current = clock.elapsedTime + 1 / 30
  })

  useEffect(() => {
    const selected = (geometry.getAttribute('selected') as BufferAttribute).array as Float32Array
    for (let index = 0; index < peaks.length; index += 1) {
      selected[index] = peaks[index].id === activePeakId ? 1 : 0
    }
    ;(geometry.getAttribute('selected') as BufferAttribute).needsUpdate = true
  }, [activePeakId, geometry, peaks])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => {
    coreMaterial.dispose()
    glowMaterial.dispose()
  }, [coreMaterial, glowMaterial])

  const edgeThreshold = compact ? 0.3 : 0.55
  return (
    <>
      <points geometry={geometry} material={glowMaterial} renderOrder={2} />
      <points geometry={geometry} material={coreMaterial} renderOrder={3} />
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
  const profile = getTerrainQualityProfile(quality)
  const highQualityNormal = quality === 'high'
    ? `
        vec2 texel = vec2(1.0 / max(1.0, uHeightGridSize - 1.0));
        float heightLeft = sampleTimelineHeight(terrainPosition - vec2(texel.x, 0.0));
        float heightRight = sampleTimelineHeight(terrainPosition + vec2(texel.x, 0.0));
        float heightNear = sampleTimelineHeight(terrainPosition - vec2(0.0, texel.y));
        float heightFar = sampleTimelineHeight(terrainPosition + vec2(0.0, texel.y));
        float worldStepX = ${TERRAIN_WIDTH.toFixed(1)} / max(1.0, uHeightGridSize - 1.0);
        float worldStepZ = ${TERRAIN_DEPTH.toFixed(1)} / max(1.0, uHeightGridSize - 1.0);
        float slopeX = (heightRight - heightLeft) * uTerrainHeight / (2.0 * worldStepX);
        float slopeZ = (heightNear - heightFar) * uTerrainHeight / (2.0 * worldStepZ);
        vec3 objectNormal = normalize(vec3(-slopeX, 1.0, -slopeZ));
        vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
        vSlope = clamp(1.0 - objectNormal.y, 0.0, 1.0);
        vCurvature = max(0.0, (vHeight * 4.0 - heightLeft - heightRight - heightNear - heightFar) * 4.0);
      `
    : `
        vWorldNormal = vec3(0.0, 1.0, 0.0);
        vSlope = 0.0;
        vCurvature = 0.0;
      `
  const fragmentNormal = quality === 'medium'
    ? `
        vec3 worldNormal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
        if (!gl_FrontFacing) worldNormal *= -1.0;
        float slope = clamp(1.0 - abs(worldNormal.y), 0.0, 1.0);
      `
    : `
        vec3 worldNormal = normalize(vWorldNormal);
        float slope = vSlope;
      `
  const dynamicReflection = profile.useDynamicTerrain
    ? `
        float reflectionPhase = vWorldPosition.z * 0.72 + vWorldPosition.x * 1.18 - uTime * ${TERRAIN_VISUAL_PROFILE.terrain.reflectionSpeed.toFixed(3)};
        float reflectionBand = pow(0.5 + 0.5 * sin(reflectionPhase), 8.0)
          * smoothstep(0.18, 0.82, vHeight)
          * (0.35 + slope * 0.65);
      `
    : 'float reflectionBand = 0.0;'

  return new ShaderMaterial({
    side: DoubleSide,
    fog: true,
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        ...heightAtlasUniforms(atlas),
        uTerrainHeight: { value: TERRAIN_HEIGHT },
        uTime: { value: 0 },
        uContourLevels: { value: profile.contourLevels },
        uContourOpacity: { value: profile.contourOpacity },
        uLow: { value: new Color(TERRAIN_VISUAL_PROFILE.colors.terrainLow) },
        uMiddle: { value: new Color(TERRAIN_VISUAL_PROFILE.colors.terrainMiddle) },
        uHigh: { value: new Color(TERRAIN_VISUAL_PROFILE.colors.terrainHigh) },
        uContour: { value: new Color(TERRAIN_VISUAL_PROFILE.colors.contour) },
      },
    ]),
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      uniform float uTerrainHeight;
      varying float vHeight;
      varying float vSlope;
      varying float vCurvature;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      ${HEIGHT_ATLAS_SHADER}

      void main() {
        vec2 terrainPosition = vec2(
          position.x / ${TERRAIN_WIDTH.toFixed(1)} + 0.5,
          -position.z / ${TERRAIN_DEPTH.toFixed(1)} + 0.5
        );
        vHeight = sampleTimelineHeight(terrainPosition);
        ${highQualityNormal}
        vec3 transformed = position;
        transformed.y = vHeight * uTerrainHeight - 0.09;
        vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
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
      uniform float uTime;
      varying float vHeight;
      varying float vSlope;
      varying float vCurvature;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;

      void main() {
        ${fragmentNormal}
        ${dynamicReflection}
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        vec3 lightDirection = normalize(vec3(-0.38, 0.78, 0.5));
        float slopeLight = max(dot(worldNormal, lightDirection), 0.0);
        float fresnel = pow(1.0 - max(dot(worldNormal, viewDirection), 0.0), 3.0);
        float ridge = smoothstep(0.006, 0.085, vCurvature);
        float valleyOcclusion = (1.0 - smoothstep(0.1, 0.42, vHeight)) * 0.08;
        float distanceFade = 1.0 - smoothstep(7.0, 14.0, distance(cameraPosition, vWorldPosition));

        vec3 base = mix(uLow, uMiddle, smoothstep(0.02, 0.58, vHeight));
        base = mix(base, uHigh, smoothstep(0.62, 1.0, vHeight));
        float materialLight = 0.72
          + slopeLight * 0.26
          + ridge * 0.13
          + reflectionBand * ${TERRAIN_VISUAL_PROFILE.terrain.reflectionAmount.toFixed(3)}
          + fresnel * ${TERRAIN_VISUAL_PROFILE.terrain.fresnelAmount.toFixed(3)}
          - valleyOcclusion;
        base *= materialLight;

        float contourCoordinate = vHeight * uContourLevels;
        float contourDistance = abs(fract(contourCoordinate + 0.5) - 0.5);
        float contourWidth = max(fwidth(contourCoordinate) * 0.82, 0.004);
        float contour = 1.0 - smoothstep(contourWidth, contourWidth * 2.4, contourDistance);
        float contourWeight = contour
          * uContourOpacity
          * mix(0.42, 1.0, slope)
          * smoothstep(0.1, 0.3, vHeight)
          * distanceFade;
        gl_FragColor = vec4(mix(base, uContour, contourWeight), 1.0);
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
  peaks: TerrainPeak[],
  visualDimension: VisualDimension,
  activityByNote: ReadonlyMap<string, NoteActivitySummary>,
): BufferGeometry {
  const geometry = new BufferGeometry()
  const positions = new Float32Array(notes.length * 3)
  const selected = new Float32Array(notes.length)
  const importance = new Float32Array(notes.length)
  const freshness = new Float32Array(notes.length)
  const peakAffinity = new Float32Array(notes.length)
  const mastery = new Float32Array(notes.length)
  const visualValue = new Float32Array(notes.length)
  const visualMode = new Float32Array(notes.length)
  const visualColor = new Float32Array(notes.length * 3)
  const seed = new Float32Array(notes.length)
  const weightRange = numericRange(notes.map((note) => note.weight))
  const timestampRange = numericRange(notes.map((note) => note.createdAtMs))
  for (let index = 0; index < notes.length; index += 1) {
    const note = notes[index]
    const offset = index * 3
    const height = MathUtils.lerp(heightsA[index], heightsB[index], mix)
    positions[offset] = note.x * (TERRAIN_WIDTH / 2)
    positions[offset + 1] = height * TERRAIN_HEIGHT - 0.055
    positions[offset + 2] = -note.y * (TERRAIN_DEPTH / 2)
    importance[index] = normalizeRange(note.weight, weightRange.min, weightRange.max, 0.5)
    freshness[index] = normalizeRange(
      note.createdAtMs,
      timestampRange.min,
      timestampRange.max,
      0.5,
    )
    peakAffinity[index] = resolvePeakAffinity(note, peaks)
    mastery[index] = note.mastery ?? 0.5
    visualValue[index] = dimensionValue(note, visualDimension, activityByNote)
    visualMode[index] = dimensionMode(visualDimension)
    const color = dimensionColor(note, visualDimension, activityByNote)
    visualColor[offset] = color.r
    visualColor[offset + 1] = color.g
    visualColor[offset + 2] = color.b
    seed[index] = stableUnitHash(note.id)
  }
  const selectedAttribute = new BufferAttribute(selected, 1)
  selectedAttribute.setUsage(DynamicDrawUsage)
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('birthFrame', new BufferAttribute(birthFrames, 1))
  geometry.setAttribute('importance', new BufferAttribute(importance, 1))
  geometry.setAttribute('freshness', new BufferAttribute(freshness, 1))
  geometry.setAttribute('peakAffinity', new BufferAttribute(peakAffinity, 1))
  geometry.setAttribute('mastery', new BufferAttribute(mastery, 1))
  geometry.setAttribute('visualValue', new BufferAttribute(visualValue, 1))
  geometry.setAttribute('visualMode', new BufferAttribute(visualMode, 1))
  geometry.setAttribute('visualColor', new BufferAttribute(visualColor, 3))
  geometry.setAttribute('seed', new BufferAttribute(seed, 1))
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

function makeNoteMaterial(atlas: HeightAtlas, quality: QualityLevel): ShaderMaterial {
  const maximumPixels = quality === 'high'
    ? TERRAIN_VISUAL_PROFILE.points.maximumPixels
    : quality === 'medium'
      ? 6.5
      : 5.2
  return new ShaderMaterial({
    transparent: true,
    depthWrite: true,
    fog: true,
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        ...heightAtlasUniforms(atlas),
        uVisibleBucket: { value: 0 },
        uTime: { value: 0 },
        uTerrainHeight: { value: TERRAIN_HEIGHT },
        uPointSize: { value: TERRAIN_VISUAL_PROFILE.points.baseSize },
        uScale: { value: 480 },
        uMinimumPixels: { value: TERRAIN_VISUAL_PROFILE.points.minimumPixels },
        uMaximumPixels: { value: maximumPixels },
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
      attribute float importance;
      attribute float freshness;
      attribute float peakAffinity;
      attribute float mastery;
      attribute float visualValue;
      attribute float visualMode;
      attribute vec3 visualColor;
      attribute float seed;
      uniform float uVisibleBucket;
      uniform float uTime;
      uniform float uTerrainHeight;
      uniform float uPointSize;
      uniform float uScale;
      uniform float uMinimumPixels;
      uniform float uMaximumPixels;
      varying float vHeight;
      varying float vSelected;
      varying float vVisible;
      varying float vImportance;
      varying float vFreshness;
      varying float vPeakAffinity;
      varying float vMastery;
      varying float vVisualValue;
      varying float vVisualMode;
      varying vec3 vVisualColor;
      varying float vSeed;
      varying float vDepthFade;
      ${HEIGHT_ATLAS_SHADER}

      void main() {
        vec2 terrainPosition = vec2(
          position.x / ${TERRAIN_WIDTH.toFixed(1)} + 0.5,
          -position.z / ${TERRAIN_DEPTH.toFixed(1)} + 0.5
        );
        vHeight = sampleTimelineHeight(terrainPosition);
        vSelected = selected;
        vVisible = step(birthFrame, uVisibleBucket);
        vImportance = importance;
        vFreshness = freshness;
        vPeakAffinity = peakAffinity;
        vMastery = mastery;
        vVisualValue = visualValue;
        vVisualMode = visualMode;
        vVisualColor = visualColor;
        vSeed = seed;
        vec3 transformed = position;
        transformed.y = vHeight * uTerrainHeight - 0.055;
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float hierarchy = mix(0.78, 1.28, importance)
          * mix(0.9, 1.12, freshness)
          * mix(0.88, 1.18, peakAffinity);
        float pulse = 1.0 + freshness * (0.025 + peakAffinity * 0.035)
          * sin(uTime * 0.55 + seed * 6.2831853);
        float pointPixels = uPointSize * (uScale / max(0.1, -mvPosition.z)) * hierarchy * pulse * mix(0.92, 1.08, mastery);
        gl_PointSize = vVisible * clamp(pointPixels, uMinimumPixels, uMaximumPixels);
        vDepthFade = 1.0 - smoothstep(7.0, 14.0, -mvPosition.z);
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
      varying float vImportance;
      varying float vFreshness;
      varying float vPeakAffinity;
      varying float vMastery;
      varying float vVisualValue;
      varying float vVisualMode;
      varying vec3 vVisualColor;
      varying float vSeed;
      varying float vDepthFade;

      void main() {
        if (vVisible < 0.5) discard;
        float distanceToCenter = length(gl_PointCoord - vec2(0.5));
        float edge = max(fwidth(distanceToCenter), 0.012);
        float alpha = 1.0 - smoothstep(0.46 - edge, 0.5 + edge, distanceToCenter);
        if (alpha < 0.02) discard;
        float hierarchy = vImportance * 0.44 + vFreshness * 0.18 + vPeakAffinity * 0.38;
        float heightMix = smoothstep(0.28, 0.82, vHeight * 0.72 + hierarchy * 0.38);
        vec3 color = mix(uLow, uHigh, heightMix);
        if (vVisualMode > 0.5 && vVisualMode < 1.5) color = mix(vec3(0.25, 0.23, 0.32), vec3(0.84, 0.94, 0.87), vVisualValue);
        if (vVisualMode > 1.5 && vVisualMode < 2.5) color = mix(vec3(0.24, 0.3, 0.33), vec3(0.88, 0.58, 0.3), vVisualValue);
        if (vVisualMode > 2.5) color = vVisualColor;
        float freshLight = vFreshness * (0.025 + 0.025 * sin(vSeed * 6.2831853));
        color *= 0.82 + hierarchy * 0.24 + freshLight;
        color = mix(color, uSelected, vSelected);
        float opacity = alpha * mix(0.5, 1.0, vMastery) * mix(0.62, 1.0, hierarchy) * mix(0.62, 1.0, vDepthFade);
        gl_FragColor = vec4(color, opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
}

function buildPeakGeometry(peaks: TerrainPeak[], notes: TerrainNote[]): BufferGeometry {
  const geometry = new BufferGeometry()
  const positions = new Float32Array(peaks.length * 3)
  const strength = new Float32Array(peaks.length)
  const selected = new Float32Array(peaks.length)
  const seed = new Float32Array(peaks.length)
  const noteById = new Map(notes.map((note) => [note.id, note]))
  const heightRange = numericRange(peaks.map((peak) => peak.height))
  const countRange = numericRange(peaks.map((peak) => Math.log1p(peak.noteIds.length)))
  const dateRange = numericRange(notes.map((note) => note.createdAtMs))

  for (let index = 0; index < peaks.length; index += 1) {
    const peak = peaks[index]
    const height = normalizeRange(peak.height, heightRange.min, heightRange.max, 0.5)
    const noteCount = normalizeRange(
      Math.log1p(peak.noteIds.length),
      countRange.min,
      countRange.max,
      0.5,
    )
    let newestTimestamp = dateRange.min
    for (const noteId of peak.noteIds) {
      newestTimestamp = Math.max(newestTimestamp, noteById.get(noteId)?.createdAtMs ?? dateRange.min)
    }
    const freshness = normalizeRange(newestTimestamp, dateRange.min, dateRange.max, 0.5)
    const confidenceProxy = height * 0.68 + noteCount * 0.32
    strength[index] = MathUtils.clamp(
      height * 0.4 + noteCount * 0.3 + freshness * 0.2 + confidenceProxy * 0.1,
      0,
      1,
    )
    seed[index] = stableUnitHash(peak.id)
  }

  const positionAttribute = new BufferAttribute(positions, 3)
  positionAttribute.setUsage(DynamicDrawUsage)
  const selectedAttribute = new BufferAttribute(selected, 1)
  selectedAttribute.setUsage(DynamicDrawUsage)
  geometry.setAttribute('position', positionAttribute)
  geometry.setAttribute('strength', new BufferAttribute(strength, 1))
  geometry.setAttribute('selected', selectedAttribute)
  geometry.setAttribute('seed', new BufferAttribute(seed, 1))
  geometry.boundingSphere = new Sphere(
    new Vector3(0, TERRAIN_HEIGHT * 0.5, 0),
    Math.hypot(TERRAIN_WIDTH * 0.5, TERRAIN_DEPTH * 0.5, TERRAIN_HEIGHT * 0.5) + 0.5,
  )
  return geometry
}

function makePeakMaterial(glow: boolean): ShaderMaterial {
  const pointSize = glow
    ? TERRAIN_VISUAL_PROFILE.peaks.glowSize
    : TERRAIN_VISUAL_PROFILE.peaks.coreSize
  const minimumPixels = glow ? 18 : 2.2
  const maximumPixels = glow ? 94 : 9.5
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: true,
    blending: glow ? AdditiveBlending : NormalBlending,
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uScale: { value: 480 },
        uTime: { value: 0 },
        uPointSize: { value: pointSize },
        uMinimumPixels: { value: minimumPixels },
        uMaximumPixels: { value: maximumPixels },
        uOpacity: {
          value: glow ? TERRAIN_VISUAL_PROFILE.peaks.glowOpacity : 1,
        },
        uColor: { value: new Color(TERRAIN_VISUAL_PROFILE.colors.peak) },
        uSelected: { value: new Color(TERRAIN_VISUAL_PROFILE.colors.selected) },
      },
    ]),
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      attribute float strength;
      attribute float selected;
      attribute float seed;
      uniform float uScale;
      uniform float uTime;
      uniform float uPointSize;
      uniform float uMinimumPixels;
      uniform float uMaximumPixels;
      varying float vStrength;
      varying float vSelected;

      void main() {
        vStrength = strength;
        vSelected = selected;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float pulse = 1.0 + sin(uTime * 0.42 + seed * 6.2831853) * 0.035;
        float hierarchy = mix(0.54, 1.18, strength) * mix(1.0, 1.2, selected);
        float pointPixels = uPointSize * (uScale / max(0.1, -mvPosition.z)) * hierarchy * pulse;
        gl_PointSize = clamp(pointPixels, uMinimumPixels, uMaximumPixels);
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uOpacity;
      uniform vec3 uColor;
      uniform vec3 uSelected;
      varying float vStrength;
      varying float vSelected;

      void main() {
        float radial = length(gl_PointCoord - vec2(0.5)) * 2.0;
        ${glow
          ? 'float alpha = pow(max(0.0, 1.0 - radial), 2.4) * uOpacity * mix(0.42, 1.0, vStrength);'
          : 'float alpha = 1.0 - smoothstep(0.72, 1.0, radial);'}
        if (alpha < 0.008) discard;
        vec3 color = mix(uColor, uSelected, vSelected);
        color *= mix(0.72, 1.12, vStrength);
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
}

function numericRange(values: number[]): { min: number; max: number } {
  if (!values.length) return { min: 0, max: 1 }
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (value < min) min = value
    if (value > max) max = value
  }
  return { min, max }
}

function normalizeRange(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value) || max - min < Number.EPSILON) return fallback
  return MathUtils.clamp((value - min) / (max - min), 0, 1)
}

function dimensionValue(
  note: TerrainNote,
  dimension: VisualDimension,
  activityByNote: ReadonlyMap<string, NoteActivitySummary>,
): number {
  if (dimension === 'mastery') return note.mastery ?? 0.5
  if (dimension === 'exploration') return note.exploration ?? 0.5
  if (dimension === 'temperature') return activityByNote.get(note.id)?.score ?? 0
  return 0.5
}

function dimensionMode(dimension: VisualDimension): number {
  if (dimension === 'mastery') return 1
  if (dimension === 'exploration') return 2
  if (dimension === 'area') return 3
  if (dimension === 'temperature') return 4
  return 0
}

function dimensionColor(
  note: TerrainNote,
  dimension: VisualDimension,
  activityByNote: ReadonlyMap<string, NoteActivitySummary>,
): Color {
  if (dimension === 'temperature') return new Color(temperatureColor(activityByNote.get(note.id)?.score ?? 0))
  if (dimension === 'area') {
    const area = primaryAreaForNote(note)
    return new Color(area ? plateColor(area) : '#767673')
  }
  return new Color('#8a918f')
}

function resolvePeakAffinity(note: TerrainNote, peaks: TerrainPeak[]): number {
  if (!peaks.length) return 0.35
  let nearest = Number.POSITIVE_INFINITY
  for (const peak of peaks) {
    nearest = Math.min(nearest, Math.hypot(note.x - peak.x, note.y - peak.y))
  }
  return 1 - MathUtils.smoothstep(nearest, 0.08, 0.72)
}

function stableUnitHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
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
