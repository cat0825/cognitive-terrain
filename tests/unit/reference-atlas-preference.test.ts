import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_REFERENCE_ATLAS_ID } from '../../src/domain/demo'

vi.mock('../../src/pipeline/worker-client', () => ({ runAnalysis: vi.fn() }))

const PREFERENCE_KEY = 'cognitive-terrain:reference-atlas:demo-ai-infra-terrain'

/**
 * The stored atlas preference is read once, when the store module builds its
 * initial project, so every case here needs a fresh module registry with
 * localStorage already seeded.
 */
async function loadStoreWithPreference(stored: string | null) {
  vi.resetModules()
  const storage = memoryStorage()
  if (stored !== null) storage.setItem(PREFERENCE_KEY, stored)
  vi.stubGlobal('localStorage', storage)
  const { useAppStore } = await import('../../src/store/app-store')
  return useAppStore.getState().project
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('stored reference atlas preference', () => {
  it('keeps the project selection when the user never chose', async () => {
    const project = await loadStoreWithPreference(null)

    expect(project.activeReferenceAtlasId).toBe(DEMO_REFERENCE_ATLAS_ID)
  }, 20_000)

  it('treats an empty stored value as an explicit deselect', async () => {
    // setReferenceAtlas(undefined) writes '' rather than removing the key, because
    // a missing key means "never chose" and would restore the demo's own selection.
    const project = await loadStoreWithPreference('')

    expect(project.activeReferenceAtlasId).toBeUndefined()
  }, 20_000)

  it('ignores a stored atlas the project does not declare', async () => {
    const project = await loadStoreWithPreference('atlas-that-was-deleted')

    expect(project.activeReferenceAtlasId).toBeUndefined()
  }, 20_000)
})

function memoryStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => [...entries.keys()][index] ?? null,
    removeItem: (key: string) => void entries.delete(key),
    setItem: (key: string, value: string) => void entries.set(key, value),
  }
}
