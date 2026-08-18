import type {
  FoundationAssignment,
  PrerequisiteDeclaration,
  PrerequisiteDiagnostic,
  PrerequisiteInput,
  PrerequisiteRelation,
  PrerequisiteTopology,
  TerrainNote,
} from './types'

export const PREREQUISITE_TOPOLOGY_VERSION = 1 as const
export const PREREQUISITE_FORMULA_VERSION = 'explicit-prerequisite-dag-v1' as const

export function materializePrerequisites(
  noteId: string,
  inputs: readonly PrerequisiteInput[] | undefined,
): PrerequisiteDeclaration[] {
  const seen = new Set<string>()
  return (inputs ?? []).flatMap((input) => {
    const target = input.target.normalize('NFKC').trim()
    if (!target) return []
    const key = `${input.provenance}\n${input.sourceField}\n${normalizeTitle(target)}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{
      target,
      provenance: input.provenance,
      sourceField: input.sourceField,
      relationId: `prerequisite-${stableHash(`${noteId}\n${key}`)}`,
    }]
  }).sort((a, b) => a.relationId.localeCompare(b.relationId))
}

export function buildPrerequisiteTopology(notes: readonly TerrainNote[]): PrerequisiteTopology {
  const orderedNotes = [...notes].sort((a, b) => a.id.localeCompare(b.id))
  const notesById = new Map(orderedNotes.map((note) => [note.id, note]))
  const titleIndex = buildTitleIndex(orderedNotes)
  const diagnostics: PrerequisiteDiagnostic[] = []
  const candidates: PrerequisiteRelation[] = []

  for (const note of orderedNotes) {
    for (const declaration of [...(note.prerequisites ?? [])].sort((a, b) => a.relationId.localeCompare(b.relationId))) {
      const target = resolveTarget(declaration.target, notesById, titleIndex)
      if (target.kind !== 'resolved') {
        diagnostics.push({
          id: `prerequisite-diagnostic-${stableHash(`${declaration.relationId}\n${target.kind}`)}`,
          kind: target.kind,
          sourceNoteId: note.id,
          relationIds: [declaration.relationId],
          declaredTarget: declaration.target,
          itemIds: [note.id],
        })
        continue
      }
      if (target.itemId === note.id) {
        diagnostics.push({
          id: `prerequisite-diagnostic-${stableHash(`${declaration.relationId}\nself-link`)}`,
          kind: 'self-link',
          sourceNoteId: note.id,
          relationIds: [declaration.relationId],
          declaredTarget: declaration.target,
          itemIds: [note.id],
        })
        continue
      }
      candidates.push({
        id: declaration.relationId,
        sourceNoteId: note.id,
        fromItemId: target.itemId,
        toItemId: note.id,
        declaredTarget: declaration.target,
        provenance: declaration.provenance,
        sourceField: declaration.sourceField,
      })
    }
  }

  const dedupedCandidates = [...new Map(candidates.map((relation) => [relation.id, relation])).values()]
    .sort(compareRelations)
  const cyclicComponents = findCyclicComponents(orderedNotes.map((note) => note.id), dedupedCandidates)
  const cyclicItemIds = new Set(cyclicComponents.flat())
  for (const component of cyclicComponents) {
    const relationIds = dedupedCandidates
      .filter((relation) => component.includes(relation.fromItemId) && component.includes(relation.toItemId))
      .map((relation) => relation.id)
      .sort()
    diagnostics.push({
      id: `prerequisite-diagnostic-${stableHash(`cycle\n${component.join('\n')}\n${relationIds.join('\n')}`)}`,
      kind: 'cycle',
      sourceNoteId: component[0],
      relationIds,
      itemIds: [...component],
    })
  }

  const relations = dedupedCandidates.filter(
    (relation) => !cyclicItemIds.has(relation.fromItemId) && !cyclicItemIds.has(relation.toItemId),
  )
  const assignments = deriveAssignments(orderedNotes, relations, cyclicItemIds)
  return {
    version: PREREQUISITE_TOPOLOGY_VERSION,
    formulaVersion: PREREQUISITE_FORMULA_VERSION,
    relations,
    diagnostics: diagnostics.sort(compareDiagnostics),
    assignments,
  }
}

export function prerequisiteDepthValues(topology: PrerequisiteTopology | undefined): ReadonlyMap<string, number> {
  const derived = (topology?.assignments ?? []).filter((assignment) => assignment.status === 'derived')
  const maxDepth = Math.max(1, ...derived.map((assignment) => assignment.depth ?? 0))
  return new Map(derived.map((assignment) => [
    assignment.itemId,
    0.2 + 0.8 * ((assignment.depth ?? 0) / maxDepth),
  ]))
}

function deriveAssignments(
  notes: readonly TerrainNote[],
  relations: readonly PrerequisiteRelation[],
  cyclicItemIds: ReadonlySet<string>,
): FoundationAssignment[] {
  const parents = new Map<string, PrerequisiteRelation[]>()
  const children = new Map<string, PrerequisiteRelation[]>()
  const participating = new Set<string>()
  for (const relation of relations) {
    participating.add(relation.fromItemId)
    participating.add(relation.toItemId)
    append(parents, relation.toItemId, relation)
    append(children, relation.fromItemId, relation)
  }
  for (const values of parents.values()) values.sort(compareRelations)
  for (const values of children.values()) values.sort(compareRelations)

  const indegree = new Map([...participating].map((itemId) => [itemId, parents.get(itemId)?.length ?? 0]))
  const queue = [...participating].filter((itemId) => indegree.get(itemId) === 0).sort()
  const ordered: string[] = []
  while (queue.length) {
    const itemId = queue.shift()!
    ordered.push(itemId)
    for (const relation of children.get(itemId) ?? []) {
      const next = (indegree.get(relation.toItemId) ?? 0) - 1
      indegree.set(relation.toItemId, next)
      if (next === 0) insertSorted(queue, relation.toItemId)
    }
  }

  const depth = new Map<string, number>()
  const branches = new Map<string, Set<string>>()
  const pathEvidence = new Map<string, Set<string>>()
  for (const itemId of ordered) {
    const incoming = parents.get(itemId) ?? []
    if (!incoming.length) {
      depth.set(itemId, 0)
      branches.set(itemId, new Set([itemId]))
      pathEvidence.set(itemId, new Set())
      continue
    }
    depth.set(itemId, Math.max(...incoming.map((relation) => depth.get(relation.fromItemId) ?? 0)) + 1)
    branches.set(itemId, new Set(incoming.flatMap((relation) => [...(branches.get(relation.fromItemId) ?? [])])))
    pathEvidence.set(itemId, new Set(incoming.flatMap((relation) => [
      ...(pathEvidence.get(relation.fromItemId) ?? []),
      relation.id,
    ])))
  }

  const relationById = new Map(relations.map((relation) => [relation.id, relation]))
  return notes.map((note) => {
    if (cyclicItemIds.has(note.id)) return neutralAssignment(note.id, 'excluded')
    if (!participating.has(note.id)) return neutralAssignment(note.id, 'neutral')
    const incoming = parents.get(note.id) ?? []
    const relationIds = (incoming.length
      ? [...(pathEvidence.get(note.id) ?? [])]
      : (children.get(note.id) ?? []).map((relation) => relation.id)
    ).sort()
    return {
      itemId: note.id,
      status: 'derived',
      depth: depth.get(note.id) ?? 0,
      branchRootIds: [...(branches.get(note.id) ?? [])].sort(),
      relationIds,
      sourceNoteIds: [...new Set(relationIds.map((id) => relationById.get(id)?.sourceNoteId).filter(isString))].sort(),
    }
  })
}

function findCyclicComponents(itemIds: readonly string[], relations: readonly PrerequisiteRelation[]): string[][] {
  const adjacency = new Map<string, string[]>()
  for (const relation of relations) append(adjacency, relation.fromItemId, relation.toItemId)
  for (const values of adjacency.values()) values.sort()
  let nextIndex = 0
  const indices = new Map<string, number>()
  const lowLinks = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const components: string[][] = []

  const visit = (itemId: string): void => {
    indices.set(itemId, nextIndex)
    lowLinks.set(itemId, nextIndex)
    nextIndex += 1
    stack.push(itemId)
    onStack.add(itemId)
    for (const target of adjacency.get(itemId) ?? []) {
      if (!indices.has(target)) {
        visit(target)
        lowLinks.set(itemId, Math.min(lowLinks.get(itemId)!, lowLinks.get(target)!))
      } else if (onStack.has(target)) {
        lowLinks.set(itemId, Math.min(lowLinks.get(itemId)!, indices.get(target)!))
      }
    }
    if (lowLinks.get(itemId) !== indices.get(itemId)) return
    const component: string[] = []
    while (stack.length) {
      const current = stack.pop()!
      onStack.delete(current)
      component.push(current)
      if (current === itemId) break
    }
    component.sort()
    if (component.length > 1) components.push(component)
  }
  for (const itemId of [...itemIds].sort()) if (!indices.has(itemId)) visit(itemId)
  return components.sort((a, b) => a[0].localeCompare(b[0]))
}

function buildTitleIndex(notes: readonly TerrainNote[]): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const note of notes) append(index, normalizeTitle(note.title), note.id)
  for (const values of index.values()) values.sort()
  return index
}

function resolveTarget(
  target: string,
  notesById: ReadonlyMap<string, TerrainNote>,
  titleIndex: ReadonlyMap<string, string[]>,
): { kind: 'resolved'; itemId: string } | { kind: 'unresolved-target' | 'ambiguous-title' } {
  const normalized = target.normalize('NFKC').trim()
  if (notesById.has(normalized)) return { kind: 'resolved', itemId: normalized }
  const matches = titleIndex.get(normalizeTitle(normalized)) ?? []
  if (matches.length === 1) return { kind: 'resolved', itemId: matches[0] }
  return { kind: matches.length > 1 ? 'ambiguous-title' : 'unresolved-target' }
}

function neutralAssignment(itemId: string, status: 'neutral' | 'excluded'): FoundationAssignment {
  return { itemId, status, branchRootIds: [], relationIds: [], sourceNoteIds: [] }
}

function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key)
  if (values) values.push(value)
  else map.set(key, [value])
}

function insertSorted(values: string[], value: string): void {
  const index = values.findIndex((candidate) => candidate.localeCompare(value) > 0)
  if (index < 0) values.push(value)
  else values.splice(index, 0, value)
}

function compareRelations(a: PrerequisiteRelation, b: PrerequisiteRelation): number {
  return a.fromItemId.localeCompare(b.fromItemId) || a.toItemId.localeCompare(b.toItemId) || a.id.localeCompare(b.id)
}

function compareDiagnostics(a: PrerequisiteDiagnostic, b: PrerequisiteDiagnostic): number {
  return a.kind.localeCompare(b.kind) || a.sourceNoteId.localeCompare(b.sourceNoteId) || a.id.localeCompare(b.id)
}

function normalizeTitle(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase()
}

function isString(value: string | undefined): value is string {
  return value !== undefined
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
