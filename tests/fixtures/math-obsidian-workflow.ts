import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { ParsedImport } from '../../src/domain/types'
import { parseImportFiles } from '../../src/import/parse'

export interface MathWorkflowManifest {
  vault: string
  noteCount: number
  issueCount: number
  resolvedWikiLinkCount: number
  unresolvedWikiLinkCount: number
  openQuestionPath: string
}

export const mathWorkflowFixtureRoot = path.resolve('tests/fixtures/math-obsidian-workflow')
export const mathWorkflowVaultDirectory = path.join(mathWorkflowFixtureRoot, 'MathResearchVault')

export function readMathWorkflowManifest(): MathWorkflowManifest {
  return JSON.parse(readFileSync(path.join(mathWorkflowFixtureRoot, 'manifest.json'), 'utf8')) as MathWorkflowManifest
}

export async function parseMathWorkflowFixture(reverse = false): Promise<ParsedImport> {
  const files = mathWorkflowFixtureFiles()
  return parseImportFiles(reverse ? files.reverse() : files)
}

export function mathWorkflowFixtureFiles(): File[] {
  return markdownPaths(mathWorkflowVaultDirectory).map((absolutePath) => {
    const relativePath = path.relative(path.dirname(mathWorkflowVaultDirectory), absolutePath).split(path.sep).join('/')
    const file = new File([readFileSync(absolutePath)], path.basename(absolutePath), {
      type: 'text/markdown',
      lastModified: 1_735_689_600_000,
    })
    Object.defineProperty(file, 'webkitRelativePath', { value: relativePath })
    return file
  })
}

function markdownPaths(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) return markdownPaths(absolutePath)
      return entry.isFile() && entry.name.endsWith('.md') ? [absolutePath] : []
    })
    .sort((left, right) => left.localeCompare(right))
}
