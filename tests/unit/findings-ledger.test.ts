import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const LEDGER = 'docs/review/findings-ledger.md'
const AUDIT = 'docs/review/2026-08-18-independent-audit.md'

/** Every finding the audit raised, by its own label. */
const FINDINGS = ['H1', 'H2', 'H3', 'M1', 'M2', 'M3', 'M4', 'L1', 'L2'] as const
const STATES = ['fixed', 'accepted', 'tracked'] as const

describe('audit findings ledger', () => {
  it('commits the audit report so issue references resolve', () => {
    expect(existsSync(AUDIT)).toBe(true)
    expect(existsSync(LEDGER)).toBe(true)
  })

  it('gives every finding exactly one state', () => {
    const rows = ledgerRows()
    for (const finding of FINDINGS) {
      const matching = rows.filter((row) => row.cells[0]?.startsWith(finding))
      expect(matching, `${finding} 没有台账行`).toHaveLength(1)
      const state = matching[0].cells[1]
      expect(STATES, `${finding} 的状态 "${state}" 不在允许集合内`).toContain(state)
    }
  })

  it('backs every fixed finding with a PR or merge commit', () => {
    for (const row of ledgerRows()) {
      if (row.cells[1] !== 'fixed') continue
      const evidence = row.cells[3] ?? ''
      const hasReference = /pull\/\d+/.test(evidence) || /`[0-9a-f]{7,40}`/.test(evidence) || evidence.includes('本 PR')
      expect(hasReference, `${row.cells[0]} 标为 fixed 但没有 PR 或 merge commit`).toBe(true)
    }
  })

  it('records who accepted each exception and why', () => {
    const ledger = readFileSync(LEDGER, 'utf8')
    const exceptions = ledger.slice(ledger.indexOf('## 明确接受的例外'))
    expect(exceptions).toMatch(/接受人/)
    const headings = [...exceptions.matchAll(/^### (A\d) /gm)].map((match) => match[1])
    expect(headings.length).toBeGreaterThanOrEqual(4)
    for (const heading of headings) {
      const section = sectionFor(exceptions, heading)
      expect(section, `${heading} 缺少接受理由`).toMatch(/接受理由/)
    }
  })

  it('records an explicit decision for the npm audit high findings', () => {
    const ledger = readFileSync(LEDGER, 'utf8')
    for (const token of ['adm-zip', 'sharp', 'onnxruntime-node', 'accepted']) {
      expect(ledger, `依赖决策缺少 ${token}`).toContain(token)
    }
    // An accepted dependency finding without a re-review trigger is just an
    // ignored one, so the ledger has to say what would invalidate it.
    expect(ledger).toMatch(/复核条件/)
  })

  it('states the output/ decision and keeps it consistent with .gitignore', () => {
    const ledger = readFileSync(LEDGER, 'utf8')
    expect(ledger).toContain('output/imagegen')
    const ignore = readFileSync('.gitignore', 'utf8')
    expect(ignore).toMatch(/^output\/imagegen$/m)
  })

  it('keeps the handoff doc pinned to a commit and not citable as current state', () => {
    const session = readFileSync('SESSION.md', 'utf8')
    const head = session.slice(0, session.indexOf('## '))
    expect(head, 'SESSION.md 顶部缺少 commit pin').toMatch(/[0-9a-f]{40}/)
    expect(head).toMatch(/不是状态源|不是实时状态源/)
    expect(head).toMatch(/fetch --prune/)
  })

  it('links only files that exist', () => {
    const ledger = readFileSync(LEDGER, 'utf8')
    for (const [, target] of ledger.matchAll(/\]\((\.\.?\/[^)\s]+)\)/g)) {
      const resolved = target.startsWith('../../')
        ? target.replace('../../', '')
        : `docs/${target.replace('../', '')}`
      expect(existsSync(resolved), `台账引用了不存在的文件 ${target} -> ${resolved}`).toBe(true)
    }
  })
})

function ledgerRows(): Array<{ cells: string[] }> {
  return readFileSync(LEDGER, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| ---') && !line.startsWith('| 发现') && !line.startsWith('| 项目') && !line.startsWith('| 目录'))
    .map((line) => ({ cells: line.split('|').slice(1, -1).map((cell) => cell.trim()) }))
}

function sectionFor(text: string, heading: string): string {
  const start = text.indexOf(`### ${heading} `)
  const next = text.indexOf('\n### ', start + 1)
  return text.slice(start, next === -1 ? undefined : next)
}
