import { create } from 'zustand'
import type {
  AnalysisOptions,
  NoteInput,
  ProcessingProgress,
  ProjectBackupSummary,
  ProjectSummary,
  QualityLevel,
  CognitiveObservationProvenance,
  InteractionEvent,
  ExplorationSuggestion,
  TerrainProject,
  TerrainPeak,
  ViewMode,
  VisualDimension,
} from '../domain/types'
import { createDemoProject } from '../domain/demo'
import {
  commitAnalyzedProject,
  createInteractionEvent,
  eventTypeForNoteUpdate,
  normalizeActiveReferenceAtlasId,
} from '../domain/cognitive-state'
import { createCognitiveObservation } from '../domain/learning-progression'
import { shouldRecordOpenedEvent } from '../domain/activity-temperature'
import { areasForNote } from '../domain/knowledge-plates'
import {
  createTaxonomyNode,
  mergeTaxonomyNodes,
  renameTaxonomyNode,
  reparentTaxonomyNode,
  resolveTaxonomyAlias,
  validateTaxonomy,
} from '../domain/taxonomy'
import { bindReferenceAtlasToTaxonomy } from '../domain/reference-gaps'
import { migrateTerrainProjectToV3 } from '../domain/schema-v3'
import type { VaultSyncPreview, VaultSyncResolution } from '../domain/vault-sync'
import { TODAY_STUDY_PACK_NAME, todayStudyPack } from '../domain/study-pack'
import { runAnalysis, type AnalysisHandle } from '../pipeline/worker-client'
import { parseWikiLinks } from '../import/parse'
import {
  appendProjectInteractionEvent,
  createProjectBackup,
  deleteProject,
  getProject,
  listProjectBackups,
  listProjectSummaries,
  renameProject,
  restoreProjectBackup,
  saveProject,
  updateActiveReferenceAtlas,
} from '../storage/project-repository'
import { migrateProject } from '../storage/db'
import { createLatestRequestController } from './latest-request'

export type CameraInteractionMode = 'rotate' | 'pan'

type NoteUpdatePatch = {
  title?: string
  content?: string
  tags?: string[]
  mastery?: number | null
  confidence?: number | null
  exploration?: number | null
  status?: TerrainProject['notes'][number]['status'] | null
  area?: string | null
  areas?: string[] | null
  reviewedAt?: string | null
}

interface AppState {
  project: TerrainProject
  selectedNoteId: string | null
  search: string
  activeTags: string[]
  activeAreas: string[]
  viewMode: ViewMode
  quality: QualityLevel
  visualDimension: VisualDimension
  timeline: number
  importOpen: boolean
  filtersOpen: boolean
  detailsOpen: boolean
  libraryOpen: boolean
  projects: ProjectSummary[]
  backups: ProjectBackupSummary[]
  isAnalyzing: boolean
  progress: ProcessingProgress | null
  error: string | null
  cameraRevision: number
  cameraScale: number
  cameraInteractionMode: CameraInteractionMode
  focusRequest: { noteId: string; revision: number } | null
  activePeakId: string | null
  activePeak: TerrainPeak | null
  activeCollisionId: string | null
  activeGapNodeId: string | null
  compareRef: number | null
  firstRun: boolean
  dismissFirstRun: () => void
  lastAnalysis: { modelId: string; embeddingMode: 'semantic' | 'fallback'; device: string; elapsedMs: number } | null
  initialize: () => Promise<void>
  selectNote: (id: string | null) => void
  setSearch: (search: string) => void
  toggleTag: (tag: string) => void
  clearTags: () => void
  toggleArea: (area: string) => void
  clearAreas: () => void
  setViewMode: (mode: ViewMode) => void
  setQuality: (quality: QualityLevel) => void
  setVisualDimension: (dimension: VisualDimension) => void
  setReferenceAtlas: (id: string | undefined) => Promise<void>
  rebindReferenceAtlas: (id: string) => Promise<void>
  setTimeline: (timeline: number) => void
  setImportOpen: (open: boolean) => void
  setFiltersOpen: (open: boolean) => void
  setDetailsOpen: (open: boolean) => void
  setLibraryOpen: (open: boolean) => void
  setCameraScale: (scale: number) => void
  setCameraInteractionMode: (mode: CameraInteractionMode) => void
  resetCamera: () => void
  requestFocus: (noteId: string) => void
  setActivePeak: (peak: TerrainPeak | null) => void
  selectCollision: (collisionId: string | null) => void
  selectGap: (nodeId: string | null) => void
  setCompareRef: (bucketIndex: number | null) => void
  reportError: (message: string) => void
  dismissError: () => void
  startAnalysis: (
    name: string,
    notes: NoteInput[],
    options?: AnalysisOptions,
    commit?: AnalysisCommitContext,
  ) => Promise<void>
  loadStudyPack: () => Promise<void>
  mergeNotes: (newNotes: NoteInput[], options?: AnalysisOptions) => Promise<void>
  applyVaultSync: (
    preview: VaultSyncPreview,
    resolutions: VaultSyncResolution[],
  ) => Promise<boolean>
  commitVaultWritebackProject: (previous: TerrainProject, next: TerrainProject) => Promise<void>
  updateNote: (noteId: string, patch: NoteUpdatePatch, observation?: CognitiveObservationOptions) => Promise<void>
  markNoteReviewed: (noteId: string) => Promise<void>
  transitionExploration: (
    suggestion: ExplorationSuggestion,
    command:
      | { type: 'accept' | 'start' | 'complete' | 'dismiss' | 'reject'; note?: string }
      | { type: 'snooze'; note?: string; snoozedUntil: string },
  ) => Promise<void>
  editExploration: (
    suggestion: ExplorationSuggestion,
    patch: { actionTitle: string; actionDetail?: string; userNotes?: string },
  ) => Promise<void>
  cancelAnalysis: () => void
  replaceProject: (project: TerrainProject) => Promise<void>
  resetDemo: () => void
  openProject: (id: string) => Promise<void>
  renameCurrentProject: (name: string) => Promise<void>
  deleteProjectInLibrary: (id: string) => Promise<void>
  reloadProjects: () => Promise<void>
  createBackup: () => Promise<boolean>
  restoreBackup: (id: string) => Promise<boolean>
  reloadBackups: () => Promise<void>
  createTaxonomy: (input: { label: string; parentId?: string; aliases?: string[]; description?: string; assignItemIds?: string[] }) => Promise<void>
  renameTaxonomy: (nodeId: string, label: string) => Promise<void>
  reparentTaxonomy: (nodeId: string, parentId?: string) => Promise<void>
  mergeTaxonomy: (sourceNodeId: string, targetNodeId: string) => Promise<void>
}

interface AnalysisCommitContext {
  baseProject: TerrainProject
  events?: InteractionEvent[]
  vaultSync?: TerrainProject['vaultSync']
}

interface CognitiveObservationOptions {
  provenance?: Extract<CognitiveObservationProvenance, 'self-assessment' | 'review-outcome'>
  reason?: string
}

interface PerformanceControls {
  setTimeline: (timeline: number) => void
  setQuality: (quality: QualityLevel) => void
  setVisualDimension: (dimension: VisualDimension) => void
}

declare global {
  interface Window {
    __cognitiveTerrainPerf?: PerformanceControls
  }
}

const REFERENCE_ATLAS_PREFERENCE_PREFIX = 'cognitive-terrain:reference-atlas:'
const initialProject = applyStoredReferenceAtlasPreference(migrateProject(createDemoProject({ includeProgressionEvidence: true })))
let liveTimeline = Math.max(0, initialProject.snapshots.length - 1)

export function getLiveTimeline(): number {
  return liveTimeline
}

export const useAppStore = create<AppState>((set, get) => {
  const analyses = createLatestRequestController<AnalysisHandle>()
  return {
  project: initialProject,
  selectedNoteId: null,
  search: '',
  activeTags: [],
  activeAreas: [],
  viewMode: '3d',
  quality: 'high',
  visualDimension: 'density',
  timeline: Math.max(0, initialProject.snapshots.length - 1),
  importOpen: false,
  filtersOpen: false,
  detailsOpen: false,
  libraryOpen: false,
  projects: [],
  backups: [],
  isAnalyzing: false,
  progress: null,
  error: null,
  cameraRevision: 0,
  cameraScale: 192,
  cameraInteractionMode: 'rotate',
  focusRequest: null,
  activePeakId: null,
  activePeak: null,
  activeCollisionId: null,
  activeGapNodeId: null,
  compareRef: null,
  firstRun: localStorage.getItem('cognitive-terrain:first-run') === null,
  lastAnalysis: null,
  dismissFirstRun: () => {
    localStorage.setItem('cognitive-terrain:first-run', 'seen')
    set({ firstRun: false })
  },
  initialize: async () => {
    try {
      const [projectSummaries, backups] = await Promise.all([
        listProjectSummaries(),
        listProjectBackups(),
      ])
      if (projectSummaries.length) set({ projects: projectSummaries })
      if (backups.length) set({ backups })
      const lastProjectId = localStorage.getItem('cognitive-terrain:last-project')
      if (!lastProjectId) return
      const project = await getProject(lastProjectId)
      if (project) setProjectState(set, project)
    } catch {
      localStorage.removeItem('cognitive-terrain:last-project')
    }
  },
  selectNote: (selectedNoteId) => {
    const state = get()
    const occurredAt = new Date().toISOString()
    const event = selectedNoteId
      && selectedNoteId !== state.selectedNoteId
      && state.project.notes.some((note) => note.id === selectedNoteId)
      && shouldRecordOpenedEvent(state.project.interactionEvents, selectedNoteId, occurredAt)
      ? createInteractionEvent(selectedNoteId, 'opened', occurredAt)
      : undefined
    const project = event
      ? {
          ...state.project,
          updatedAt: new Date(Math.max(Date.parse(state.project.updatedAt) || 0, Date.parse(event.occurredAt))).toISOString(),
          interactionEvents: [...state.project.interactionEvents, event],
        }
      : state.project
    set({
      project,
      selectedNoteId,
      activePeakId: null,
      activePeak: null,
      activeCollisionId: null,
      activeGapNodeId: null,
      detailsOpen: selectedNoteId !== null,
    })
    if (event) {
      void appendProjectInteractionEvent(project.id, event).catch((error) => {
        set({ error: `活动记录保存失败：${error instanceof Error ? error.message : String(error)}` })
      })
    }
  },
  setSearch: (search) => set({ search }),
  toggleTag: (tag) =>
    set((state) => ({
      activeTags: state.activeTags.includes(tag)
        ? state.activeTags.filter((activeTag) => activeTag !== tag)
        : [...state.activeTags, tag],
    })),
  clearTags: () => set({ activeTags: [] }),
  toggleArea: (area) => set((state) => ({
    activeAreas: state.activeAreas.includes(area)
      ? state.activeAreas.filter((activeArea) => activeArea !== area)
      : [...state.activeAreas, area],
  })),
  clearAreas: () => set({ activeAreas: [] }),
  setViewMode: (viewMode) => set({ viewMode }),
  setQuality: (quality) => set({ quality }),
  setVisualDimension: (visualDimension) => set((state) => ({
    visualDimension,
    ...(state.activePeak ? {
      activePeak: null,
      activePeakId: null,
      detailsOpen: false,
    } : {}),
  })),
  setReferenceAtlas: async (id) => {
    const current = get().project
    const nextId = normalizeActiveReferenceAtlasId(current.referenceAtlases, id)
    const project = { ...current, activeReferenceAtlasId: nextId, updatedAt: new Date().toISOString() }
    const preferenceKey = `${REFERENCE_ATLAS_PREFERENCE_PREFIX}${project.id}`
    const previousPreference = localStorage.getItem(preferenceKey)
    if (nextId) localStorage.setItem(preferenceKey, nextId)
    else localStorage.removeItem(preferenceKey)
    // Atlas selection is a view preference. Update the in-memory project first so
    // the map and detail report respond immediately; persistence can finish in the
    // background without making the user wait for a full materialization rewrite.
    set({ project, activeGapNodeId: null })
    try {
      await updateActiveReferenceAtlas(project.id, nextId)
      await Promise.all([get().reloadProjects(), get().reloadBackups()])
    } catch (error) {
      if (get().project.id === project.id && get().project.activeReferenceAtlasId === nextId) {
        set({ project: current })
      }
      if (previousPreference === null) localStorage.removeItem(preferenceKey)
      else localStorage.setItem(preferenceKey, previousPreference)
      set({ error: `参考图谱选择保存失败：${error instanceof Error ? error.message : String(error)}` })
    }
  },
  rebindReferenceAtlas: async (id) => {
    const current = get().project
    const manifest = current.referenceAtlases?.find((atlas) => atlas.id === id)
    if (!manifest) {
      set({ error: `参考图谱不存在：${id}` })
      return
    }
    const taxonomyNodes = current.taxonomyNodes ?? []
    const taxonomyVersion = Math.max(
      current.taxonomyVersion ?? 0,
      taxonomyNodes.reduce((max, node) => Math.max(max, node.version), 0),
    )
    const now = taxonomyMutationTimestamp(current)
    const rebound = bindReferenceAtlasToTaxonomy(manifest, taxonomyNodes, taxonomyVersion, now)
    const project = {
      ...current,
      updatedAt: now,
      referenceAtlases: (current.referenceAtlases ?? []).map((atlas) => atlas.id === id ? rebound : atlas),
      activeReferenceAtlasId: id,
    }
    await persistTaxonomyProject(project, set, get)
  },
  setTimeline: (timeline) => {
    liveTimeline = timeline
    const state = get()
    const nextBucket = Math.ceil(timeline)
    if (state.viewMode === '2d' || nextBucket !== Math.ceil(state.timeline)) {
      set({ timeline })
    }
  },
  setImportOpen: (importOpen) => set({ importOpen }),
  setFiltersOpen: (filtersOpen) => set((state) => ({
    filtersOpen,
    firstRun: filtersOpen ? false : state.firstRun,
  })),
  setDetailsOpen: (detailsOpen) => set({ detailsOpen }),
  setLibraryOpen: (libraryOpen) => set({ libraryOpen }),
  setCameraScale: (cameraScale) => set({ cameraScale: Math.max(110, Math.min(260, cameraScale)) }),
  setCameraInteractionMode: (cameraInteractionMode) => set({ cameraInteractionMode }),
  resetCamera: () => set((state) => ({ cameraRevision: state.cameraRevision + 1, cameraScale: 192 })),
  requestFocus: (noteId) =>
    set((state) => ({ focusRequest: { noteId, revision: (state.focusRequest?.revision ?? 0) + 1 } })),
  setActivePeak: (activePeak) => set({
    activePeak,
    activePeakId: activePeak?.id ?? null,
    activeCollisionId: null,
    activeGapNodeId: null,
    selectedNoteId: null,
    detailsOpen: activePeak !== null,
  }),
  selectCollision: (activeCollisionId) => set({
    activeCollisionId,
    activePeakId: null,
    activePeak: null,
    selectedNoteId: null,
    activeGapNodeId: null,
    detailsOpen: activeCollisionId !== null,
  }),
  selectGap: (activeGapNodeId) => set({
    activeGapNodeId,
    activePeakId: null,
    activePeak: null,
    activeCollisionId: null,
    selectedNoteId: null,
    detailsOpen: activeGapNodeId !== null,
  }),
  setCompareRef: (compareRef) => set({ compareRef }),
  reportError: (error) => set({ error }),
  dismissError: () => set({ error: null }),
  startAnalysis: async (name, notes, options = {}, commit) => {
    if (!notes.length) {
      set({ error: '没有可分析的笔记' })
      return
    }
    const startedAt = performance.now()
    const generation = analyses.begin()
    set({
      isAnalyzing: true,
      progress: { stage: 'parsing', completed: 0, total: 1, message: '准备分析' },
      error: null,
      importOpen: false,
    })
    try {
      const analysis = runAnalysis(name, notes, options, (progress) => {
        if (analyses.isCurrent(generation)) set({ progress })
      })
      analyses.attach(generation, analysis)
      const analyzedProject = await analysis.promise
      if (!analyses.isCurrent(generation)) return
      const project = commit
        ? commitAnalyzedProject(analyzedProject, commit.baseProject, commit.events)
        : analyzedProject
      const committedProject = commit?.vaultSync
        ? {
            ...project,
            updatedAt: commit.vaultSync.vaults.reduce(
              (latest, vault) => vault.lastScannedAt > latest ? vault.lastScannedAt : latest,
              commit.baseProject.updatedAt,
            ),
            vaultSync: commit.vaultSync,
          }
        : project
      const embeddingMode: 'semantic' | 'fallback' =
        committedProject.embeddingMode === 'semantic' ? 'semantic' : 'fallback'
      if (commit?.vaultSync) {
        const normalizedProject = migrateProject(committedProject)
        const { saveVaultSyncProject } = await import('../storage/vault-sync-repository')
        // Same invariant as persistProject: the vault-sync transaction must commit
        // before the in-memory project moves, or a failed save would leave the UI
        // showing a synced terrain that was never written.
        try {
          await saveVaultSyncProject(commit.baseProject, normalizedProject)
        } catch (error) {
          const message = `Vault 同步保存失败，当前项目未切换：${error instanceof Error ? error.message : String(error)}`
          throw new Error(message, { cause: error })
        }
        if (!analyses.isCurrent(generation)) return
        localStorage.setItem('cognitive-terrain:last-project', normalizedProject.id)
        setProjectState(set, normalizedProject)
        // Refresh failures are reported separately: the sync itself already
        // committed, so treating this as a sync failure would be a lie.
        try {
          await Promise.all([get().reloadProjects(), get().reloadBackups()])
        } catch (error) {
          if (analyses.isCurrent(generation)) {
            set({ error: `Vault 同步已保存，但项目列表刷新失败：${error instanceof Error ? error.message : String(error)}` })
          }
        }
      } else {
        const normalizedProject = await persistProject(committedProject)
        if (!analyses.isCurrent(generation)) return
        localStorage.setItem('cognitive-terrain:last-project', normalizedProject.id)
        setProjectState(set, normalizedProject)
        try {
          await Promise.all([get().reloadProjects(), get().reloadBackups()])
        } catch (error) {
          if (analyses.isCurrent(generation)) {
            set({ error: `项目已保存，但项目列表刷新失败：${error instanceof Error ? error.message : String(error)}` })
          }
        }
      }
      if (analyses.isCurrent(generation)) {
        set({
          lastAnalysis: {
            modelId: committedProject.modelId,
            embeddingMode,
            device: options.embeddingStrategy === 'deterministic' ? 'local' : 'webgpu/wasm',
            elapsedMs: Math.round(performance.now() - startedAt),
          },
          isAnalyzing: false,
          progress: null,
        })
      }
    } catch (error) {
      if (!analyses.isCurrent(generation)) return
      set({
        isAnalyzing: false,
        progress: null,
        error: error instanceof Error ? error.message : '分析失败',
      })
    } finally {
      analyses.clear(generation)
    }
  },
  loadStudyPack: () => {
    const forced = typeof localStorage !== 'undefined' ? localStorage.getItem('cognitive-terrain:embedding') : null
    const options =
      forced === 'deterministic' ? { embeddingStrategy: 'deterministic' as const } : {}
    return get().startAnalysis(TODAY_STUDY_PACK_NAME, todayStudyPack, options)
  },
  mergeNotes: async (newNotes, options = {}) => {
    const current = get().project
    const stateProvenance = new Map(current.cognitiveStates.map((state) => [state.itemId, state.provenance]))
    const existing: NoteInput[] = current.notes.map((note) => ({
      id: note.id,
      sourceId: note.sourceId,
      sourceKey: note.sourceKey,
      title: note.title,
      content: note.content,
      createdAt: note.createdAt,
      tags: note.tags,
      source: note.source,
      sourcePath: note.sourcePath,
      vault: note.vault,
      weight: note.weight,
      mastery: note.mastery,
      confidence: note.confidence,
      exploration: note.exploration,
      status: note.status,
      area: note.area,
      areas: note.areas,
      declaredAreas: note.declaredAreas,
      reviewedAt: note.reviewedAt,
      cognitiveStateProvenance: stateProvenance.get(note.id),
      links: note.links,
      prerequisites: note.prerequisites?.map((declaration) => ({ ...declaration })),
    }))
    const existingIds = new Set(existing.map((note) => note.id))
    const batchIds = new Set<string>()
    const duplicateBatchIds = new Set<string>()
    const deduped = newNotes.filter((note) => {
      const id = note.id?.trim()
      if (!id) return true
      if (batchIds.has(id)) duplicateBatchIds.add(id)
      batchIds.add(id)
      return !existingIds.has(id)
    })
    if (duplicateBatchIds.size) {
      set({ error: `导入批次包含重复笔记 ID：${[...duplicateBatchIds].sort().join('、')}` })
      return
    }
    if (!deduped.length) {
      set({ error: '没有新增笔记可合并' })
      return
    }
    const merged: NoteInput[] = [...existing, ...deduped]
    const effective = {
      ...options,
      embeddingStrategy: (options.embeddingStrategy ?? (current.embeddingMode === 'semantic' ? 'transformers' : 'deterministic')) as
        | 'transformers'
        | 'deterministic',
    }
    await get().startAnalysis(current.name, merged, effective, { baseProject: current })
  },
  applyVaultSync: async (preview, resolutions) => {
    const current = get().project
    try {
      const { applyVaultSync: applyVaultSyncPreview } = await import('../domain/vault-sync')
      const applied = applyVaultSyncPreview(current, preview, resolutions)
      if (!preview.bootstrap && preview.changes.length === 0) return true
      if (preview.changes.length === 0) {
        const sourceByItem = new Map(applied.state.sources.map((source) => [source.itemId, source]))
        const next: TerrainProject = {
          ...current,
          updatedAt: preview.scannedAt,
          notes: current.notes.map((note) => {
            const source = sourceByItem.get(note.id)
            return source ? {
              ...note,
              sourceId: source.sourceId,
              sourceKey: source.acceptedNote.sourceKey,
            } : note
          }),
          vaultSync: applied.state,
        }
        const normalized = migrateProject(next)
        const { saveVaultSyncProject } = await import('../storage/vault-sync-repository')
        await saveVaultSyncProject(current, normalized)
        // Only after the transaction commits, so a rejected save cannot leave the
        // terrain claiming sources it does not have.
        setProjectState(set, normalized)
        try {
          await Promise.all([get().reloadProjects(), get().reloadBackups()])
        } catch (error) {
          set({ error: `Vault 同步已保存，但项目列表刷新失败：${error instanceof Error ? error.message : String(error)}` })
        }
        return true
      }
      const effective = {
        embeddingStrategy: (current.embeddingMode === 'semantic' ? 'transformers' : 'deterministic') as
          | 'transformers'
          | 'deterministic',
      }
      await get().startAnalysis(current.name, applied.inputs, effective, {
        baseProject: current,
        events: applied.events,
        vaultSync: applied.state,
      })
      return get().error === null
    } catch (error) {
      set({ error: `Vault 同步失败：${error instanceof Error ? error.message : String(error)}` })
      return false
    }
  },
  commitVaultWritebackProject: async (previous, next) => {
    const current = get().project
    if (current.id !== previous.id || current.updatedAt !== previous.updatedAt) {
      throw new Error('项目已变化，请重新生成写回预览')
    }
    try {
      const { saveVaultWritebackProject } = await import('../storage/vault-sync-repository')
      await saveVaultWritebackProject(previous, next)
      const latest = get().project
      if (latest.id !== previous.id || latest.updatedAt !== previous.updatedAt) {
        throw new Error('项目在写回提交期间发生变化，请重新打开项目核对已保存状态')
      }
      localStorage.setItem('cognitive-terrain:last-project', next.id)
      setProjectState(set, migrateProject(next))
      await Promise.all([get().reloadProjects(), get().reloadBackups()])
    } catch (error) {
      const message = `Vault 写回状态保存失败：${error instanceof Error ? error.message : String(error)}`
      set({ error: message })
      throw new Error(message, { cause: error })
    }
  },
  updateNote: async (noteId, patch, observationOptions = {}) => {
    const current = get().project
    const target = current.notes.find((note) => note.id === noteId)
    if (!target) {
      set({ error: '笔记不存在' })
      return
    }
    const stateProvenance = new Map(current.cognitiveStates.map((state) => [state.itemId, state.provenance]))
    const changesCognitiveState = ['mastery', 'confidence', 'exploration', 'status', 'reviewedAt']
      .some((field) => field in patch)
    const inputs: NoteInput[] = current.notes.map((note) => {
      if (note.id !== noteId) {
        return {
          id: note.id,
          sourceId: note.sourceId,
          sourceKey: note.sourceKey,
          title: note.title,
          content: note.content,
          createdAt: note.createdAt,
          tags: note.tags,
          source: note.source,
          sourcePath: note.sourcePath,
          vault: note.vault,
          weight: note.weight,
          mastery: note.mastery,
          confidence: note.confidence,
          exploration: note.exploration,
          status: note.status,
          area: note.area,
          areas: note.areas,
          declaredAreas: note.declaredAreas,
          reviewedAt: note.reviewedAt,
          cognitiveStateProvenance: stateProvenance.get(note.id),
          links: note.links,
          prerequisites: note.prerequisites?.map((declaration) => ({ ...declaration })),
        }
      }
      const nextAreas = 'areas' in patch
        ? areasForNote({ areas: patch.areas ?? [] })
        : 'area' in patch
          ? areasForNote({ area: patch.area ?? undefined })
          : areasForNote(note)
      return {
        id: note.id,
        sourceId: note.sourceId,
        sourceKey: note.sourceKey,
        title: patch.title ?? note.title,
        content: patch.content ?? note.content,
        createdAt: note.createdAt,
        tags: patch.tags ?? note.tags,
        source: note.source,
        sourcePath: note.sourcePath,
        vault: note.vault,
        weight: note.weight,
        mastery: 'mastery' in patch ? patch.mastery ?? undefined : note.mastery,
        confidence: 'confidence' in patch ? patch.confidence ?? undefined : note.confidence,
        exploration: 'exploration' in patch ? patch.exploration ?? undefined : note.exploration,
        status: 'status' in patch ? patch.status ?? undefined : note.status,
        area: nextAreas[0],
        areas: nextAreas.length ? nextAreas : undefined,
        declaredAreas: 'areas' in patch || 'area' in patch ? [...nextAreas] : note.declaredAreas,
        reviewedAt: 'reviewedAt' in patch ? patch.reviewedAt ?? undefined : note.reviewedAt,
        cognitiveStateProvenance: changesCognitiveState ? 'app' : stateProvenance.get(note.id),
        links: patch.content === undefined ? note.links : parseWikiLinks(patch.content),
        prerequisites: note.prerequisites?.map((declaration) => ({ ...declaration })),
      }
    })
    const effective = {
      embeddingStrategy: (current.embeddingMode === 'semantic' ? 'transformers' : 'deterministic') as
        | 'transformers'
        | 'deterministic',
    }
    const changedFields = Object.keys(patch)
    const eventType = eventTypeForNoteUpdate(changedFields)
    const occurredAt = new Date().toISOString()
    const event = createInteractionEvent(noteId, eventType, occurredAt, { changedFields })
    const observations = cognitiveObservationsForUpdate(target, patch, observationOptions, occurredAt, event.id)
    const baseProject = observations.length > 0
      ? { ...current, cognitiveObservations: [...(current.cognitiveObservations ?? []), ...observations] }
      : current
    await get().startAnalysis(current.name, inputs, effective, { baseProject, events: [event] })
  },
  markNoteReviewed: async (noteId) => {
    const current = get().project
    const note = current.notes.find((candidate) => candidate.id === noteId)
    if (!note) {
      set({ error: '笔记不存在' })
      return
    }
    const occurredAt = new Date().toISOString()
    const event = createInteractionEvent(noteId, 'reviewed', occurredAt, { source: 'manual' })
    const observation = createCognitiveObservation({
      id: `${event.id}:reviewedAt`,
      itemId: noteId,
      field: 'reviewedAt',
      value: occurredAt,
      observedAt: occurredAt,
      provenance: 'review-outcome',
      reason: '手动标记已复习',
    })
    const existingState = current.cognitiveStates.find((state) => state.itemId === noteId)
    const cognitiveState = {
      ...existingState,
      itemId: noteId,
      reviewedAt: occurredAt,
      updatedAt: occurredAt,
      provenance: 'app' as const,
    }
    const project: TerrainProject = {
      ...current,
      updatedAt: occurredAt,
      notes: current.notes.map((candidate) => candidate.id === noteId
        ? { ...candidate, reviewedAt: occurredAt, cognitiveStateProvenance: 'app' }
        : candidate),
      cognitiveStates: [
        ...current.cognitiveStates.filter((state) => state.itemId !== noteId),
        cognitiveState,
      ],
      cognitiveObservations: [...(current.cognitiveObservations ?? []), observation],
      interactionEvents: [...current.interactionEvents, event],
    }
    try {
      await saveProject(project)
      if (get().project.id !== current.id) return
      set({ project })
      await Promise.all([get().reloadProjects(), get().reloadBackups()])
    } catch (error) {
      set({ error: `复习记录保存失败：${error instanceof Error ? error.message : String(error)}` })
    }
  },
  transitionExploration: async (suggestion, command) => {
    const current = get().project
    try {
      const { transitionExplorationProject } = await import('./exploration-actions')
      const project = await transitionExplorationProject(current, suggestion, command)
      if (get().project.id === current.id) set({ project })
      await get().reloadProjects()
    } catch (error) {
      set({ error: `探索记录保存失败：${error instanceof Error ? error.message : String(error)}` })
    }
  },
  editExploration: async (suggestion, patch) => {
    const current = get().project
    try {
      const { editExplorationProject } = await import('./exploration-actions')
      const project = await editExplorationProject(current, suggestion, patch)
      if (get().project.id === current.id) set({ project })
      await get().reloadProjects()
    } catch (error) {
      set({ error: `探索动作保存失败：${error instanceof Error ? error.message : String(error)}` })
    }
  },
  cancelAnalysis: () => {
    analyses.cancel()
    set({ isAnalyzing: false, progress: null })
  },
  replaceProject: async (project) => {
    let normalized: TerrainProject
    try {
      normalized = await persistProject(project)
    } catch (error) {
      const message = `项目保存失败，当前项目未切换：${error instanceof Error ? error.message : String(error)}`
      set({ error: message })
      throw new Error(message, { cause: error })
    }
    localStorage.setItem('cognitive-terrain:last-project', normalized.id)
    setProjectState(set, normalized)
    try {
      await Promise.all([get().reloadProjects(), get().reloadBackups()])
    } catch (error) {
      set({ error: `项目已保存，但项目列表刷新失败：${error instanceof Error ? error.message : String(error)}` })
    }
  },
  resetDemo: () => {
    const project = migrateProject(createDemoProject({ includeProgressionEvidence: true }))
    localStorage.removeItem('cognitive-terrain:last-project')
    setProjectState(set, project)
    void get().reloadProjects()
  },
  openProject: async (id) => {
    const project = await getProject(id)
    if (!project) {
      set({ error: '项目不存在或已被删除' })
      await get().reloadProjects()
      return
    }
    localStorage.setItem('cognitive-terrain:last-project', id)
    setProjectState(set, project)
  },
  renameCurrentProject: async (name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const currentId = get().project.id
    const renamed = await renameProject(currentId, trimmed)
    if (!renamed) {
      const current = get().project
      if (current.id !== currentId) return
      try {
        await saveProject({ ...current, name: trimmed })
        set({ project: { ...current, name: trimmed } })
      } catch (error) {
        set({ error: `项目改名失败：${error instanceof Error ? error.message : String(error)}` })
        return
      }
    } else {
      set({ project: renamed })
    }
    await Promise.all([get().reloadProjects(), get().reloadBackups()])
  },
  deleteProjectInLibrary: async (id) => {
    await deleteProject(id)
    const state = get()
    if (state.project.id === id) {
      localStorage.removeItem('cognitive-terrain:last-project')
    setProjectState(set, migrateProject(createDemoProject({ includeProgressionEvidence: true })))
    }
    await Promise.all([get().reloadProjects(), get().reloadBackups()])
  },
  reloadProjects: async () => {
    const projectSummaries = await listProjectSummaries()
    set({ projects: projectSummaries })
  },
  createBackup: async () => {
    try {
      await createProjectBackup(get().project)
      await get().reloadBackups()
      return true
    } catch (error) {
      set({ error: `创建恢复点失败：${error instanceof Error ? error.message : String(error)}` })
      return false
    }
  },
  restoreBackup: async (id) => {
    try {
      const project = await restoreProjectBackup(id)
      if (!project) {
        set({ error: '恢复点不存在或已被清理' })
        await get().reloadBackups()
        return false
      }
      localStorage.setItem('cognitive-terrain:last-project', project.id)
      setProjectState(set, project)
      await Promise.all([get().reloadProjects(), get().reloadBackups()])
      return true
    } catch (error) {
      set({ error: `恢复项目失败：${error instanceof Error ? error.message : String(error)}` })
      return false
    }
  },
  reloadBackups: async () => {
    const backups = await listProjectBackups()
    set({ backups })
  },
  createTaxonomy: async (input) => {
    const current = get().project
    const now = taxonomyMutationTimestamp(current)
    const node = createTaxonomyNode({
      workspaceId: current.id,
      label: input.label,
      parentId: input.parentId,
      aliases: input.aliases,
      description: input.description,
      version: nextTaxonomyVersion(current),
    }, now)
    const taxonomyNodes = [...(current.taxonomyNodes ?? []), node]
    validateTaxonomy(taxonomyNodes)
    const assignItemIds = new Set(input.assignItemIds ?? [])
    const notes = current.notes.map((note) => {
      if (!assignItemIds.has(note.id)) return note
      const areas = areasForNote(note)
      const nextAreas = areasForNote({ areas: [...areas, node.label] })
      const declaredAreas = note.declaredAreas ?? areas
      return {
        ...note,
        area: nextAreas[0],
        areas: nextAreas,
        declaredAreas: declaredAreas.some((area) => resolveTaxonomyAlias([node], current.id, area))
          ? [...declaredAreas]
          : [...declaredAreas, node.label],
      }
    })
    await persistTaxonomyProject({
      ...current,
      updatedAt: now,
      notes,
      taxonomyNodes,
      taxonomyVersion: nextTaxonomyVersion(current),
    }, set, get)
  },
  renameTaxonomy: async (nodeId, label) => {
    const current = get().project
    const now = taxonomyMutationTimestamp(current)
    const memberships = migrateTerrainProjectToV3(current).bundle.plateMemberships
    const result = renameTaxonomyNode(current.taxonomyNodes ?? [], nodeId, label, memberships, now)
    const renamed = result.nodes.find((node) => node.id === nodeId)
    if (!renamed) throw new Error(`taxonomy node not found after rename: ${nodeId}`)
    const notes = rewriteResolvedAreas(current, nodeId, renamed.label)
    await persistTaxonomyProject({
      ...current,
      updatedAt: now,
      notes,
      taxonomyNodes: result.nodes,
      taxonomyVersion: nextTaxonomyVersion(current),
    }, set, get)
  },
  reparentTaxonomy: async (nodeId, parentId) => {
    const current = get().project
    const now = taxonomyMutationTimestamp(current)
    const memberships = migrateTerrainProjectToV3(current).bundle.plateMemberships
    const result = reparentTaxonomyNode(current.taxonomyNodes ?? [], nodeId, parentId, memberships, now)
    await persistTaxonomyProject({
      ...current,
      updatedAt: now,
      taxonomyNodes: result.nodes,
      taxonomyVersion: nextTaxonomyVersion(current),
    }, set, get)
  },
  mergeTaxonomy: async (sourceNodeId, targetNodeId) => {
    const current = get().project
    const now = taxonomyMutationTimestamp(current)
    const memberships = migrateTerrainProjectToV3(current).bundle.plateMemberships
    const target = current.taxonomyNodes?.find((node) => node.id === targetNodeId)
    if (!target) throw new Error(`unknown taxonomy node: ${targetNodeId}`)
    const notes = rewriteResolvedAreas(current, sourceNodeId, target.label)
    const result = mergeTaxonomyNodes(current.taxonomyNodes ?? [], sourceNodeId, targetNodeId, memberships, now)
    await persistTaxonomyProject({
      ...current,
      updatedAt: now,
      notes,
      taxonomyNodes: result.nodes,
      taxonomyVersion: nextTaxonomyVersion(current),
    }, set, get)
  },
  }
})

if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('perf')) {
  window.__cognitiveTerrainPerf = {
    setTimeline: (timeline) => useAppStore.getState().setTimeline(timeline),
    setQuality: (quality) => useAppStore.getState().setQuality(quality),
    setVisualDimension: (dimension) => useAppStore.getState().setVisualDimension(dimension),
  }
}

function setProjectState(set: (partial: Partial<AppState>) => void, project: TerrainProject): void {
  liveTimeline = Math.max(0, project.snapshots.length - 1)
  set({
    project,
    timeline: Math.max(0, project.snapshots.length - 1),
    selectedNoteId: null,
    activeTags: [],
    activeAreas: [],
    search: '',
    detailsOpen: false,
    focusRequest: null,
    activePeakId: null,
    activePeak: null,
    activeCollisionId: null,
    activeGapNodeId: null,
    compareRef: null,
    cameraRevision: Date.now(),
    cameraScale: 192,
  })
}

function applyStoredReferenceAtlasPreference(project: TerrainProject): TerrainProject {
  const stored = localStorage.getItem(`${REFERENCE_ATLAS_PREFERENCE_PREFIX}${project.id}`) ?? undefined
  const activeReferenceAtlasId = normalizeActiveReferenceAtlasId(project.referenceAtlases, stored)
  return activeReferenceAtlasId === project.activeReferenceAtlasId
    ? project
    : { ...project, activeReferenceAtlasId }
}

function nextTaxonomyVersion(project: TerrainProject): number {
  return Math.max(0, project.taxonomyVersion ?? 0) + 1
}

function taxonomyMutationTimestamp(project: TerrainProject): string {
  const timestamps = [project.updatedAt, ...(project.taxonomyNodes ?? []).map((node) => node.updatedAt)]
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)
  return new Date(Math.max(Date.now(), ...timestamps)).toISOString()
}

function rewriteResolvedAreas(project: TerrainProject, nodeId: string, targetLabel: string): TerrainProject['notes'] {
  const nodes = project.taxonomyNodes ?? []
  return project.notes.map((note) => {
    const currentAreas = areasForNote(note)
    const nextAreas = areasForNote({
      areas: currentAreas.map((area) => resolveTaxonomyAlias(nodes, project.id, area)?.id === nodeId ? targetLabel : area),
    })
    if (nextAreas.join('\n') === currentAreas.join('\n')) return note
    return {
      ...note,
      area: nextAreas[0],
      areas: nextAreas,
      declaredAreas: note.declaredAreas ?? currentAreas,
    }
  })
}

function cognitiveObservationsForUpdate(
  target: TerrainProject['notes'][number],
  patch: NoteUpdatePatch,
  options: CognitiveObservationOptions,
  observedAt: string,
  eventId: string,
): ReturnType<typeof createCognitiveObservation>[] {
  const provenance = options.provenance ?? 'self-assessment'
  const reason = options.reason?.trim() || (provenance === 'review-outcome' ? '显式复习结果' : '手动自评')
  const candidates: Array<{
    field: 'mastery' | 'confidence' | 'exploration' | 'status' | 'reviewedAt'
    previous: unknown
    next: unknown
  }> = [
    { field: 'mastery', previous: target.mastery, next: 'mastery' in patch ? patch.mastery ?? undefined : target.mastery },
    { field: 'confidence', previous: target.confidence, next: 'confidence' in patch ? patch.confidence ?? undefined : target.confidence },
    { field: 'exploration', previous: target.exploration, next: 'exploration' in patch ? patch.exploration ?? undefined : target.exploration },
    { field: 'status', previous: target.status, next: 'status' in patch ? patch.status ?? undefined : target.status },
    { field: 'reviewedAt', previous: target.reviewedAt, next: 'reviewedAt' in patch ? patch.reviewedAt ?? undefined : target.reviewedAt },
  ]
  return candidates.flatMap(({ field, previous, next }) => {
    if (!(field in patch) || previous === next || next === undefined || next === null) return []
    return [createCognitiveObservation({
      id: `${eventId}:${field}`,
      itemId: target.id,
      field,
      value: next as never,
      observedAt,
      provenance,
      reason,
    })]
  })
}

/**
 * Commit invariant for every project mutation in this store.
 *
 * Persist first, then swap the in-memory project. The reverse order let analysis
 * report success while IndexedDB rejected the write, so the user saw a populated
 * terrain that vanished on reload (audit finding H2).
 *
 * Three commit paths exist and all obey it:
 *
 * - `persistProject` here, for ordinary saves and analysis commits.
 * - `saveVaultSyncProject`, for vault sync.
 * - `saveVaultWritebackProject`, for diff-first write-back.
 *
 * The vault paths do not route through `persistProject` because they need a
 * single transaction that also writes a recovery point and applies a
 * materialization diff against the previous bundle, plus a stale-preview check
 * against the stored `updatedAt`. They are therefore stricter than this
 * function rather than weaker: see `src/storage/vault-sync-repository.ts`.
 *
 * A refresh failure after a successful commit is reported separately from a
 * commit failure. Collapsing the two would tell the user their sync failed when
 * their data is safely on disk.
 */
async function persistProject(project: TerrainProject): Promise<TerrainProject> {
  const normalized = migrateProject(project)
  await saveProject(normalized)
  return normalized
}

async function persistTaxonomyProject(
  project: TerrainProject,
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
): Promise<void> {
  try {
    await createProjectBackup(get().project)
    await saveProject(project, { createBackup: false })
    set({ project, activeAreas: [] })
    await Promise.all([get().reloadProjects(), get().reloadBackups()])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    set({ error: `领域维护失败：${message}` })
    throw error
  }
}
