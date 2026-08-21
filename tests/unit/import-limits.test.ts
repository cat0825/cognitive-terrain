import { describe, expect, it } from 'vitest'
import {
  buildImportPreflight,
  DEFAULT_IMPORT_LIMITS,
  duplicateNoteInputIds,
  ImportLimitError,
  importLimits,
  trimImportToLimits,
  validateImportSelection,
} from '../../src/import/import-limits'
import { parseImportFiles } from '../../src/import/parse'

describe('import limits and pre-flight', () => {
  it('rejects too many files, an oversized file, and an oversized batch with actual values', () => {
    const limits = importLimits({ maxFiles: 1, maxFileBytes: 4, maxTotalBytes: 5 })
    const files = [new File(['12345'], 'first.md'), new File(['12'], 'second.md')]

    expect(() => validateImportSelection(files, limits)).toThrow(ImportLimitError)
    try {
      validateImportSelection(files, limits)
    } catch (error) {
      expect(error).toBeInstanceOf(ImportLimitError)
      expect((error as ImportLimitError).issues.map((issue) => issue.code)).toEqual(['file-count', 'file-bytes', 'total-bytes'])
      expect((error as ImportLimitError).message).toContain('实际 5 bytes')
      expect((error as ImportLimitError).message).toContain('允许 4 bytes')
    }
  })

  it('reports record and content limits before analysis', async () => {
    const limits = importLimits({ maxRecords: 2, maxContentChars: 4 })
    const file = new File([
      JSON.stringify([
        { id: 'one', content: '12345', createdAt: '2026-01-01' },
        { id: 'two', content: '23456', createdAt: '2026-01-02' },
        { id: 'three', content: '34567', createdAt: '2026-01-03' },
      ]),
    ], 'notes.json', { type: 'application/json' })

    const parsed = await parseImportFiles([file], { limits })

    expect(parsed.recordCount).toBe(3)
    expect(parsed.notes).toHaveLength(3)
    expect(parsed.preflight?.blockingIssues.map((issue) => issue.code)).toEqual([
      'content-length', 'content-length', 'content-length', 'record-count',
    ])
    expect(parsed.preflight?.blockingIssues[0]?.actual).toBe(5)
    expect(parsed.preflight?.blockingIssues[0]?.allowed).toBe(4)
  })

  it('detects duplicate IDs, invalid and future timestamps, and unknown taxonomy labels', async () => {
    const now = Date.parse('2026-08-20T00:00:00.000Z')
    const file = new File([
      JSON.stringify([
        { id: 'same', content: 'one', createdAt: '2026-01-01', area: 'Known' },
        { id: 'same', content: 'two', createdAt: '2026-01-02', area: 'Unknown' },
        { id: 'invalid', content: 'bad time', createdAt: 'not-a-date', area: 'Unknown' },
        { id: 'future', content: 'three', createdAt: '2026-08-21', area: 'Unknown' },
      ]),
    ], 'notes.json', { type: 'application/json' })

    const parsed = await parseImportFiles([file], {
      now,
      taxonomy: {
        workspaceId: 'workspace',
        nodes: [{
          id: 'known', workspaceId: 'workspace', label: 'Known', aliases: [], version: 1, status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        }],
      },
    })

    expect(parsed.preflight?.duplicateIds).toEqual(['same'])
    expect(parsed.preflight?.invalidTimestampCount).toBe(1)
    expect(parsed.preflight?.futureTimestampCount).toBe(1)
    expect(parsed.preflight?.unknownTaxonomyLabels).toEqual(['Unknown'])
  })

  it('keeps parse concurrency bounded and responds to cancellation', async () => {
    let active = 0
    let peak = 0
    const files = Array.from({ length: 12 }, (_, index) => {
      const file = new File([`content ${index}`], `note-${index}.md`)
      const originalText = file.text.bind(file)
      file.text = async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 2))
        const result = await originalText()
        active -= 1
        return result
      }
      return file
    })

    const parsed = await parseImportFiles(files, { limits: { parseConcurrency: 3 } })
    expect(parsed.notes).toHaveLength(12)
    expect(peak).toBeLessThanOrEqual(3)

    const controller = new AbortController()
    const pending = parseImportFiles(files, { signal: controller.signal, limits: { parseConcurrency: 2 } })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('trims only after the user explicitly chooses the bounded path', async () => {
    const parsed = await parseImportFiles([new File([
      JSON.stringify([
        { id: 'same', content: '123456', createdAt: '2026-01-01' },
        { id: 'same', content: 'abcdef', createdAt: '2026-01-02' },
        { id: 'three', content: 'xyzxyz', createdAt: '2026-01-03' },
      ]),
    ], 'notes.json')], { limits: importLimits({ maxRecords: 2, maxContentChars: 4 }) })

    const trimmed = trimImportToLimits(parsed, importLimits({ maxRecords: 2, maxContentChars: 4 }))
    expect(trimmed.notes.map((note) => note.id)).toEqual(['same', 'three'])
    expect(trimmed.notes.every((note) => note.content.length <= 4)).toBe(true)
    expect(trimmed.preflight?.blockingIssues).toEqual([])
    expect(trimmed.preflight?.trimmed).toMatchObject({ records: 1, duplicateIds: 1, contentChars: 4 })
  })

  it('reports every record removed from an import larger than the retained parse sample', async () => {
    const values = Array.from({ length: 8 }, (_, index) => ({
      id: `note-${index}`,
      content: `content-${index}`,
      createdAt: '2026-01-01',
    }))
    const limits = importLimits({ maxRecords: 2 })
    const parsed = await parseImportFiles([
      new File([JSON.stringify(values)], 'large.json'),
    ], { limits })

    expect(parsed.recordCount).toBe(8)
    expect(parsed.notes).toHaveLength(3)

    const trimmed = trimImportToLimits(parsed, limits)
    expect(trimmed.notes).toHaveLength(2)
    expect(trimmed.preflight?.trimmed?.records).toBe(6)
  })

  it('retains one global pre-flight sample instead of one maximum-sized sample per file', async () => {
    const files = Array.from({ length: 4 }, (_, fileIndex) => new File([
      JSON.stringify(Array.from({ length: 4 }, (_, recordIndex) => ({
        id: `${fileIndex}-${recordIndex}`,
        content: `content-${fileIndex}-${recordIndex}`,
        createdAt: '2026-01-01',
      }))),
    ], `batch-${fileIndex}.json`))
    const limits = importLimits({ maxRecords: 2, parseConcurrency: 2 })

    const parsed = await parseImportFiles(files, { limits })

    expect(parsed.recordCount).toBe(16)
    expect(parsed.notes.map((note) => note.id)).toEqual(['0-0', '0-1', '0-2'])
  })

  it('exposes stable duplicate detection for the merge stage to reuse', () => {
    expect(duplicateNoteInputIds([
      { id: 'b', content: 'b', createdAt: '2026-01-01' },
      { id: 'a', content: 'a', createdAt: '2026-01-01' },
      { id: 'b', content: 'b2', createdAt: '2026-01-02' },
      { content: 'no id', createdAt: '2026-01-03' },
    ])).toEqual(['b'])
  })

  it('does not turn warnings into blockers', () => {
    const report = buildImportPreflight({
      files: [new File(['x'], 'note.md')],
      notes: [{ content: 'x', createdAt: '2026-01-01', area: 'Unknown', declaredAreas: ['Unknown'] }],
      issues: [],
      recordCount: 1,
      contentViolations: [],
      limits: DEFAULT_IMPORT_LIMITS,
      taxonomy: { workspaceId: 'workspace', nodes: [] },
    })
    expect(report.unknownTaxonomyLabels).toEqual(['Unknown'])
    expect(report.blockingIssues).toEqual([])
  })
})
