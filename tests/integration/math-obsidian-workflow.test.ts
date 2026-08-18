import { describe, expect, it } from 'vitest'
import { commitAnalyzedProject } from '../../src/domain/cognitive-state'
import { generateProjectExplorationSuggestions } from '../../src/domain/exploration-loop'
import { maintenanceCandidates, resolveNoteRelations } from '../../src/domain/knowledge-maintenance'
import type { TerrainProject } from '../../src/domain/types'
import { applyVaultSync, type AppliedVaultSync, type VaultSyncPreview } from '../../src/domain/vault-sync'
import { obsidianUri } from '../../src/import/obsidian-uri'
import { scanVaultFiles } from '../../src/import/vault-sync'
import { analyzeNotes } from '../../src/pipeline/run-pipeline'
import {
  mathWorkflowFixtureFiles,
  parseMathWorkflowFixture,
  parseMathWorkflowSecondSnapshot,
  readMathWorkflowManifest,
} from '../fixtures/math-obsidian-workflow'

const manifest = readMathWorkflowManifest()
const fixedNow = Date.parse('2026-08-17T08:00:00.000Z')
const firstScanAt = '2026-08-17T08:00:00.000Z'
const secondScanAt = '2026-08-18T08:00:00.000Z'

describe('synthetic mathematical Obsidian workflow', () => {
  it('imports a nested vault without losing source navigation metadata', async () => {
    const parsed = await parseMathWorkflowFixture()

    expect(parsed.notes).toHaveLength(manifest.noteCount)
    expect(parsed.issues).toHaveLength(manifest.issueCount)
    expect(parsed.notes.every((note) => note.vault === manifest.vault)).toBe(true)
    expect(parsed.notes.map((note) => note.sourcePath)).toContain(manifest.openQuestionPath)
    expect(parsed.notes.find((note) => note.title === '拉格朗日乘子')?.areas).toEqual([
      '数学.分析',
      '数学.优化',
      '物理.力学',
    ])
  })

  it('resolves dense definition, theorem, proof, example, and cross-discipline links', async () => {
    const project = await analyzeFixture(false)
    const theorem = project.notes.find((note) => note.title === 'Heine–Borel 定理')!
    const theoremRelations = resolveNoteRelations(project.notes, theorem.id)
    const relationCounts = project.notes.reduce((counts, note) => {
      const relations = resolveNoteRelations(project.notes, note.id)
      return {
        resolved: counts.resolved + relations.outgoing.length,
        unresolved: counts.unresolved + relations.unresolved.length,
      }
    }, { resolved: 0, unresolved: 0 })
    const openQuestions = project.notes.find((note) => note.title === '数学研究开放问题')!

    expect(theoremRelations.outgoing.map((note) => note.title)).toEqual([
      '紧致性',
      'Heine–Borel 证明',
      '闭区间例子',
      '数学研究开放问题',
    ])
    expect(theoremRelations.incoming.map((note) => note.title)).toEqual(expect.arrayContaining([
      '紧致性',
      'Heine–Borel 证明',
      '闭区间例子',
    ]))
    expect(relationCounts).toEqual({
      resolved: manifest.resolvedWikiLinkCount,
      unresolved: manifest.unresolvedWikiLinkCount,
    })
    expect(resolveNoteRelations(project.notes, openQuestions.id).unresolved).toEqual(['Research/Unproved Lemma'])
    expect(resolveNoteRelations(project.notes, project.notes.find((note) => note.title === '拉格朗日乘子')!.id)
      .outgoing.map((note) => note.title)).toContain('虚功原理')
  })

  it('keeps no-op re-import identities and relations stable regardless of file order', async () => {
    const first = await analyzeFixture(false)
    const second = await analyzeFixture(true)

    expect(projectIdentity(second)).toEqual(projectIdentity(first))
    expect(projectRelations(second)).toEqual(projectRelations(first))
  })

  it('surfaces the open question for maintenance and returns to its Obsidian source', async () => {
    const project = await analyzeFixture(false)
    const candidate = maintenanceCandidates(project, 1, fixedNow)[0]

    expect(candidate?.note).toMatchObject({
      title: '数学研究开放问题',
      sourcePath: manifest.openQuestionPath,
      vault: manifest.vault,
      status: 'gap',
    })
    expect(candidate?.reasons).toEqual(expect.arrayContaining(['熟练度 18%', '置信度偏低', '探索意愿较高']))
    expect(obsidianUri(candidate!.note.sourcePath!, candidate!.note.vault)).toBe(
      'obsidian://open?vault=MathResearchVault&file=Research%2FOpen%20Questions',
    )
  })

  it('parses the explicit second snapshot independently of file order', async () => {
    const first = await parseMathWorkflowSecondSnapshot(false)
    const reversed = await parseMathWorkflowSecondSnapshot(true)

    expect(first.notes).toHaveLength(manifest.secondSnapshot.noteCount)
    expect(first.issues).toHaveLength(manifest.secondSnapshot.issueCount)
    expect(projectInputIdentity(reversed.notes)).toEqual(projectInputIdentity(first.notes))
    expect(first.notes.map((note) => note.sourcePath)).toEqual(expect.arrayContaining([
      manifest.secondSnapshot.addedPath,
      manifest.secondSnapshot.modifiedPath,
      manifest.secondSnapshot.renamedToPath,
    ]))
    expect(first.notes.map((note) => note.sourcePath)).not.toContain(manifest.secondSnapshot.removedPath)
  })

  it('reconciles the second snapshot without duplicating renamed or deleted identities', async () => {
    const baseline = await bootstrapSyncedFixture()
    const preview = await scanVaultFiles(mathWorkflowFixtureFiles('second'), baseline, secondScanAt)
    const reversedPreview = await scanVaultFiles(
      mathWorkflowFixtureFiles('second').reverse(),
      baseline,
      secondScanAt,
    )

    expect(summarizePreview(reversedPreview)).toEqual(summarizePreview(preview))
    expect(preview.unchangedCount).toBe(manifest.secondSnapshot.unchangedCount)
    expect(preview.conflicts).toEqual([])
    expect(preview.changes).toMatchObject([
      { kind: 'added', path: manifest.secondSnapshot.addedPath },
      { kind: 'modified', path: manifest.secondSnapshot.modifiedPath },
      {
        kind: 'renamed',
        path: manifest.secondSnapshot.renamedToPath,
        previousPath: manifest.secondSnapshot.renamedFromPath,
      },
      { kind: 'removed', path: manifest.secondSnapshot.removedPath },
    ])

    const applied = applyVaultSync(baseline, preview, [])
    const reversedApplied = applyVaultSync(baseline, reversedPreview, [])
    const second = await materializeAppliedSync(baseline, applied)
    const reversedSecond = await materializeAppliedSync(baseline, reversedApplied)
    const renamedSource = baseline.vaultSync!.sources.find(
      (source) => source.relativePath === manifest.secondSnapshot.renamedFromPath,
    )!
    const removedSource = baseline.vaultSync!.sources.find(
      (source) => source.relativePath === manifest.secondSnapshot.removedPath,
    )!
    const renamed = second.notes.find((note) => note.id === renamedSource.itemId)!
    const removed = second.notes.find((note) => note.id === removedSource.itemId)!
    const proof = second.notes.find((note) => note.sourcePath === manifest.secondSnapshot.modifiedPath)!
    const added = second.notes.find((note) => note.sourcePath === manifest.secondSnapshot.addedPath)!
    const changedBaselinePaths = new Set([
      manifest.secondSnapshot.modifiedPath,
      manifest.secondSnapshot.renamedFromPath,
      manifest.secondSnapshot.removedPath,
    ])

    expect(projectIdentity(reversedSecond)).toEqual(projectIdentity(second))
    expect(projectRelations(reversedSecond)).toEqual(projectRelations(second))
    expect(applied.changedItemIds).toHaveLength(4)
    for (const source of baseline.vaultSync!.sources.filter(
      (candidate) => !changedBaselinePaths.has(candidate.relativePath),
    )) {
      expect(second.notes.find((note) => note.id === source.itemId)).toMatchObject({
        id: source.itemId,
        sourceId: source.sourceId,
        sourcePath: source.relativePath,
        vault: manifest.vault,
      })
    }
    expect(proof.id).toBe(baseline.vaultSync!.sources.find(
      (source) => source.relativePath === manifest.secondSnapshot.modifiedPath,
    )!.itemId)
    expect(renamed).toMatchObject({
      id: renamedSource.itemId,
      sourceId: renamedSource.sourceId,
      sourcePath: manifest.secondSnapshot.renamedToPath,
      title: '拉格朗日乘子',
    })
    expect(second.notes.filter((note) => note.id === renamedSource.itemId)).toHaveLength(1)
    expect(removed).toMatchObject({ id: removedSource.itemId, status: 'archived' })
    expect(second.vaultSync!.sources.find((source) => source.sourceId === removedSource.sourceId)?.status)
      .toBe('removed')
    expect(second.vaultSync!.revisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'remove', sourceId: removedSource.sourceId }),
    ]))
    expect(resolveNoteRelations(second.notes, proof.id).outgoing.map((note) => note.id)).toContain(added.id)
    expect(resolveNoteRelations(second.notes, proof.id).unresolved).toEqual(['Proofs/Finite Intersection Lemma'])
    expect(resolveNoteRelations(second.notes, renamed.id).outgoing).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: removed.id, status: 'archived' }),
    ]))
  })

  it('updates maintenance and exploration from changed evidence and keeps exact source return', async () => {
    const baseline = await bootstrapSyncedFixture()
    const preview = await scanVaultFiles(mathWorkflowFixtureFiles('second'), baseline, secondScanAt)
    const applied = applyVaultSync(baseline, preview, [])
    const second = await materializeAppliedSync(baseline, applied)
    const beforeSuggestions = generateProjectExplorationSuggestions(baseline, secondScanAt, { limit: 24 })
    const afterSuggestions = generateProjectExplorationSuggestions(second, secondScanAt, { limit: 24 })
    const beforeById = new Map(beforeSuggestions.map((suggestion) => [suggestion.id, suggestion]))
    const changedIds = new Set(applied.changedItemIds)
    const removed = second.notes.find((note) => note.sourcePath === manifest.secondSnapshot.removedPath)!
    const renamed = second.notes.find((note) => note.sourcePath === manifest.secondSnapshot.renamedToPath)!
    const added = second.notes.find((note) => note.sourcePath === manifest.secondSnapshot.addedPath)!
    const openQuestion = second.notes.find((note) => note.sourcePath === manifest.openQuestionPath)!
    const candidates = maintenanceCandidates(second, second.notes.length, Date.parse(secondScanAt))

    for (const suggestion of afterSuggestions) {
      const previous = beforeById.get(suggestion.id)
      if (previous && suggestion.supportingItemIds.every((id) => !changedIds.has(id))) {
        expect(suggestion.evidenceFingerprint).toBe(previous.evidenceFingerprint)
      }
    }
    expect(afterSuggestions.some((suggestion) => suggestion.supportingItemIds.includes(added.id))).toBe(true)
    expect(afterSuggestions.some((suggestion) => suggestion.supportingItemIds.includes(removed.id))).toBe(false)
    expect(candidates.some((candidate) => candidate.note.id === added.id)).toBe(true)
    expect(candidates.some((candidate) => candidate.note.id === removed.id)).toBe(false)
    expect(obsidianUri(openQuestion.sourcePath!, openQuestion.vault)).toBe(
      'obsidian://open?vault=MathResearchVault&file=Research%2FOpen%20Questions',
    )
    expect(obsidianUri(renamed.sourcePath!, renamed.vault)).toBe(
      'obsidian://open?vault=MathResearchVault&file=Optimization%2FConstrained%20Extrema',
    )
    expect(obsidianUri(added.sourcePath!, added.vault)).toBe(
      'obsidian://open?vault=MathResearchVault&file=Physics%2FCompact%20Phase%20Space',
    )
  })
})

async function analyzeFixture(reverse: boolean): Promise<TerrainProject> {
  const parsed = await parseMathWorkflowFixture(reverse)
  return analyzeNotes('MathResearchVault fixture', parsed.notes, {
    embeddingStrategy: 'deterministic',
    gridSize: 32,
    timeZone: 'UTC',
  })
}

async function bootstrapSyncedFixture(): Promise<TerrainProject> {
  const initial = await analyzeFixture(false)
  const preview = await scanVaultFiles(mathWorkflowFixtureFiles(), initial, firstScanAt)
  expect(preview.changes).toEqual([])
  expect(preview.unchangedCount).toBe(manifest.noteCount)
  const applied = applyVaultSync(initial, preview, [])
  const analyzed = await analyzeNotes('MathResearchVault fixture', applied.inputs, {
    embeddingStrategy: 'deterministic',
    gridSize: 32,
    timeZone: 'UTC',
  })
  return {
    ...commitAnalyzedProject(analyzed, initial),
    updatedAt: firstScanAt,
    vaultSync: applied.state,
  }
}

async function materializeAppliedSync(base: TerrainProject, applied: AppliedVaultSync): Promise<TerrainProject> {
  const analyzed = await analyzeNotes(base.name, applied.inputs, {
    embeddingStrategy: 'deterministic',
    gridSize: 32,
    timeZone: 'UTC',
  })
  return {
    ...commitAnalyzedProject(analyzed, base, applied.events),
    updatedAt: secondScanAt,
    vaultSync: applied.state,
  }
}

function summarizePreview(preview: VaultSyncPreview) {
  return {
    unchangedCount: preview.unchangedCount,
    changes: preview.changes,
    conflicts: preview.conflicts,
    issues: preview.issues,
  }
}

function projectInputIdentity(notes: Awaited<ReturnType<typeof parseMathWorkflowFixture>>['notes']) {
  return notes
    .map(({ title, content, sourcePath, links }) => ({ title, content, sourcePath, links }))
    .sort((left, right) => (left.sourcePath ?? '').localeCompare(right.sourcePath ?? ''))
}

function projectIdentity(project: TerrainProject): Array<{ id: string; fingerprint: string; sourcePath?: string }> {
  return project.notes.map(({ id, fingerprint, sourcePath }) => ({ id, fingerprint, sourcePath }))
}

function projectRelations(project: TerrainProject): Array<{ id: string; outgoing: string[]; unresolved: string[] }> {
  return project.notes.map((note) => {
    const relations = resolveNoteRelations(project.notes, note.id)
    return {
      id: note.id,
      outgoing: relations.outgoing.map((target) => target.id),
      unresolved: relations.unresolved,
    }
  })
}
