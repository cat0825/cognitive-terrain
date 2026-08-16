import { describe, expect, it } from 'vitest'
import {
  createTaxonomyNode,
  legacyTaxonomyNodesForProject,
  mergeTaxonomyNodes,
  normalizeTaxonomyAlias,
  previewTaxonomyMerge,
  previewTaxonomyRename,
  reparentTaxonomyNode,
  renameTaxonomyNode,
  resolveTaxonomyAlias,
  taxonomyNodeIdFor,
  unresolvedTaxonomyAliases,
  validateTaxonomy,
} from '../../src/domain/taxonomy'
import type { TaxonomyNode } from '../../src/domain/types'

const NOW = '2026-08-17T00:00:00.000Z'

function taxonomyFixture(): { root: TaxonomyNode; child: TaxonomyNode; sibling: TaxonomyNode; otherWorkspace: TaxonomyNode } {
  const root = createTaxonomyNode({ workspaceId: 'workspace-a', label: '数学', aliases: ['Math'] }, NOW)
  const child = createTaxonomyNode({
    workspaceId: 'workspace-a',
    label: '线性  代数',
    parentId: root.id,
    aliases: ['LA', 'Linear Algebra'],
  }, NOW)
  const sibling = createTaxonomyNode({ workspaceId: 'workspace-a', label: '概率论' }, NOW)
  const otherWorkspace = createTaxonomyNode({ workspaceId: 'workspace-b', label: '物理' }, NOW)
  return { root, child, sibling, otherWorkspace }
}

describe('taxonomy normalization and alias resolution', () => {
  it('normalizes Unicode compatibility forms, whitespace, and case deterministically', () => {
    expect(normalizeTaxonomyAlias('  ＡＢＣ\u3000  D  ')).toBe('abc d')
    expect(taxonomyNodeIdFor('  workspace-a  ', ' ＡＢＣ ')).toBe(taxonomyNodeIdFor('workspace-a', 'abc'))
  })

  it('resolves aliases within a workspace and keeps unresolved source spelling once', () => {
    const { root, child } = taxonomyFixture()
    const nodes = [root, child]

    expect(resolveTaxonomyAlias(nodes, 'workspace-a', '  linear\u3000algebra ')).toMatchObject({ id: child.id })
    expect(resolveTaxonomyAlias(nodes, 'workspace-b', 'Math')).toBeUndefined()
    expect(unresolvedTaxonomyAliases([' Unknown ', 'unknown', 'Math'], nodes, 'workspace-a')).toEqual([' Unknown '])
  })

  it('creates legacy nodes with normalized labels while preserving the first declared spelling', () => {
    const nodes = legacyTaxonomyNodesForProject('workspace-a', ['  Physics  ', 'physics', ' 数学 '], NOW)

    expect(nodes.map((node) => node.label)).toEqual(['Physics', '数学'])
    expect(nodes.every((node) => node.workspaceId === 'workspace-a' && node.version === 1)).toBe(true)
  })
})

describe('taxonomy maintenance mutations', () => {
  it('renames without changing the node ID or item memberships and reports affected items', () => {
    const { root, child } = taxonomyFixture()
    const memberships = [{ itemId: 'item-1', taxonomyNodeId: child.id, weight: 1 }]
    const preview = previewTaxonomyRename([root, child], child.id, memberships)
    const result = renameTaxonomyNode([root, child], child.id, '线性代数', memberships, '2026-08-17T01:00:00.000Z')
    const renamed = result.nodes.find((node) => node.id === child.id)

    expect(preview).toMatchObject({ kind: 'rename', nodeId: child.id, affectedItemIds: ['item-1'] })
    expect(renamed).toMatchObject({ id: child.id, label: '线性代数', parentId: root.id, version: child.version + 1 })
    expect(renamed?.aliases).toContain('线性 代数')
    expect(result.memberships).toEqual(memberships)
  })

  it('reparents without changing node or membership IDs', () => {
    const { root, child, sibling } = taxonomyFixture()
    const memberships = [{ itemId: 'item-1', taxonomyNodeId: child.id }]
    const result = reparentTaxonomyNode([root, child, sibling], child.id, sibling.id, memberships, '2026-08-17T01:00:00.000Z')
    const moved = result.nodes.find((node) => node.id === child.id)

    expect(moved).toMatchObject({ id: child.id, parentId: sibling.id, version: child.version + 1 })
    expect(result.memberships).toEqual(memberships)
    expect(result.preview).toMatchObject({ kind: 'reparent', nodeId: child.id, targetNodeId: sibling.id })
  })

  it('merges memberships into the target, archives the source, and exposes a recovery preview', () => {
    const { root, child, sibling } = taxonomyFixture()
    const memberships = [
      { itemId: 'item-1', taxonomyNodeId: child.id },
      { itemId: 'item-2', taxonomyNodeId: sibling.id },
    ]
    const preview = previewTaxonomyMerge([root, child, sibling], child.id, sibling.id, memberships)
    const result = mergeTaxonomyNodes([root, child, sibling], child.id, sibling.id, memberships, '2026-08-17T01:00:00.000Z')

    expect(preview).toMatchObject({ kind: 'merge', nodeId: child.id, targetNodeId: sibling.id, affectedItemIds: ['item-1'] })
    expect(result.nodes.find((node) => node.id === child.id)).toMatchObject({ id: child.id, status: 'archived' })
    expect(result.nodes.find((node) => node.id === sibling.id)).toMatchObject({ id: sibling.id, version: sibling.version + 1 })
    expect(result.memberships).toEqual([
      { itemId: 'item-1', taxonomyNodeId: sibling.id },
      { itemId: 'item-2', taxonomyNodeId: sibling.id },
    ])
  })

  it('reparents source children during merge and rejects merging into a descendant', () => {
    const { root, child, sibling } = taxonomyFixture()
    const changedAt = '2026-08-17T01:00:00.000Z'
    const merged = mergeTaxonomyNodes([root, child, sibling], root.id, sibling.id, [], changedAt)

    expect(merged.nodes.find((node) => node.id === child.id)).toMatchObject({ parentId: sibling.id })
    expect(merged.preview.affectedNodeIds).toEqual(expect.arrayContaining([root.id, child.id, sibling.id]))
    expect(() => mergeTaxonomyNodes([root, child, sibling], root.id, child.id, [], changedAt)).toThrow(/create a cycle/)
  })
})

describe('taxonomy integrity boundaries', () => {
  it('rejects hierarchy cycles and cross-workspace parents', () => {
    const { root, child, otherWorkspace } = taxonomyFixture()

    expect(() => reparentTaxonomyNode([root, child], root.id, child.id)).toThrow(/cycle detected/)
    expect(() => reparentTaxonomyNode([root, child, otherWorkspace], child.id, otherWorkspace.id)).toThrow(/crosses workspace boundary/)
  })

  it('rejects cross-workspace merges and ambiguous aliases', () => {
    const { root, otherWorkspace } = taxonomyFixture()

    expect(() => mergeTaxonomyNodes([root, otherWorkspace], root.id, otherWorkspace.id)).toThrow(/across workspaces/)
    expect(() => validateTaxonomy([
      root,
      createTaxonomyNode({ workspaceId: 'workspace-a', label: '物理', aliases: ['Math'] }, NOW),
    ])).toThrow(/resolves ambiguously/)
  })
})
