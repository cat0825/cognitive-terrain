import { lazy, memo, Suspense, useEffect, useMemo, useState } from 'react'
import type { QualityLevel, TerrainNote, TerrainProject, ViewMode, VisualDimension } from '../domain/types'
import { buildActivitySummaries } from '../domain/activity-temperature'
import { profileIdForVisualDimension } from '../domain/terrain-profile'
import { interpolateSnapshots, mixHeightValues } from '../pipeline/terrain'
import { runTerrainProfile } from '../pipeline/worker-client'
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
  const activityNowMs = useMemo(
    () => evaluationTimeForProject(project.updatedAt),
    [project.updatedAt],
  )
  const activityByNote = useMemo(
    () => buildActivitySummaries(project.notes, project.interactionEvents, activityNowMs, project.activityHistory?.aggregates),
    [activityNowMs, project.activityHistory?.aggregates, project.interactionEvents, project.notes],
  )
  const [profileTerrain, setProfileTerrain] = useState<Pick<TerrainProject, 'snapshots' | 'peaks'> | null>(null)
  const profileId = profileIdForVisualDimension(visualDimension)
  useEffect(() => {
    if (profileId === 'density') {
      setProfileTerrain(null)
      return
    }
    const cacheKey = `${profileId}:${project.interactionEvents.length}:${project.activityHistory?.aggregates.length ?? 0}:${activityNowMs}`
    const cached = profileTerrainCache.get(project.notes)?.get(cacheKey)
    if (cached) {
      setProfileTerrain(cached)
      return
    }
    setProfileTerrain(null)
    const handle = runTerrainProfile({
      type: 'build-terrain-profile',
      notes: project.notes,
      interactionEvents: project.interactionEvents,
      activityAggregates: project.activityHistory?.aggregates,
      gridSize: project.gridSize,
      timeZone: project.timeZone,
      nowMs: activityNowMs,
      elevation: profileId === 'mastery' || profileId === 'activity' || profileId === 'structure'
        ? profileId
        : 'exploration',
    })
    let active = true
    void handle.promise.then((terrain) => {
      if (!active) return
      const result = { snapshots: terrain.snapshots, peaks: terrain.peaks }
      let projectCache = profileTerrainCache.get(project.notes)
      if (!projectCache) {
        projectCache = new Map()
        profileTerrainCache.set(project.notes, projectCache)
      }
      projectCache.set(cacheKey, result)
      setProfileTerrain(result)
    }).catch((error) => {
      if (!active) return
      setProfileTerrain(null)
      const store = useAppStore.getState()
      store.reportError(`地形图层计算失败：${error instanceof Error ? error.message : String(error)}`)
      store.setVisualDimension('density')
    })
    return () => {
      active = false
      handle.cancel()
    }
  }, [activityNowMs, profileId, project.activityHistory?.aggregates, project.gridSize, project.interactionEvents, project.notes, project.timeZone])
  const terrainProject = useMemo(
    () => profileTerrain && profileId !== 'density'
      ? { ...project, ...profileTerrain, activeTerrainProfileId: profileId }
      : project,
    [profileId, profileTerrain, project],
  )
  useEffect(() => {
    if (use2d) return
    const timer = window.setTimeout(() => setWebglReady(true), 60)
    return () => window.clearTimeout(timer)
  }, [use2d])

  if (use2d || !webglReady) {
    return (
      <AnimatedTerrain2D
        project={terrainProject}
        notes={notes}
        selectedNoteId={selectedNoteId}
        visualDimension={visualDimension}
        activityByNote={activityByNote}
        onSelectNote={onSelectNote}
      />
    )
  }

  return (
    <Suspense
      fallback={
        <AnimatedTerrain2D
          project={terrainProject}
          notes={notes}
          selectedNoteId={selectedNoteId}
          visualDimension={visualDimension}
          activityByNote={activityByNote}
          onSelectNote={onSelectNote}
        />
      }
    >
      <Terrain3D
        project={terrainProject}
        notes={notes}
        selectedNoteId={selectedNoteId}
        quality={quality}
        visualDimension={visualDimension}
        activityByNote={activityByNote}
        cameraRevision={cameraRevision}
        cameraScale={cameraScale}
        focusRequest={focusRequest}
        activePeakId={activePeakId}
        onSelectNote={onSelectNote}
      />
    </Suspense>
  )
})

const profileTerrainCache = new WeakMap<TerrainNote[], Map<string, Pick<TerrainProject, 'snapshots' | 'peaks'>>>()

function AnimatedTerrain2D({
  project,
  notes,
  selectedNoteId,
  visualDimension,
  activityByNote,
  onSelectNote,
}: Pick<TerrainCanvasProps, 'project' | 'notes' | 'selectedNoteId' | 'visualDimension' | 'onSelectNote'> & {
  activityByNote: ReturnType<typeof buildActivitySummaries>
}) {
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
      prerequisiteTopology={project.prerequisiteTopology}
      activityByNote={activityByNote}
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

function evaluationTimeForProject(updatedAt: string): number {
  const projectTime = Date.parse(updatedAt)
  return Number.isFinite(projectTime) ? Math.max(Date.now(), projectTime) : Date.now()
}
