import { describe, expect, it } from 'vitest'
import { evaluationTimeForProject } from '../../src/domain/evaluation-time'
import { buildProjectReferenceGapReport } from '../../src/domain/reference-gaps'
import type { TerrainProject } from '../../src/domain/types'

describe('evaluationTimeForProject', () => {
  it('uses wall-clock now when the project is older', () => {
    const nowMs = Date.parse('2026-08-15T00:00:00.000Z')
    expect(evaluationTimeForProject('2026-08-01T00:00:00.000Z', nowMs)).toBe(nowMs)
  })

  it('uses the project timestamp when it is ahead of the local clock', () => {
    // An import from a machine with a fast clock must not evaluate to a time
    // before its own activity, or that activity would look future-dated.
    const nowMs = Date.parse('2026-08-15T00:00:00.000Z')
    const ahead = '2026-08-16T00:00:00.000Z'
    expect(evaluationTimeForProject(ahead, nowMs)).toBe(Date.parse(ahead))
  })

  it('falls back to now for an unparsable project timestamp', () => {
    const nowMs = Date.parse('2026-08-15T00:00:00.000Z')
    expect(evaluationTimeForProject('not-a-date', nowMs)).toBe(nowMs)
  })

  it('is stable for the same project so memoised views do not recompute', () => {
    const nowMs = Date.parse('2026-08-15T00:00:00.000Z')
    const updatedAt = '2026-08-14T00:00:00.000Z'
    expect(evaluationTimeForProject(updatedAt, nowMs)).toBe(evaluationTimeForProject(updatedAt, nowMs))
  })
})

describe('reference gap evaluation after activity is recorded', () => {
  it('reflects a review recorded after the initial evaluation instead of ignoring it', () => {
    // Reproduces the page-load freeze: the report was built once with a
    // timestamp captured at mount, so any later review was treated as future and
    // skipped, leaving the node reported as stale for the rest of the session.
    const project = staleProjectFixture()
    const pageLoadMs = Date.parse('2026-08-15T00:00:00.000Z')

    const atLoad = buildProjectReferenceGapReport(project, 'atlas-ai', pageLoadMs)
    expect(atLoad.gaps.find((gap) => gap.nodeId === 'ml')).toMatchObject({ state: 'stale' })

    // The user reviews the note: reviewNote records the event and advances
    // updatedAt to the same instant.
    const reviewedAt = '2026-08-15T01:00:00.000Z'
    const reviewed: TerrainProject = {
      ...project,
      updatedAt: reviewedAt,
      interactionEvents: [
        ...project.interactionEvents,
        { id: 'reviewed-now', itemId: 'note-1', type: 'reviewed', occurredAt: reviewedAt },
      ],
    }

    // Frozen page-load time: the fresh review is invisible, node stays stale.
    const frozen = buildProjectReferenceGapReport(reviewed, 'atlas-ai', pageLoadMs)
    expect(frozen.gaps.find((gap) => gap.nodeId === 'ml')).toMatchObject({ state: 'stale' })

    // Project-derived time: the review counts and the node is no longer stale.
    const refreshed = buildProjectReferenceGapReport(
      reviewed,
      'atlas-ai',
      evaluationTimeForProject(reviewed.updatedAt, pageLoadMs),
    )
    expect(refreshed.gaps.find((gap) => gap.nodeId === 'ml')).toMatchObject({ state: 'covered' })
    expect(refreshed.gaps.find((gap) => gap.nodeId === 'ml')?.lastSupportingAt).toBe(reviewedAt)
  })

  it('keeps the evaluation time in the report so the claim stays traceable', () => {
    const project = staleProjectFixture()
    const evaluatedAtMs = evaluationTimeForProject(project.updatedAt, Date.parse('2026-08-15T00:00:00.000Z'))
    const report = buildProjectReferenceGapReport(project, 'atlas-ai', evaluatedAtMs)

    expect(report.evaluatedAt).toBe(new Date(evaluatedAtMs).toISOString())
  })
})

/** A project whose only ML activity is old enough to be reported as stale. */
function staleProjectFixture(): TerrainProject {
  return {
    schemaVersion: 3,
    id: 'project-1',
    name: 'Stale coverage project',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
    timeZone: 'UTC',
    modelId: 'test-model',
    embeddingMode: 'fallback',
    sourceDigest: 'test-digest',
    gridSize: 2,
    notes: [{
      id: 'note-1',
      fingerprint: 'note-1',
      title: 'Machine learning',
      content: 'Coverage note',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdAtMs: Date.parse('2026-01-01T00:00:00.000Z'),
      tags: [],
      weight: 1,
      declaredAreas: ['ML'],
      links: [],
      x: 0,
      y: 0,
    }, {
      id: 'note-2',
      fingerprint: 'note-2',
      title: 'Machine learning second',
      content: 'Second coverage note',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdAtMs: Date.parse('2026-01-01T00:00:00.000Z'),
      tags: [],
      weight: 1,
      declaredAreas: ['ML'],
      links: [],
      x: 1,
      y: 0,
    }],
    snapshots: [],
    peaks: [],
    noteNeighbors: [],
    cognitiveStates: [],
    // Older than the 90-day staleness window, so ML starts out stale.
    interactionEvents: [
      { id: 'opened-old-1', itemId: 'note-1', type: 'opened', occurredAt: '2026-02-01T00:00:00.000Z' },
      { id: 'opened-old-2', itemId: 'note-2', type: 'opened', occurredAt: '2026-02-01T00:00:00.000Z' },
    ],
    taxonomyNodes: [{
      id: 'ml',
      label: 'ML',
      aliases: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: 1,
    }],
    referenceAtlases: [{
      id: 'atlas-ai',
      label: 'AI 基础',
      taxonomyVersion: 1,
      taxonomyNodeIds: ['ml'],
      createdAt: '2026-01-01T00:00:00.000Z',
    }],
    activeReferenceAtlasId: 'atlas-ai',
  } as unknown as TerrainProject
}
