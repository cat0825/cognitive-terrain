import { create } from 'zustand'
import type { AnalysisOptions, NoteInput, ProcessingProgress, ProjectSummary, QualityLevel, TerrainProject, ViewMode, VisualDimension } from '../domain/types'
import { createDemoProject } from '../domain/demo'
import { TODAY_STUDY_PACK_NAME, todayStudyPack } from '../domain/study-pack'
import { runAnalysis, type AnalysisHandle } from '../pipeline/worker-client'
import { parseWikiLinks } from '../import/parse'
import {
  deleteProject,
  getProject,
  listProjectSummaries,
  renameProject,
  saveProject,
} from '../storage/project-repository'

export type CameraInteractionMode = 'rotate' | 'pan'

interface AppState {
  project: TerrainProject
  selectedNoteId: string | null
  search: string
  activeTags: string[]
  viewMode: ViewMode
  quality: QualityLevel
  visualDimension: VisualDimension
  timeline: number
  importOpen: boolean
  filtersOpen: boolean
  detailsOpen: boolean
  libraryOpen: boolean
  projects: ProjectSummary[]
  isAnalyzing: boolean
  progress: ProcessingProgress | null
  error: string | null
  cameraRevision: number
  cameraScale: number
  cameraInteractionMode: CameraInteractionMode
  focusRequest: { noteId: string; revision: number } | null
  activePeakId: string | null
  compareRef: number | null
  firstRun: boolean
  dismissFirstRun: () => void
  lastAnalysis: { modelId: string; embeddingMode: 'semantic' | 'fallback'; device: string; elapsedMs: number } | null
  initialize: () => Promise<void>
  selectNote: (id: string | null) => void
  setSearch: (search: string) => void
  toggleTag: (tag: string) => void
  clearTags: () => void
  setViewMode: (mode: ViewMode) => void
  setQuality: (quality: QualityLevel) => void
  setVisualDimension: (dimension: VisualDimension) => void
  setTimeline: (timeline: number) => void
  setImportOpen: (open: boolean) => void
  setFiltersOpen: (open: boolean) => void
  setDetailsOpen: (open: boolean) => void
  setLibraryOpen: (open: boolean) => void
  setCameraScale: (scale: number) => void
  setCameraInteractionMode: (mode: CameraInteractionMode) => void
  resetCamera: () => void
  requestFocus: (noteId: string) => void
  setActivePeak: (peakId: string | null) => void
  setCompareRef: (bucketIndex: number | null) => void
  reportError: (message: string) => void
  dismissError: () => void
  startAnalysis: (name: string, notes: NoteInput[], options?: AnalysisOptions) => Promise<void>
  loadStudyPack: () => Promise<void>
  mergeNotes: (newNotes: NoteInput[], options?: AnalysisOptions) => Promise<void>
  updateNote: (noteId: string, patch: { title?: string; content?: string; tags?: string[]; mastery?: number | null; confidence?: number | null; exploration?: number | null; status?: TerrainProject['notes'][number]['status'] | null; area?: string | null; reviewedAt?: string | null }) => Promise<void>
  cancelAnalysis: () => void
  replaceProject: (project: TerrainProject) => Promise<void>
  resetDemo: () => void
  openProject: (id: string) => Promise<void>
  renameCurrentProject: (name: string) => Promise<void>
  deleteProjectInLibrary: (id: string) => Promise<void>
  reloadProjects: () => Promise<void>
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

let activeAnalysis: AnalysisHandle | null = null
const initialProject = createDemoProject()
let liveTimeline = Math.max(0, initialProject.snapshots.length - 1)

export function getLiveTimeline(): number {
  return liveTimeline
}

export const useAppStore = create<AppState>((set, get) => ({
  project: initialProject,
  selectedNoteId: initialProject.notes[0]?.id ?? null,
  search: '',
  activeTags: [],
  viewMode: '3d',
  quality: 'high',
  visualDimension: 'density',
  timeline: Math.max(0, initialProject.snapshots.length - 1),
  importOpen: false,
  filtersOpen: false,
  detailsOpen: true,
  libraryOpen: false,
  projects: [],
  isAnalyzing: false,
  progress: null,
  error: null,
  cameraRevision: 0,
  cameraScale: 192,
  cameraInteractionMode: 'rotate',
  focusRequest: null,
  activePeakId: null,
  compareRef: null,
  firstRun: localStorage.getItem('cognitive-terrain:first-run') === null,
  lastAnalysis: null,
  dismissFirstRun: () => {
    localStorage.setItem('cognitive-terrain:first-run', 'seen')
    set({ firstRun: false })
  },
  initialize: async () => {
    try {
      const projectSummaries = await listProjectSummaries()
      if (projectSummaries.length) set({ projects: projectSummaries })
      const lastProjectId = localStorage.getItem('cognitive-terrain:last-project')
      if (!lastProjectId) return
      const project = await getProject(lastProjectId)
      if (project) setProjectState(set, project)
    } catch {
      localStorage.removeItem('cognitive-terrain:last-project')
    }
  },
  selectNote: (selectedNoteId) => set({ selectedNoteId, detailsOpen: selectedNoteId !== null }),
  setSearch: (search) => set({ search }),
  toggleTag: (tag) =>
    set((state) => ({
      activeTags: state.activeTags.includes(tag)
        ? state.activeTags.filter((activeTag) => activeTag !== tag)
        : [...state.activeTags, tag],
    })),
  clearTags: () => set({ activeTags: [] }),
  setViewMode: (viewMode) => set({ viewMode }),
  setQuality: (quality) => set({ quality }),
  setVisualDimension: (visualDimension) => set({ visualDimension }),
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
  setActivePeak: (activePeakId) => set({ activePeakId }),
  setCompareRef: (compareRef) => set({ compareRef }),
  reportError: (error) => set({ error }),
  dismissError: () => set({ error: null }),
  startAnalysis: async (name, notes, options = {}) => {
    if (!notes.length) {
      set({ error: '没有可分析的笔记' })
      return
    }
    const startedAt = performance.now()
    activeAnalysis?.cancel()
    set({
      isAnalyzing: true,
      progress: { stage: 'parsing', completed: 0, total: 1, message: '准备分析' },
      error: null,
      importOpen: false,
    })
    activeAnalysis = runAnalysis(name, notes, options, (progress) => set({ progress }))
    try {
      const project = await activeAnalysis.promise
      const embeddingMode: 'semantic' | 'fallback' =
        project.embeddingMode === 'semantic' ? 'semantic' : 'fallback'
      set({
        lastAnalysis: {
          modelId: project.modelId,
          embeddingMode,
          device: options.embeddingStrategy === 'deterministic' ? 'local' : 'webgpu/wasm',
          elapsedMs: Math.round(performance.now() - startedAt),
        },
      })
      await get().replaceProject(project)
      set({ isAnalyzing: false, progress: null })
    } catch (error) {
      set({
        isAnalyzing: false,
        progress: null,
        error: error instanceof Error ? error.message : '分析失败',
      })
    } finally {
      activeAnalysis = null
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
    const existing: NoteInput[] = current.notes.map((note) => ({
      id: note.id,
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
      reviewedAt: note.reviewedAt,
      links: note.links,
    }))
    const existingIds = new Set(existing.map((note) => note.id))
    const deduped = newNotes.filter((note) => !existingIds.has(note.id?.trim() ?? ''))
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
    await get().startAnalysis(current.name, merged, effective)
  },
  updateNote: async (noteId, patch) => {
    const current = get().project
    const target = current.notes.find((note) => note.id === noteId)
    if (!target) {
      set({ error: '笔记不存在' })
      return
    }
    const inputs: NoteInput[] = current.notes.map((note) => {
      if (note.id !== noteId) {
        return {
          id: note.id,
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
          reviewedAt: note.reviewedAt,
          links: note.links,
        }
      }
      return {
        id: note.id,
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
        area: 'area' in patch ? patch.area ?? undefined : note.area,
        reviewedAt: 'reviewedAt' in patch ? patch.reviewedAt ?? undefined : note.reviewedAt,
        links: patch.content === undefined ? note.links : parseWikiLinks(patch.content),
      }
    })
    const effective = {
      embeddingStrategy: (current.embeddingMode === 'semantic' ? 'transformers' : 'deterministic') as
        | 'transformers'
        | 'deterministic',
    }
    await get().startAnalysis(current.name, inputs, effective)
  },
  cancelAnalysis: () => {
    activeAnalysis?.cancel()
    activeAnalysis = null
    set({ isAnalyzing: false, progress: null })
  },
  replaceProject: async (project) => {
    setProjectState(set, project)
    try {
      await saveProject(project)
      localStorage.setItem('cognitive-terrain:last-project', project.id)
      await get().reloadProjects()
    } catch (error) {
      set({ error: `项目已打开，但本地保存失败：${error instanceof Error ? error.message : String(error)}` })
    }
  },
  resetDemo: () => {
    const project = createDemoProject()
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
    await get().reloadProjects()
  },
  deleteProjectInLibrary: async (id) => {
    await deleteProject(id)
    const state = get()
    if (state.project.id === id) {
      localStorage.removeItem('cognitive-terrain:last-project')
      setProjectState(set, createDemoProject())
    }
    await get().reloadProjects()
  },
  reloadProjects: async () => {
    const projectSummaries = await listProjectSummaries()
    set({ projects: projectSummaries })
  },
}))

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
    selectedNoteId: project.notes[0]?.id ?? null,
    activeTags: [],
    search: '',
    detailsOpen: true,
    focusRequest: null,
    activePeakId: null,
    compareRef: null,
    cameraRevision: Date.now(),
    cameraScale: 192,
  })
}
