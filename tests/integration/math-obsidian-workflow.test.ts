import { describe, expect, it } from 'vitest'
import { maintenanceCandidates, resolveNoteRelations } from '../../src/domain/knowledge-maintenance'
import type { TerrainProject } from '../../src/domain/types'
import { obsidianUri } from '../../src/import/obsidian-uri'
import { analyzeNotes } from '../../src/pipeline/run-pipeline'
import { parseMathWorkflowFixture, readMathWorkflowManifest } from '../fixtures/math-obsidian-workflow'

const manifest = readMathWorkflowManifest()
const fixedNow = Date.parse('2026-08-17T08:00:00.000Z')

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
})

async function analyzeFixture(reverse: boolean): Promise<TerrainProject> {
  const parsed = await parseMathWorkflowFixture(reverse)
  return analyzeNotes('MathResearchVault fixture', parsed.notes, {
    embeddingStrategy: 'deterministic',
    gridSize: 32,
    timeZone: 'UTC',
  })
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
