import { DEFAULT_TERRAIN_PROFILE_ID, DEFAULT_TERRAIN_PROFILES } from '../../src/domain/terrain-profile'
import type { TerrainNote, TerrainProject } from '../../src/domain/types'

const evaluatedAt = '2026-08-21T00:00:00.000Z'

/**
 * Minimal project that exercises every visual channel at once.
 *
 * It carries all six shipped terrain profiles plus a bound reference atlas so
 * the legend can report a real formula version for each dimension instead of
 * falling back to a default.
 */
export function projectFixture(): TerrainProject {
  return {
    schemaVersion: 3,
    id: 'visual-contract-project',
    name: 'Visual contract',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: evaluatedAt,
    timeZone: 'UTC',
    modelId: 'semantic-model-v1',
    embeddingMode: 'semantic',
    sourceDigest: 'digest',
    gridSize: 64,
    notes: [
      note('a', 'Alpha', { mastery: 0.8, confidence: 0.7, exploration: 0.6, links: ['Beta'] }),
      note('b', 'Beta', { x: 0.3, y: 0.4, prerequisites: ['Alpha'] }),
    ],
    snapshots: [],
    peaks: [{ id: 'peak-1', x: 0.1, y: 0.1, height: 0.82, label: 'linear', noteIds: ['a', 'b'] }],
    noteNeighbors: [['b'], ['a']],
    cognitiveStates: [{
      itemId: 'a',
      mastery: 0.8,
      confidence: 0.7,
      exploration: 0.6,
      updatedAt: evaluatedAt,
      provenance: 'yaml',
    }],
    interactionEvents: [{
      id: 'opened-a',
      itemId: 'a',
      type: 'opened',
      occurredAt: '2026-08-20T07:00:00.000Z',
    }],
    terrainProfiles: [...DEFAULT_TERRAIN_PROFILES],
    activeTerrainProfileId: DEFAULT_TERRAIN_PROFILE_ID,
    taxonomyNodes: [{
      id: 'taxonomy-math',
      workspaceId: 'visual-contract-project',
      label: 'Mathematics',
      aliases: ['Math'],
      version: 1,
      status: 'active',
      createdAt: evaluatedAt,
      updatedAt: evaluatedAt,
    }],
    taxonomyVersion: 1,
    referenceAtlases: [{
      id: 'atlas-math',
      workspaceId: 'visual-contract-project',
      label: 'Math reference',
      taxonomyVersion: 1,
      taxonomyNodeIds: ['taxonomy-math'],
      createdAt: evaluatedAt,
      updatedAt: evaluatedAt,
    }],
    activeReferenceAtlasId: 'atlas-math',
  }
}

function note(id: string, title: string, overrides: Partial<TerrainNote> = {}): TerrainNote {
  return {
    id,
    title,
    content: `${title} content`,
    createdAt: '2026-08-01T00:00:00.000Z',
    tags: ['linear'],
    weight: 1,
    x: -0.2,
    y: 0,
    area: 'Mathematics',
    areas: ['Mathematics'],
    links: [],
    ...overrides,
  }
}
