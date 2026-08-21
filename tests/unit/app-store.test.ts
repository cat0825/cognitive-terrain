import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerrainProject } from '../../src/domain/types'

const workerMocks = vi.hoisted(() => ({ runAnalysis: vi.fn() }))
const repositoryMocks = vi.hoisted(() => ({
  saveProject: vi.fn(),
  createProjectBackup: vi.fn(),
  listProjectSummaries: vi.fn(),
  listProjectBackups: vi.fn(),
}))

vi.mock('../../src/pipeline/worker-client', () => ({ runAnalysis: workerMocks.runAnalysis }))
vi.mock('../../src/storage/project-repository', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/storage/project-repository')>(),
  saveProject: repositoryMocks.saveProject,
  createProjectBackup: repositoryMocks.createProjectBackup,
  listProjectSummaries: repositoryMocks.listProjectSummaries,
  listProjectBackups: repositoryMocks.listProjectBackups,
}))

let useAppStore: typeof import('../../src/store/app-store').useAppStore
let initialProject: TerrainProject

beforeAll(async () => {
  vi.stubGlobal('localStorage', memoryStorage())
  ;({ useAppStore } = await import('../../src/store/app-store'))
  initialProject = useAppStore.getState().project
})

beforeEach(() => {
  workerMocks.runAnalysis.mockReset()
  repositoryMocks.saveProject.mockReset().mockResolvedValue(undefined)
  repositoryMocks.createProjectBackup.mockReset().mockResolvedValue(undefined)
  repositoryMocks.listProjectSummaries.mockReset().mockResolvedValue([])
  repositoryMocks.listProjectBackups.mockReset().mockResolvedValue([])
  localStorage.clear()
  useAppStore.setState({
    project: initialProject,
    error: null,
    isAnalyzing: false,
    persistence: { status: 'idle' },
    progress: null,
    lastAnalysis: null,
  })
})

describe('app store reliability', () => {
  it('does not switch the current project when persistence fails', async () => {
    repositoryMocks.saveProject.mockRejectedValueOnce(new Error('quota exceeded'))
    const replacement = { ...initialProject, id: 'replacement-project', name: 'Replacement' }

    await expect(useAppStore.getState().replaceProject(replacement)).rejects.toThrow(/当前项目未切换/)

    expect(useAppStore.getState().project.id).toBe(initialProject.id)
    expect(useAppStore.getState().error).toContain('quota exceeded')
  })

  it('rejects duplicate ids inside one merge batch before analysis starts', async () => {
    const duplicate = {
      id: 'duplicate-note',
      title: 'Duplicate',
      content: 'Duplicate content',
      createdAt: '2026-08-18T00:00:00.000Z',
    }

    await useAppStore.getState().mergeNotes([duplicate, { ...duplicate }])

    expect(workerMocks.runAnalysis).not.toHaveBeenCalled()
    expect(useAppStore.getState().error).toContain('duplicate-note')
  })

  it('keeps the replacement analysis cancellable after the old request settles', async () => {
    const first = deferredAnalysis()
    const second = deferredAnalysis()
    workerMocks.runAnalysis.mockReturnValueOnce(first.handle).mockReturnValueOnce(second.handle)
    const input = [{ title: 'Note', content: 'Content', createdAt: '2026-08-18T00:00:00.000Z' }]

    const firstRun = useAppStore.getState().startAnalysis('First', input)
    const secondRun = useAppStore.getState().startAnalysis('Second', input)
    await Promise.resolve()
    useAppStore.getState().cancelAnalysis()
    await Promise.all([firstRun, secondRun])

    expect(first.cancel).toHaveBeenCalledOnce()
    expect(second.cancel).toHaveBeenCalledOnce()
    expect(useAppStore.getState().isAnalyzing).toBe(false)
    expect(useAppStore.getState().project.id).toBe(initialProject.id)
  })

  it('leaves the analyzing state when the worker cannot start', async () => {
    workerMocks.runAnalysis.mockImplementationOnce(() => {
      throw new Error('worker unavailable')
    })

    await useAppStore.getState().startAnalysis('Broken', [{
      title: 'Note',
      content: 'Content',
      createdAt: '2026-08-18T00:00:00.000Z',
    }])

    expect(useAppStore.getState().isAnalyzing).toBe(false)
    expect(useAppStore.getState().progress).toBeNull()
    expect(useAppStore.getState().error).toBe('worker unavailable')
  })

  it('rebinds a legacy reference atlas only after an explicit command', async () => {
    const project = structuredClone(initialProject)
    const atlas = project.referenceAtlases![0]
    project.taxonomyVersion = 2
    project.taxonomyNodes = project.taxonomyNodes!.map((node) => ({ ...node, version: 2 }))
    project.referenceAtlases = [{ ...atlas, taxonomyVersion: 1, taxonomySnapshot: undefined }]
    project.activeReferenceAtlasId = atlas.id
    useAppStore.setState({ project })

    await useAppStore.getState().rebindReferenceAtlas(atlas.id)

    const rebound = useAppStore.getState().project.referenceAtlases![0]
    expect(rebound.taxonomyVersion).toBe(2)
    expect(rebound.taxonomySnapshot).toHaveLength(atlas.taxonomyNodeIds.length)
    expect(repositoryMocks.saveProject).toHaveBeenCalledWith(
      expect.objectContaining({ referenceAtlases: [expect.objectContaining({ taxonomyVersion: 2 })] }),
      { createBackup: false },
    )
  })
})

describe('analysis and save states are independently observable', () => {
  it('marks the save as failed while analysis state stays clean', async () => {
    repositoryMocks.saveProject.mockRejectedValueOnce(new Error('quota exceeded'))
    const replacement = { ...initialProject, id: 'save-failed-project', name: 'Save failed' }

    await expect(useAppStore.getState().replaceProject(replacement)).rejects.toThrow(/当前项目未切换/)

    const state = useAppStore.getState()
    expect(state.persistence).toMatchObject({ status: 'failed', scope: 'project' })
    expect(state.persistence.message).toContain('quota exceeded')
    // Analysis never ran here, so conflating the two states would report a
    // phantom analysis failure.
    expect(state.isAnalyzing).toBe(false)
  })

  it('reports a successful save separately from analysis completion', async () => {
    const replacement = { ...initialProject, id: 'saved-project', name: 'Saved' }

    await useAppStore.getState().replaceProject(replacement)

    expect(useAppStore.getState().persistence).toMatchObject({ status: 'saved', scope: 'project' })
    expect(useAppStore.getState().project.id).toBe('saved-project')
  })

  it('keeps a failed save visible until the next commit and never drops an in-flight one', () => {
    useAppStore.setState({ persistence: { status: 'failed', scope: 'taxonomy', message: 'disk full' } })
    useAppStore.getState().acknowledgePersistence()
    expect(useAppStore.getState().persistence.status).toBe('idle')

    useAppStore.setState({ persistence: { status: 'saving', scope: 'vault-sync' } })
    useAppStore.getState().acknowledgePersistence()
    expect(useAppStore.getState().persistence).toMatchObject({ status: 'saving', scope: 'vault-sync' })
  })

  it('scopes the save state to the review path', async () => {
    const noteId = initialProject.notes[0].id

    await useAppStore.getState().markNoteReviewed(noteId)

    expect(useAppStore.getState().persistence).toMatchObject({ status: 'saved', scope: 'review' })
  })
})

function deferredAnalysis() {
  let rejectPromise: (reason?: unknown) => void = () => undefined
  const promise = new Promise<TerrainProject>((_resolve, reject) => {
    rejectPromise = reject
  })
  const cancel = vi.fn(() => rejectPromise(new DOMException('cancelled', 'AbortError')))
  return { cancel, handle: { promise, cancel } }
}

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) },
  }
}
