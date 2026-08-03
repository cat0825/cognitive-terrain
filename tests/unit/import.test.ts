import { describe, expect, it } from 'vitest'
import { normalizeNoteInputs, parseImportFile } from '../../src/import/parse'

describe('import parsing', () => {
  it('normalizes common field aliases and reports invalid rows', () => {
    const result = normalizeNoteInputs(
      [
        {
          id: 'one',
          name: 'First note',
          body: 'Imported content',
          date: '2026-04-05',
          tags: 'research,terrain',
        },
        { title: 'Missing content' },
        { content: 'Bad date', createdAt: 'not-a-date' },
      ],
      'notes.json',
    )

    expect(result.notes).toHaveLength(1)
    expect(result.notes[0]).toMatchObject({
      id: 'one',
      title: 'First note',
      content: 'Imported content',
      tags: 'research,terrain',
    })
    expect(result.issues).toEqual([
      { file: 'notes.json', row: 2, field: 'content', message: '缺少内容字段' },
      { file: 'notes.json', row: 3, field: 'createdAt', message: '日期无效：not-a-date' },
    ])
  })

  it('parses Markdown frontmatter into a note', async () => {
    const file = new File(
      ['---\ntitle: Terrain idea\ncreatedAt: 2026-05-06\ntags:\n  - map\n  - notes\n---\nA useful connection.'],
      'idea.md',
      { type: 'text/markdown', lastModified: Date.parse('2026-05-06T00:00:00.000Z') },
    )

    const result = await parseImportFile(file)

    expect(result.issues).toEqual([])
    expect(result.notes[0]).toMatchObject({
      title: 'Terrain idea',
      content: 'A useful connection.',
      tags: ['map', 'notes'],
    })
  })
})
