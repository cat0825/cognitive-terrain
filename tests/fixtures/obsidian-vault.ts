import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { ParsedImport } from '../../src/domain/types'
import { parseImportFiles } from '../../src/import/parse'

export interface VaultFixtureManifest {
  vault: string
  noteCount: number
  issueCount: number
  resolvedWikiLinkCount: number
  unresolvedWikiLinkCount: number
  plateCount: number
  bridgeCount: number
  collisionCount: number
  collisionBandCount: number
}

export const vaultFixtureRoot = path.resolve('tests/fixtures/obsidian-vault')
export const vaultFixtureDirectory = path.join(vaultFixtureRoot, 'AtlasVault')

export function readVaultFixtureManifest(): VaultFixtureManifest {
  return JSON.parse(readFileSync(path.join(vaultFixtureRoot, 'manifest.json'), 'utf8')) as VaultFixtureManifest
}

export async function parseVaultFixture(): Promise<ParsedImport> {
  return parseImportFiles(vaultFixtureFiles())
}

export function vaultFixtureFiles(): File[] {
  return markdownPaths(vaultFixtureDirectory).map((absolutePath) => {
    const relativePath = path.relative(path.dirname(vaultFixtureDirectory), absolutePath).split(path.sep).join('/')
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
