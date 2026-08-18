import { describe, expect, it } from 'vitest'
import { createDemoProject } from '../../src/domain/demo'
import { computeEmbeddingNeighbors } from '../../src/pipeline/neighbors'

describe('embedding neighbor evidence', () => {
  it('keeps original embedding scores separate from layout coordinates', () => {
    const notes = createDemoProject().notes.slice(0, 3).map((note, index) => ({
      ...note,
      id: `note-${index}`,
      x: index === 2 ? 0.001 : index,
      y: 0,
    }))
    const result = computeEmbeddingNeighbors(
      notes,
      [[1, 0], [0.8, 0.2], [-1, 0]],
      'semantic-model',
      'semantic',
      2,
    )

    expect(result.noteNeighbors[0]).toEqual(['note-1', 'note-2'])
    expect(result.noteNeighborEvidence[0]?.[0]).toMatchObject({
      sourceId: 'note-0',
      targetId: 'note-1',
      rank: 1,
      modelId: 'semantic-model',
      embeddingMode: 'semantic',
      formulaVersion: 'embedding-cosine-neighbors-v1',
      provenance: 'embedding',
    })
    expect(result.noteNeighborEvidence[0]?.[0]?.score).toBeCloseTo(0.9701, 3)
  })

  it('labels deterministic fallback evidence explicitly', () => {
    const notes = createDemoProject().notes.slice(0, 2)
    const result = computeEmbeddingNeighbors(
      notes,
      [[1, 0], [1, 0]],
      'deterministic-local-fallback',
      'fallback',
      1,
    )

    expect(result.noteNeighborEvidence[0]?.[0]).toMatchObject({
      score: 1,
      embeddingMode: 'fallback',
      modelId: 'deterministic-local-fallback',
    })
  })
})
