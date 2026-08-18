/**
 * Builds an Obsidian deep link for an imported Markdown source.
 * A known vault is preferred because a path alone can be ambiguous across vaults.
 */
export function obsidianUri(path: string, vault?: string): string {
  if (!vault) return `obsidian://open?path=${encodeURIComponent(path)}`
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(path.replace(/\.md$/i, ''))}`
}
