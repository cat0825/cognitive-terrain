import type {
  CognitiveStateProvenance,
  ImportIssue,
  InteractionEvent,
  NoteInput,
  TerrainNote,
  TerrainProject,
  VaultSourceState,
  VaultSyncField,
  VaultSyncNoteSnapshot,
  VaultSyncRevision,
  VaultSyncState,
} from './types'

export const VAULT_SYNC_VERSION = 1 as const

const SYNC_FIELDS: readonly VaultSyncField[] = [
  'title',
  'content',
  'createdAt',
  'tags',
  'weight',
  'mastery',
  'confidence',
  'exploration',
  'status',
  'areas',
  'reviewedAt',
  'links',
]

const FRONTMATTER_FIELDS: readonly VaultSyncField[] = [
  'title',
  'createdAt',
  'tags',
  'weight',
  'mastery',
  'confidence',
  'exploration',
  'status',
  'areas',
  'reviewedAt',
]

export interface VaultScanFile {
  path: string
  rawContentHash: string
  lastModifiedMs?: number
  size?: number
  note?: NoteInput
  invalidFields: VaultSyncField[]
  issues: ImportIssue[]
}

export interface VaultScanResult {
  vaultId: string
  vaultName: string
  accessMode: 'directory-handle' | 'reselect-files'
  scannedAt: string
  complete: boolean
  files: VaultScanFile[]
  issues: ImportIssue[]
}

export type VaultSyncChangeKind = 'added' | 'modified' | 'renamed' | 'removed'

export interface VaultSyncChange {
  id: string
  kind: VaultSyncChangeKind
  path: string
  previousPath?: string
  itemId?: string
  sourceId?: string
  fields: VaultSyncField[]
  conflictIds: string[]
}

export interface VaultSyncConflict {
  id: string
  changeId: string
  kind: 'field' | 'remove-modified' | 'ambiguous-rename' | 'path-collision'
  path: string
  field?: VaultSyncField
  detail: string
}

export interface VaultSyncPreview {
  projectId: string
  baseProjectUpdatedAt: string
  vaultId: string
  vaultName: string
  accessMode: 'directory-handle' | 'reselect-files'
  scannedAt: string
  complete: boolean
  bootstrap: boolean
  changes: VaultSyncChange[]
  conflicts: VaultSyncConflict[]
  issues: ImportIssue[]
  unchangedCount: number
  scanFiles: VaultScanFile[]
}

export interface VaultSyncResolution {
  conflictId: string
  choice: 'app' | 'source'
}

export interface AppliedVaultSync {
  inputs: NoteInput[]
  state: VaultSyncState
  events: InteractionEvent[]
  changedItemIds: string[]
}

export function buildVaultSyncPreview(
  project: TerrainProject,
  scan: VaultScanResult,
): VaultSyncPreview {
  const existingVault = project.vaultSync?.vaults.find((vault) => vault.vaultId === scan.vaultId)
  const bootstrap = existingVault === undefined
  const baseline = bootstrap
    ? bootstrapSources(project, scan)
    : (project.vaultSync?.sources ?? []).filter((source) => source.vaultId === scan.vaultId)
  const presentBaseline = baseline.filter((source) => source.status === 'present')
  const baselineByPath = uniqueIndex(presentBaseline, (source) => normalizePath(source.relativePath))
  const scannedByPath = uniqueIndex(scan.files, (file) => normalizePath(file.path))
  const pathCollisions = [...baselineByPath.collisions, ...scannedByPath.collisions]
  const matchedSources = new Set<string>()
  const matchedPaths = new Set<string>()
  const changes: VaultSyncChange[] = []
  const conflicts: VaultSyncConflict[] = []
  let unchangedCount = 0

  for (const [pathKey, file] of scannedByPath.unique) {
    const source = baselineByPath.unique.get(pathKey)
    if (!source) continue
    matchedSources.add(source.sourceId)
    matchedPaths.add(pathKey)
    const bootstrapEquivalent = bootstrap
      && file.note
      && source.entityHash === entityHash(normalizedIncomingSnapshot(file.note, source.acceptedNote, file.invalidFields))
    if (
      source.relativePath === file.path
      && (bootstrap ? bootstrapEquivalent : source.rawContentHash === file.rawContentHash)
    ) {
      unchangedCount += 1
      continue
    }
    changes.push(changeForSource(
      source.relativePath === file.path ? 'modified' : 'renamed',
      source,
      file,
      project,
      conflicts,
      bootstrap,
    ))
  }

  const missingSources = presentBaseline.filter((source) => !matchedSources.has(source.sourceId))
  const newFiles = scan.files.filter((file) => !matchedPaths.has(normalizePath(file.path)))
  const renameMatches = matchRenames(missingSources, newFiles)
  for (const match of renameMatches.matches) {
    matchedSources.add(match.source.sourceId)
    matchedPaths.add(normalizePath(match.file.path))
    changes.push(changeForSource('renamed', match.source, match.file, project, conflicts))
  }

  for (const ambiguous of renameMatches.ambiguous) {
    for (const candidate of ambiguous.candidates) matchedSources.add(candidate.sourceId)
    const change = addedChange(scan.vaultId, ambiguous.file)
    const conflict = makeConflict(
      change.id,
      'ambiguous-rename',
      ambiguous.file.path,
      `存在 ${ambiguous.candidates.length} 个可能的原路径，请修正 vault 中的重复身份后重新扫描`,
    )
    change.conflictIds.push(conflict.id)
    changes.push(change)
    conflicts.push(conflict)
    matchedPaths.add(normalizePath(ambiguous.file.path))
  }

  for (const file of newFiles) {
    if (matchedPaths.has(normalizePath(file.path))) continue
    changes.push(addedChange(scan.vaultId, file))
  }

  if (scan.complete) {
    for (const source of missingSources) {
      if (matchedSources.has(source.sourceId)) continue
      const change = removedChange(source)
      const local = project.notes.find((note) => note.id === source.itemId)
      if (local && entityHash(snapshotFromTerrainNote(local)) !== source.entityHash) {
        const conflict = makeConflict(
          change.id,
          'remove-modified',
          source.relativePath,
          '源文件已移除，但应用内版本在上次同步后有改动',
        )
        change.conflictIds.push(conflict.id)
        conflicts.push(conflict)
      }
      changes.push(change)
    }
  }

  for (const collision of pathCollisions) {
    const changeId = changes.find((change) => normalizePath(change.path) === collision)?.id
      ?? `collision:${stableHash(`${scan.vaultId}\n${collision}`)}`
    conflicts.push(makeConflict(
      changeId,
      'path-collision',
      collision,
      '路径在 Unicode、大小写或分隔符归一化后重复，请修正 vault 后重新扫描',
    ))
  }

  return {
    projectId: project.id,
    baseProjectUpdatedAt: project.updatedAt,
    vaultId: scan.vaultId,
    vaultName: scan.vaultName,
    accessMode: scan.accessMode,
    scannedAt: scan.scannedAt,
    complete: scan.complete,
    bootstrap,
    changes: changes.sort(compareChanges),
    conflicts: conflicts.sort((a, b) => a.path.localeCompare(b.path) || a.id.localeCompare(b.id)),
    issues: [...scan.issues].sort(compareIssues),
    unchangedCount,
    scanFiles: [...scan.files].sort((a, b) => a.path.localeCompare(b.path)),
  }
}

export function applyVaultSync(
  project: TerrainProject,
  preview: VaultSyncPreview,
  resolutions: readonly VaultSyncResolution[],
  acceptedAt = preview.scannedAt,
): AppliedVaultSync {
  if (project.id !== preview.projectId || project.updatedAt !== preview.baseProjectUpdatedAt) {
    throw new Error('同步预览已过期，请重新扫描 vault')
  }
  if (!Number.isFinite(Date.parse(acceptedAt))) throw new Error('同步确认时间无效')
  const structuralConflicts = preview.conflicts.filter(
    (conflict) => conflict.kind === 'ambiguous-rename' || conflict.kind === 'path-collision',
  )
  if (structuralConflicts.length) {
    throw new Error(`vault 仍有 ${structuralConflicts.length} 个身份或路径冲突；请修正 vault 后重新扫描`)
  }
  const resolutionById = new Map(resolutions.map((resolution) => [resolution.conflictId, resolution.choice]))
  const unresolved = preview.conflicts.filter((conflict) => !resolutionById.has(conflict.id))
  if (unresolved.length) throw new Error(`还有 ${unresolved.length} 个同步冲突未处理`)

  const filesByPath = new Map(preview.scanFiles.map((file) => [normalizePath(file.path), file]))
  const sourceStates = new Map((project.vaultSync?.sources ?? []).map((source) => [source.sourceId, cloneSource(source)]))
  if (preview.bootstrap) {
    for (const source of bootstrapSources(project, {
      vaultId: preview.vaultId,
      vaultName: preview.vaultName,
      accessMode: preview.accessMode,
      scannedAt: preview.scannedAt,
      complete: preview.complete,
      files: preview.scanFiles,
      issues: preview.issues,
    })) sourceStates.set(source.sourceId, source)
  }
  const currentNotes = new Map(project.notes.map((note) => [note.id, note]))
  const inputs = new Map(project.notes.map((note) => [note.id, noteInputFromTerrain(note, provenanceFor(project, note.id))]))
  const revisions = new Map((project.vaultSync?.revisions ?? []).map((revision) => [revision.id, { ...revision }]))
  const events = new Map(project.interactionEvents.map((event) => [event.id, event]))
  const newEvents: InteractionEvent[] = []
  const changedItemIds = new Set<string>()

  for (const change of preview.changes) {
    const file = filesByPath.get(normalizePath(change.path))
    if (change.kind === 'added') {
      if (!file?.note) continue
      const ambiguous = change.conflictIds.some((id) => preview.conflicts.find((item) => item.id === id)?.kind === 'ambiguous-rename')
      if (ambiguous && change.conflictIds.some((id) => resolutionById.get(id) === 'app')) continue
      const sourceId = change.sourceId ?? sourceIdFor(preview.vaultId, file.path)
      const itemId = change.itemId ?? itemIdFor(sourceId)
      const note = normalizedIncomingSnapshot(file.note, undefined, file.invalidFields)
      inputs.set(itemId, noteInputFromSnapshot(note, itemId, sourceId, preview.vaultName, file.path, 'yaml'))
      const source = sourceStateFromFile(preview, file, sourceId, itemId, note, acceptedAt)
      sourceStates.set(sourceId, source)
      changedItemIds.add(itemId)
      recordRevisionAndEvent('add', source, undefined, file, acceptedAt, currentNotes.get(itemId), revisions, events, newEvents)
      continue
    }

    const source = change.sourceId ? sourceStates.get(change.sourceId) : undefined
    if (!source) continue
    const current = currentNotes.get(source.itemId)
    if (change.kind === 'removed') {
      const keepApp = change.conflictIds.some((id) => resolutionById.get(id) === 'app')
      const input = inputs.get(source.itemId)
      if (input && !keepApp) inputs.set(source.itemId, { ...input, status: 'archived' })
      const removed = { ...source, status: 'removed' as const, acceptedAt }
      sourceStates.set(source.sourceId, removed)
      changedItemIds.add(source.itemId)
      recordRevisionAndEvent('remove', removed, source, undefined, acceptedAt, current, revisions, events, newEvents)
      continue
    }
    if (!file?.note || !current) continue

    const incoming = normalizedIncomingSnapshot(file.note, source.acceptedNote, file.invalidFields)
    const local = snapshotFromTerrainNote(current)
    const merged = mergeSnapshots(source.acceptedNote, local, incoming, change, resolutionById, preview.conflicts)
    const provenance = cognitiveProvenanceForMerge(project, source.itemId, source.acceptedNote, local, incoming)
    inputs.set(source.itemId, noteInputFromSnapshot(
      merged,
      source.itemId,
      source.sourceId,
      preview.vaultName,
      file.path,
      provenance,
    ))
    const nextSource = sourceStateFromFile(preview, file, source.sourceId, source.itemId, incoming, acceptedAt)
    sourceStates.set(source.sourceId, nextSource)
    changedItemIds.add(source.itemId)
    recordRevisionAndEvent(
      change.kind === 'renamed' ? 'rename' : 'modify',
      nextSource,
      source,
      file,
      acceptedAt,
      current,
      revisions,
      events,
      newEvents,
    )
  }

  for (const source of sourceStates.values()) {
    const input = inputs.get(source.itemId)
    if (input) inputs.set(source.itemId, {
      ...input,
      sourceId: source.sourceId,
      sourceKey: source.acceptedNote.sourceKey,
    })
  }

  const vaults = [
    ...(project.vaultSync?.vaults ?? []).filter((vault) => vault.vaultId !== preview.vaultId),
    {
      vaultId: preview.vaultId,
      displayName: preview.vaultName,
      accessMode: preview.accessMode,
      lastScannedAt: acceptedAt,
    } as const,
  ].sort((a, b) => a.vaultId.localeCompare(b.vaultId))
  return {
    inputs: [...inputs.values()],
    state: {
      version: VAULT_SYNC_VERSION,
      vaults,
      sources: [...sourceStates.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
      revisions: [...revisions.values()].sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt) || a.id.localeCompare(b.id)),
      writebackRevisions: project.vaultSync?.writebackRevisions?.map((revision) => ({
        ...revision,
        requestIds: [...revision.requestIds],
      })),
    },
    events: newEvents,
    changedItemIds: [...changedItemIds].sort(),
  }
}

export function snapshotFromTerrainNote(note: TerrainNote): VaultSyncNoteSnapshot {
  return {
    sourceKey: note.sourceKey,
    title: note.title,
    content: note.content,
    createdAt: note.createdAt,
    tags: [...note.tags],
    weight: note.weight,
    mastery: note.mastery,
    confidence: note.confidence,
    exploration: note.exploration,
    status: note.status,
    areas: [...(note.areas ?? (note.area ? [note.area] : []))],
    declaredAreas: [...(note.declaredAreas ?? note.areas ?? (note.area ? [note.area] : []))],
    reviewedAt: note.reviewedAt,
    links: [...note.links],
  }
}

export function entityHash(note: VaultSyncNoteSnapshot): string {
  return `entity:${stableHash(canonicalJson(note))}`
}

export function fieldHashes(note: VaultSyncNoteSnapshot): Partial<Record<VaultSyncField, string>> {
  return Object.fromEntries(SYNC_FIELDS.map((field) => [field, stableHash(canonicalJson(fieldValue(note, field)))]))
}

export function sourceIdFor(vaultId: string, initialPath: string): string {
  return `vault-source-${stableHash(`${vaultId}\n${normalizePath(initialPath)}`)}-${stableHash(`${initialPath}\n${vaultId}`)}`
}

function itemIdFor(sourceId: string): string {
  return `note-${stableHash(sourceId)}-${stableHash([...sourceId].reverse().join(''))}`
}

function bootstrapSources(project: TerrainProject, scan: VaultScanResult): VaultSourceState[] {
  const filesByPath = new Map(scan.files.map((file) => [normalizePath(file.path), file]))
  return project.notes.flatMap((note) => {
    if (!note.sourcePath || normalizeVaultName(note.vault ?? '') !== normalizeVaultName(scan.vaultName)) return []
    const file = filesByPath.get(normalizePath(note.sourcePath))
    if (!file) return []
    const sourceId = note.sourceId ?? sourceIdFor(scan.vaultId, note.sourcePath)
    const acceptedNote = snapshotFromTerrainNote(note)
    return [{
      sourceId,
      itemId: note.id,
      vaultId: scan.vaultId,
      relativePath: note.sourcePath,
      status: 'present' as const,
      rawContentHash: file.rawContentHash,
      entityHash: entityHash(acceptedNote),
      lastModifiedMs: validFileTime(file.lastModifiedMs, scan.scannedAt),
      size: file.size,
      acceptedFieldHashes: fieldHashes(acceptedNote),
      acceptedNote,
      acceptedAt: scan.scannedAt,
    }]
  })
}

function changeForSource(
  kind: 'modified' | 'renamed',
  source: VaultSourceState,
  file: VaultScanFile,
  project: TerrainProject,
  conflicts: VaultSyncConflict[],
  requireExplicitResolution = false,
): VaultSyncChange {
  const change: VaultSyncChange = {
    id: `${kind}:${source.sourceId}:${stableHash(file.path)}`,
    kind,
    path: file.path,
    previousPath: kind === 'renamed' ? source.relativePath : undefined,
    itemId: source.itemId,
    sourceId: source.sourceId,
    fields: [],
    conflictIds: [],
  }
  const current = project.notes.find((note) => note.id === source.itemId)
  if (!current || !file.note) return change
  const local = snapshotFromTerrainNote(current)
  const incoming = normalizedIncomingSnapshot(file.note, source.acceptedNote, file.invalidFields)
  for (const field of SYNC_FIELDS) {
    if (sameField(incoming, source.acceptedNote, field)) continue
    change.fields.push(field)
    if (!requireExplicitResolution && (sameField(local, source.acceptedNote, field) || sameField(local, incoming, field))) continue
    const conflict = makeConflict(
      change.id,
      'field',
      file.path,
      `字段 ${field} 在应用和 vault 中都发生了不同改动`,
      field,
    )
    change.conflictIds.push(conflict.id)
    conflicts.push(conflict)
  }
  return change
}

function addedChange(vaultId: string, file: VaultScanFile): VaultSyncChange {
  const sourceId = sourceIdFor(vaultId, file.path)
  return {
    id: `added:${sourceId}`,
    kind: 'added',
    path: file.path,
    itemId: itemIdFor(sourceId),
    sourceId,
    fields: [...SYNC_FIELDS],
    conflictIds: [],
  }
}

function removedChange(source: VaultSourceState): VaultSyncChange {
  return {
    id: `removed:${source.sourceId}`,
    kind: 'removed',
    path: source.relativePath,
    itemId: source.itemId,
    sourceId: source.sourceId,
    fields: [],
    conflictIds: [],
  }
}

function matchRenames(
  sources: readonly VaultSourceState[],
  files: readonly VaultScanFile[],
): {
  matches: Array<{ source: VaultSourceState; file: VaultScanFile }>
  ambiguous: Array<{ file: VaultScanFile; candidates: VaultSourceState[] }>
} {
  const matchedSourceIds = new Set<string>()
  const matches: Array<{ source: VaultSourceState; file: VaultScanFile }> = []
  const ambiguous: Array<{ file: VaultScanFile; candidates: VaultSourceState[] }> = []
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const sourceKey = file.note?.sourceKey?.normalize('NFKC').trim()
    const byKey = sourceKey
      ? sources.filter((source) => !matchedSourceIds.has(source.sourceId)
        && source.acceptedNote.sourceKey?.normalize('NFKC').trim() === sourceKey)
      : []
    const byHash = sources.filter((source) => !matchedSourceIds.has(source.sourceId)
      && source.rawContentHash === file.rawContentHash)
    const candidates = byKey.length ? byKey : byHash
    if (candidates.length === 1) {
      matches.push({ source: candidates[0], file })
      matchedSourceIds.add(candidates[0].sourceId)
    } else if (candidates.length > 1) {
      ambiguous.push({ file, candidates })
    }
  }
  return { matches, ambiguous }
}

function normalizedIncomingSnapshot(
  note: NoteInput,
  baseline: VaultSyncNoteSnapshot | undefined,
  invalidFields: readonly VaultSyncField[],
): VaultSyncNoteSnapshot {
  const areas = normalizeStrings(note.areas ?? (note.area ? [note.area] : []))
  const normalized: VaultSyncNoteSnapshot = {
    sourceKey: note.sourceKey?.normalize('NFKC').trim() || baseline?.sourceKey,
    title: note.title?.trim() || baseline?.title || note.content.trim().slice(0, 48) || '未命名笔记',
    content: note.content.trim(),
    createdAt: normalizedDate(note.createdAt, baseline?.createdAt),
    tags: normalizeStrings(note.tags),
    weight: Number.isFinite(note.weight) ? Math.max(0.05, note.weight ?? 1) : baseline?.weight ?? 1,
    mastery: normalizedScore(note.mastery),
    confidence: normalizedScore(note.confidence),
    exploration: normalizedScore(note.exploration),
    status: note.status,
    areas,
    declaredAreas: note.declaredAreas ? [...note.declaredAreas] : [...areas],
    reviewedAt: normalizedOptionalDate(note.reviewedAt),
    links: normalizeStrings(note.links ?? []),
  }
  for (const field of invalidFields) {
    if (!baseline) continue
    setFieldValue(normalized, field, fieldValue(baseline, field))
  }
  return normalized
}

function mergeSnapshots(
  baseline: VaultSyncNoteSnapshot,
  local: VaultSyncNoteSnapshot,
  incoming: VaultSyncNoteSnapshot,
  change: VaultSyncChange,
  resolutions: ReadonlyMap<string, 'app' | 'source'>,
  conflicts: readonly VaultSyncConflict[],
): VaultSyncNoteSnapshot {
  const merged = cloneSnapshot(local)
  for (const field of SYNC_FIELDS) {
    if (sameField(incoming, baseline, field)) continue
    const conflict = conflicts.find((item) => item.changeId === change.id && item.field === field)
    if (conflict) {
      if (resolutions.get(conflict.id) === 'source') {
        setFieldValue(merged, field, fieldValue(incoming, field))
      }
      continue
    }
    if (sameField(local, baseline, field) || sameField(local, incoming, field)) {
      setFieldValue(merged, field, fieldValue(incoming, field))
      continue
    }
  }
  merged.sourceKey = incoming.sourceKey ?? baseline.sourceKey ?? local.sourceKey
  return merged
}

function sourceStateFromFile(
  preview: VaultSyncPreview,
  file: VaultScanFile,
  sourceId: string,
  itemId: string,
  note: VaultSyncNoteSnapshot,
  acceptedAt: string,
): VaultSourceState {
  return {
    sourceId,
    itemId,
    vaultId: preview.vaultId,
    relativePath: file.path,
    status: 'present',
    rawContentHash: file.rawContentHash,
    entityHash: entityHash(note),
    lastModifiedMs: validFileTime(file.lastModifiedMs, acceptedAt),
    size: file.size,
    acceptedFieldHashes: fieldHashes(note),
    acceptedNote: cloneSnapshot(note),
    acceptedAt,
  }
}

function recordRevisionAndEvent(
  operation: VaultSyncRevision['operation'],
  source: VaultSourceState,
  previous: VaultSourceState | undefined,
  file: VaultScanFile | undefined,
  acceptedAt: string,
  current: TerrainNote | undefined,
  revisions: Map<string, VaultSyncRevision>,
  existingEvents: Map<string, InteractionEvent>,
  newEvents: InteractionEvent[],
): void {
  const occurredAt = occurrenceTime(file?.lastModifiedMs, acceptedAt)
  const revisionId = `vault-revision:${source.sourceId}:${operation}:${stableHash(`${source.rawContentHash}\n${source.relativePath}`)}`
  if (!revisions.has(revisionId)) {
    revisions.set(revisionId, {
      id: revisionId,
      sourceId: source.sourceId,
      itemId: source.itemId,
      operation,
      rawContentHash: source.rawContentHash,
      previousContentHash: previous?.rawContentHash,
      fromPath: previous?.relativePath,
      toPath: operation === 'remove' ? undefined : source.relativePath,
      entityHash: source.entityHash,
      acceptedAt,
      occurredAt: occurredAt.value,
      timestampSource: occurredAt.source,
      provenance: 'vault-sync',
    })
  }
  const changesContent = operation === 'add'
    || operation === 'modify' && previous?.entityHash !== source.entityHash
  if (!changesContent) return
  if (current && entityHash(snapshotFromTerrainNote(current)) === source.entityHash) return
  const eventId = `event:vault-sync:${source.itemId}:${source.entityHash}`
  if (existingEvents.has(eventId) || newEvents.some((event) => event.id === eventId)) return
  newEvents.push({
    id: eventId,
    itemId: source.itemId,
    type: operation === 'add' ? 'created' : 'edited',
    occurredAt: occurredAt.value,
    payload: {
      source: 'vault-sync',
      sourceId: source.sourceId,
      path: source.relativePath,
      rawContentHash: source.rawContentHash,
      entityHash: source.entityHash,
      timestampSource: occurredAt.source,
    },
  })
}

function noteInputFromTerrain(note: TerrainNote, provenance?: CognitiveStateProvenance): NoteInput {
  return {
    id: note.id,
    sourceId: note.sourceId,
    sourceKey: note.sourceKey,
    title: note.title,
    content: note.content,
    createdAt: note.createdAt,
    tags: [...note.tags],
    source: note.source,
    sourcePath: note.sourcePath,
    vault: note.vault,
    weight: note.weight,
    mastery: note.mastery,
    confidence: note.confidence,
    exploration: note.exploration,
    status: note.status,
    area: note.area,
    areas: note.areas ? [...note.areas] : undefined,
    declaredAreas: note.declaredAreas ? [...note.declaredAreas] : undefined,
    reviewedAt: note.reviewedAt,
    cognitiveStateProvenance: provenance,
    links: [...note.links],
  }
}

function noteInputFromSnapshot(
  note: VaultSyncNoteSnapshot,
  itemId: string,
  sourceId: string,
  vault: string,
  path: string,
  provenance: CognitiveStateProvenance,
): NoteInput {
  return {
    id: itemId,
    sourceId,
    sourceKey: note.sourceKey,
    title: note.title,
    content: note.content,
    createdAt: note.createdAt,
    tags: [...note.tags],
    source: path.split('/').at(-1) ?? path,
    sourcePath: path,
    vault,
    weight: note.weight,
    mastery: note.mastery,
    confidence: note.confidence,
    exploration: note.exploration,
    status: note.status,
    area: note.areas[0],
    areas: note.areas.length ? [...note.areas] : undefined,
    declaredAreas: note.declaredAreas.length ? [...note.declaredAreas] : undefined,
    reviewedAt: note.reviewedAt,
    cognitiveStateProvenance: provenance,
    links: [...note.links],
  }
}

function provenanceFor(project: TerrainProject, itemId: string): CognitiveStateProvenance | undefined {
  return project.cognitiveStates.find((state) => state.itemId === itemId)?.provenance
}

function cognitiveProvenanceForMerge(
  project: TerrainProject,
  itemId: string,
  baseline: VaultSyncNoteSnapshot,
  local: VaultSyncNoteSnapshot,
  incoming: VaultSyncNoteSnapshot,
): CognitiveStateProvenance {
  const cognitiveFields: readonly VaultSyncField[] = [
    'mastery', 'confidence', 'exploration', 'status', 'reviewedAt',
  ]
  const keepsLocal = cognitiveFields.some((field) => !sameField(local, baseline, field) && !sameField(local, incoming, field))
  return keepsLocal ? provenanceFor(project, itemId) ?? 'app' : 'yaml'
}

function makeConflict(
  changeId: string,
  kind: VaultSyncConflict['kind'],
  path: string,
  detail: string,
  field?: VaultSyncField,
): VaultSyncConflict {
  return {
    id: `conflict:${stableHash(`${changeId}\n${kind}\n${field ?? ''}\n${path}`)}`,
    changeId,
    kind,
    path,
    field,
    detail,
  }
}

function cloneSource(source: VaultSourceState): VaultSourceState {
  return {
    ...source,
    acceptedFieldHashes: { ...source.acceptedFieldHashes },
    acceptedNote: cloneSnapshot(source.acceptedNote),
  }
}

function cloneSnapshot(note: VaultSyncNoteSnapshot): VaultSyncNoteSnapshot {
  return {
    ...note,
    tags: [...note.tags],
    areas: [...note.areas],
    declaredAreas: [...note.declaredAreas],
    links: [...note.links],
  }
}

function uniqueIndex<T>(values: readonly T[], keyFor: (value: T) => string): {
  unique: Map<string, T>
  collisions: string[]
} {
  const unique = new Map<string, T>()
  const collisions = new Set<string>()
  for (const value of values) {
    const key = keyFor(value)
    if (unique.has(key)) collisions.add(key)
    else unique.set(key, value)
  }
  for (const collision of collisions) unique.delete(collision)
  return { unique, collisions: [...collisions] }
}

function normalizePath(value: string): string {
  return value.normalize('NFKC').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/').toLocaleLowerCase()
}

function normalizeVaultName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase()
}

function sameField(a: VaultSyncNoteSnapshot, b: VaultSyncNoteSnapshot, field: VaultSyncField): boolean {
  return canonicalJson(fieldValue(a, field)) === canonicalJson(fieldValue(b, field))
}

function fieldValue(note: VaultSyncNoteSnapshot, field: VaultSyncField): unknown {
  if (field === 'areas') return { areas: note.areas, declaredAreas: note.declaredAreas }
  return note[field]
}

function setFieldValue(note: VaultSyncNoteSnapshot, field: VaultSyncField, value: unknown): void {
  if (field === 'areas') {
    const areas = value as { areas?: string[]; declaredAreas?: string[] }
    note.areas = [...(areas.areas ?? [])]
    note.declaredAreas = [...(areas.declaredAreas ?? [])]
    return
  }
  Object.assign(note, { [field]: Array.isArray(value) ? [...value] : value })
}

function normalizeStrings(value: string[] | string | undefined): string[] {
  const values = Array.isArray(value) ? value : value?.split(/[,\n|]+/) ?? []
  return [...new Set(values.map((item) => item.normalize('NFKC').trim()).filter(Boolean))]
}

function normalizedScore(value: number | undefined): number | undefined {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value as number)) : undefined
}

function normalizedDate(value: string, fallback?: string): string {
  const parsed = Date.parse(value)
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  if (fallback) return fallback
  return new Date(0).toISOString()
}

function normalizedOptionalDate(value: string | undefined): string | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined
}

function validFileTime(value: number | undefined, acceptedAt: string): number | undefined {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return undefined
  const acceptedMs = Date.parse(acceptedAt)
  return (value as number) <= acceptedMs ? Math.floor(value as number) : undefined
}

function occurrenceTime(value: number | undefined, acceptedAt: string): {
  value: string
  source: VaultSyncRevision['timestampSource']
} {
  const valid = validFileTime(value, acceptedAt)
  return valid === undefined
    ? { value: acceptedAt, source: 'accepted-at' }
    : { value: new Date(valid).toISOString(), source: 'file-last-modified' }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function compareChanges(a: VaultSyncChange, b: VaultSyncChange): number {
  const order: Record<VaultSyncChangeKind, number> = { added: 0, modified: 1, renamed: 2, removed: 3 }
  return order[a.kind] - order[b.kind] || a.path.localeCompare(b.path)
}

function compareIssues(a: ImportIssue, b: ImportIssue): number {
  return a.file.localeCompare(b.file) || (a.field ?? '').localeCompare(b.field ?? '') || a.message.localeCompare(b.message)
}

export function invalidFieldsForIssues(issues: readonly ImportIssue[]): VaultSyncField[] {
  const invalid = new Set<VaultSyncField>()
  for (const issue of issues) {
    const field = issue.field
    if (field === 'area' || field === 'areas') invalid.add('areas')
    else if (field && SYNC_FIELDS.includes(field as VaultSyncField)) invalid.add(field as VaultSyncField)
    else if (issue.message.includes('YAML frontmatter')) FRONTMATTER_FIELDS.forEach((item) => invalid.add(item))
  }
  return [...invalid]
}
