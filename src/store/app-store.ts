import { create } from 'zustand'
import type { AnalysisOptions, NoteInput, ProcessingProgress, ProjectSummary, QualityLevel, TerrainProject, ViewMode } from '../domain/types'
import { createDemoProject } from '../domain/demo'
import { TODAY_STUDY_PACK_NAME, todayStudyPack } from '../domain/study-pack'
import { runAnalysis, type AnalysisHandle } from '../pipeline/worker-client'
import {
  deleteProject,
  getProject,
  listProjectSummaries,
  renameProject,
  saveProject,
} from '../storage/project-repository'

interface AppState {
  project: TerrainProject
  selectedNoteId: string | null
  search: string
  activeTags: string[]
  viewMode: ViewMode
  quality: QualityLevel
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
  lastAnalysis: { modelId: string; embeddingMode: 'semantic' | 'fallback'; device: string; elapsedMs: number } | null
  initialize: () => Promise<void>
  selectNote: (id: string | null) => void
  setSearch: (search: string) => void
  toggleTag: (tag: string) => void
  clearTags: () => void
  setViewMode: (mode: ViewMode) => void
  setQuality: (quality: QualityLevel) => void
  setTimeline: (timeline: number) => void
  setImportOpen: (open: boolean) => void
  setFiltersOpen: (open: boolean) => void
  setDetailsOpen: (open: boolean) => void
  setLibraryOpen: (open: boolean) => void
  setCameraScale: (scale: number) => void
  resetCamera: () => void
  reportError: (message: string) => void
  dismissError: () => void
  startAnalysis: (name: string, notes: NoteInput[], options?: AnalysisOptions) => Promise<void>
  loadStudyPack: () => Promise<void>
  cancelAnalysis: () => void
  replaceProject: (project: TerrainProject) => Promise<void>
  resetDemo: () => void
  openProject: (id: string) => Promise<void>
  renameCurrentProject: (name: string) => Promise<void>
  deleteProjectInLibrary: (id: string) => Promise<void>
  reloadProjects: () => Promise<void>
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
  lastAnalysis: null,
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
  setTimeline: (timeline) => {
    liveTimeline = timeline
    const state = get()
    const nextBucket = Math.ceil(timeline)
    if (state.viewMode === '2d' || nextBucket !== Math.ceil(state.timeline)) {
      set({ timeline })
    }
  },
  setImportOpen: (importOpen) => set({ importOpen }),
  setFiltersOpen: (filtersOpen) => set({ filtersOpen }),
  setDetailsOpen: (detailsOpen) => set({ detailsOpen }),
  setLibraryOpen: (libraryOpen) => set({ libraryOpen }),
  setCameraScale: (cameraScale) => set({ cameraScale: Math.max(110, Math.min(260, cameraScale)) }),
  resetCamera: () => set((state) => ({ cameraRevision: state.cameraRevision + 1, cameraScale: 192 })),
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

function setProjectState(set: (partial: Partial<AppState>) => void, project: TerrainProject): void {
  liveTimeline = Math.max(0, project.snapshots.length - 1)
  set({
    project,
    timeline: Math.max(0, project.snapshots.length - 1),
    selectedNoteId: project.notes[0]?.id ?? null,
    activeTags: [],
    search: '',
    detailsOpen: true,
    cameraRevision: Date.now(),
    cameraScale: 192,
  })
}
