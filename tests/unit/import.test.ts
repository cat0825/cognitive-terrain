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

  it('parses Obsidian state fields and wikilinks', async () => {
    const file = new File(
      ['---\ntitle: Attention\nmastery: 0.35\nconfidence: 0.6\nexploration: 0.9\nstatus: growing\narea: 数学\n---\n先理解 [[线性代数]]，再看 [[概率论|概率]].'],
      'attention.md',
      { type: 'text/markdown' },
    )
    const result = await parseImportFile(file)
    expect(result.notes[0]).toMatchObject({
      mastery: 0.35,
      confidence: 0.6,
      exploration: 0.9,
      status: 'growing',
      area: '数学',
      links: ['线性代数', '概率论'],
    })
  })

  it('uses the embedded project name for structured imports', async () => {
    const file = new File(
      [
        JSON.stringify({
          name: 'Eriri 知识地形',
          notes: [
            {
              title: 'Imported note',
              content: 'Imported content',
              createdAt: '2026-08-07T00:00:00.000Z',
            },
          ],
        }),
      ],
      'tolaria-obsidian.preview.json',
      { type: 'application/json' },
    )

    const result = await parseImportFile(file)

    expect(result.name).toBe('Eriri 知识地形')
    expect(result.notes).toHaveLength(1)
  })

  it('derives vault and relative path from a folder import', async () => {
    const file = new File(['---\ntitle: 注意力\n---\n正文'], 'attention.md', { type: 'text/markdown' })
    Object.defineProperty(file, 'webkitRelativePath', { value: 'eriri/Knowledge/attention.md' })

    const result = await parseImportFile(file)

    expect(result.notes[0]).toMatchObject({ vault: 'eriri', sourcePath: 'Knowledge/attention.md' })
  })

  it('falls back to the file name when there is no folder context', async () => {
    const file = new File(['---\ntitle: 注意力\n---\n正文'], 'attention.md', { type: 'text/markdown' })

    const result = await parseImportFile(file)

    expect(result.notes[0]?.vault).toBeUndefined()
    expect(result.notes[0]?.sourcePath).toBe('attention.md')
  })

  it('lets frontmatter vault win over the folder name', async () => {
    const file = new File(['---\ntitle: 注意力\nvault: tolaria\n---\n正文'], 'attention.md', { type: 'text/markdown' })
    Object.defineProperty(file, 'webkitRelativePath', { value: 'eriri/attention.md' })

    const result = await parseImportFile(file)

    expect(result.notes[0]?.vault).toBe('tolaria')
  })

  it('reads vault from structured records', () => {
    const result = normalizeNoteInputs(
      [{ title: 'Note', content: 'Body', createdAt: '2026-04-05', vault: 'eriri', path: 'Knowledge/note.md' }],
      'notes.json',
    )

    expect(result.notes[0]).toMatchObject({ vault: 'eriri', sourcePath: 'Knowledge/note.md' })
  })
})
