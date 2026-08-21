import { z } from 'zod'
import { buildProjectReferenceGapReport, type ReferenceGapReport } from '../domain/reference-gaps'
import { generateProjectExplorationSuggestions } from '../domain/exploration-loop'
import type { TerrainProject, TerrainSnapshot } from '../domain/types'
import { TERRAIN_PREPARE_EXPORT_EVENT } from '../scene/terrain-events'
import { migrateProject } from '../storage/db'
import { createActivityCompactionDiagnostics } from '../domain/activity-history'
import { drawReferenceGapSummary, renderShareCard } from './share-card'

const explorationActionSchema = z.object({
  title: z.string(),
  detail: z.string().optional(),
})

const explorationStatusSchema = z.enum([
  'proposed',
  'accepted',
  'in-progress',
  'completed',
  'snoozed',
  'dismissed',
  'rejected',
])

const explorationSourceRouteSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('note'), noteId: z.string() }),
  z.object({
    kind: z.literal('relationship'),
    bridgeId: z.string(),
    fromItemId: z.string(),
    toItemId: z.string().optional(),
    targetTitle: z.string().optional(),
  }),
  z.object({
    kind: z.literal('reference-node'),
    atlasId: z.string(),
    taxonomyNodeId: z.string(),
  }),
  z.object({ kind: z.literal('goal'), goalId: z.string(), noteId: z.string().optional() }),
  z.object({
    kind: z.literal('unavailable'),
    originalKind: z.enum(['note', 'relationship', 'reference-node', 'goal']),
    detail: z.string().optional(),
  }),
])

const explorationItemSchema = z.object({
  id: z.string(),
  suggestion: z.object({
    id: z.string(),
    reason: z.object({
      code: z.enum([
        'reference-gap',
        'stale-reviewed-item',
        'unresolved-bridge',
        'unassessed-note',
        'low-confidence-note',
        'user-marked-goal',
      ]),
      detail: z.string(),
    }),
    supportingItemIds: z.array(z.string()),
    sourceRoute: explorationSourceRouteSchema,
    evidenceFingerprint: z.string(),
    priority: z.number().finite(),
    action: explorationActionSchema,
    referenceBoundary: z.object({
      atlasId: z.string(),
      taxonomyNodeId: z.string(),
      label: z.string().optional(),
      taxonomyVersion: z.union([z.string(), z.number()]).optional(),
    }).optional(),
    reopenReason: z.object({
      code: z.enum([
        'fresh-evidence-after-completed',
        'fresh-evidence-after-dismissed',
        'fresh-evidence-after-rejected',
      ]),
      previousEvidenceFingerprint: z.string(),
      previousDecidedAt: z.string(),
    }).optional(),
    previousDecision: z.object({
      status: z.enum(['completed', 'dismissed', 'rejected']),
      decidedAt: z.string(),
      evidenceFingerprint: z.string(),
    }).optional(),
  }),
  status: explorationStatusSchema,
  action: explorationActionSchema,
  userNotes: z.string().optional(),
  snoozedUntil: z.string().optional(),
  lastExploredAt: z.string().optional(),
  updatedAt: z.string(),
  history: z.array(z.object({
    id: z.string(),
    type: z.enum(['edit', 'accept', 'start', 'complete', 'snooze', 'dismiss', 'reject']),
    occurredAt: z.string(),
    fromStatus: explorationStatusSchema,
    toStatus: explorationStatusSchema,
    evidenceFingerprint: z.string(),
    action: explorationActionSchema.optional(),
    snoozedUntil: z.string().optional(),
    note: z.string().optional(),
  })),
})

const prerequisiteDeclarationSchema = z.object({
  target: z.string(),
  provenance: z.enum(['yaml', 'app-confirmed']),
  sourceField: z.enum(['prerequisites', 'buildsOn', 'app']),
  relationId: z.string(),
})

const prerequisiteTopologySchema = z.object({
  version: z.literal(1),
  formulaVersion: z.literal('explicit-prerequisite-dag-v1'),
  relations: z.array(z.object({
    id: z.string(),
    sourceNoteId: z.string(),
    fromItemId: z.string(),
    toItemId: z.string(),
    declaredTarget: z.string(),
    provenance: z.enum(['yaml', 'app-confirmed']),
    sourceField: z.enum(['prerequisites', 'buildsOn', 'app']),
  })),
  diagnostics: z.array(z.object({
    id: z.string(),
    kind: z.enum(['self-link', 'unresolved-target', 'ambiguous-title', 'cycle']),
    sourceNoteId: z.string(),
    relationIds: z.array(z.string()),
    declaredTarget: z.string().optional(),
    itemIds: z.array(z.string()),
  })),
  assignments: z.array(z.object({
    itemId: z.string(),
    status: z.enum(['neutral', 'derived', 'excluded']),
    depth: z.number().int().nonnegative().optional(),
    branchRootIds: z.array(z.string()),
    relationIds: z.array(z.string()),
    sourceNoteIds: z.array(z.string()),
  })),
})

const vaultAcceptedFieldHashesSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  createdAt: z.string().optional(),
  tags: z.string().optional(),
  weight: z.string().optional(),
  mastery: z.string().optional(),
  confidence: z.string().optional(),
  exploration: z.string().optional(),
  status: z.string().optional(),
  areas: z.string().optional(),
  reviewedAt: z.string().optional(),
  links: z.string().optional(),
  prerequisites: z.string().optional(),
})

const vaultAcceptedNoteSchema = z.object({
  sourceKey: z.string().optional(),
  title: z.string(),
  content: z.string(),
  createdAt: z.string(),
  tags: z.array(z.string()),
  weight: z.number(),
  mastery: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  exploration: z.number().min(0).max(1).optional(),
  status: z.enum(['seed', 'growing', 'stable', 'gap', 'archived']).optional(),
  areas: z.array(z.string()),
  declaredAreas: z.array(z.string()),
  reviewedAt: z.string().optional(),
  links: z.array(z.string()),
  prerequisites: z.array(prerequisiteDeclarationSchema).optional(),
})

const vaultSyncRevisionSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  itemId: z.string(),
  operation: z.enum(['add', 'modify', 'rename', 'remove']),
  rawContentHash: z.string(),
  previousContentHash: z.string().optional(),
  fromPath: z.string().optional(),
  toPath: z.string().optional(),
  entityHash: z.string(),
  acceptedAt: z.string(),
  occurredAt: z.string(),
  timestampSource: z.enum(['file-last-modified', 'accepted-at']),
  provenance: z.literal('vault-sync'),
})

const vaultSyncStateSchema = z.object({
  version: z.literal(1),
  vaults: z.array(z.object({
    vaultId: z.string(),
    displayName: z.string(),
    accessMode: z.enum(['directory-handle', 'reselect-files']),
    lastScannedAt: z.string(),
  })),
  sources: z.array(z.object({
    sourceId: z.string(),
    itemId: z.string(),
    vaultId: z.string(),
    relativePath: z.string(),
    status: z.enum(['present', 'removed']),
    rawContentHash: z.string(),
    entityHash: z.string(),
    lastModifiedMs: z.number().optional(),
    size: z.number().nonnegative().optional(),
    acceptedFieldHashes: vaultAcceptedFieldHashesSchema,
    acceptedNote: vaultAcceptedNoteSchema,
    acceptedAt: z.string(),
  })),
  revisions: z.array(vaultSyncRevisionSchema),
})

const projectBundleSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  timeZone: z.string(),
  modelId: z.string(),
  embeddingMode: z.enum(['semantic', 'fallback', 'demo']).optional(),
  sourceDigest: z.string(),
  gridSize: z.number().int().positive(),
  notes: z.array(
    z.object({
      id: z.string(),
      sourceId: z.string().optional(),
      sourceKey: z.string().optional(),
      fingerprint: z.string(),
      title: z.string(),
      content: z.string(),
      createdAt: z.string(),
      createdAtMs: z.number(),
      tags: z.array(z.string()),
      source: z.string().optional(),
      sourcePath: z.string().optional(),
      vault: z.string().optional(),
      weight: z.number(),
      mastery: z.number().min(0).max(1).optional(),
      confidence: z.number().min(0).max(1).optional(),
      exploration: z.number().min(0).max(1).optional(),
      status: z.enum(['seed', 'growing', 'stable', 'gap', 'archived']).optional(),
      area: z.string().optional(),
      areas: z.array(z.string()).optional(),
      declaredAreas: z.array(z.string()).optional(),
      reviewedAt: z.string().optional(),
      cognitiveStateProvenance: z.enum(['yaml', 'app', 'migration']).optional(),
      links: z.array(z.string()).optional(),
      prerequisites: z.array(prerequisiteDeclarationSchema).optional(),
      x: z.number(),
      y: z.number(),
    }),
  ),
  snapshots: z.array(
    z.object({
      bucket: z.string(),
      label: z.string(),
      values: z.array(z.number()),
    }),
  ),
  peaks: z.array(
    z.object({
      id: z.string(),
      x: z.number(),
      y: z.number(),
      height: z.number(),
      label: z.string(),
      noteIds: z.array(z.string()),
    }),
  ),
  noteNeighbors: z.array(z.array(z.string())).optional(),
  noteNeighborEvidence: z.array(z.array(z.object({
    sourceId: z.string(),
    targetId: z.string(),
    rank: z.number().int().positive(),
    score: z.number().min(-1).max(1),
    modelId: z.string(),
    embeddingMode: z.enum(['semantic', 'fallback']),
    formulaVersion: z.literal('embedding-cosine-neighbors-v1'),
    provenance: z.literal('embedding'),
  }))).optional(),
  cognitiveStates: z.array(z.object({
    itemId: z.string(),
    mastery: z.number().min(0).max(1).optional(),
    confidence: z.number().min(0).max(1).optional(),
    exploration: z.number().min(0).max(1).optional(),
    status: z.enum(['seed', 'growing', 'stable', 'gap', 'archived']).optional(),
    reviewedAt: z.string().optional(),
    updatedAt: z.string(),
    provenance: z.enum(['yaml', 'app', 'migration']),
  })).optional(),
  cognitiveObservations: z.array(z.discriminatedUnion('field', [
    z.object({
      schemaVersion: z.literal(1),
      id: z.string().min(1),
      itemId: z.string().min(1),
      field: z.enum(['mastery', 'confidence', 'exploration']),
      value: z.number().min(0).max(1),
      observedAt: z.string(),
      provenance: z.enum(['self-assessment', 'yaml-import', 'review-outcome', 'migration']),
      reason: z.string().min(1),
    }),
    z.object({
      schemaVersion: z.literal(1),
      id: z.string().min(1),
      itemId: z.string().min(1),
      field: z.literal('status'),
      value: z.enum(['seed', 'growing', 'stable', 'gap', 'archived']),
      observedAt: z.string(),
      provenance: z.enum(['self-assessment', 'yaml-import', 'review-outcome', 'migration']),
      reason: z.string().min(1),
    }),
    z.object({
      schemaVersion: z.literal(1),
      id: z.string().min(1),
      itemId: z.string().min(1),
      field: z.literal('reviewedAt'),
      value: z.string(),
      observedAt: z.string(),
      provenance: z.enum(['self-assessment', 'yaml-import', 'review-outcome', 'migration']),
      reason: z.string().min(1),
    }),
  ])).optional(),
  learningProgressionProfileVersion: z.enum([
    'learning-progression-v1',
    'learning-progression-linear-decay-v1',
  ]).optional(),
  interactionEvents: z.array(z.object({
    id: z.string(),
    itemId: z.string(),
    type: z.enum(['created', 'edited', 'opened', 'reviewed', 'linked', 'classified']),
    occurredAt: z.string(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })).optional(),
  activityHistory: z.object({
    policyVersion: z.literal(1),
    timeZone: z.string(),
    rawEvents: z.array(z.object({
      id: z.string(),
      itemId: z.string(),
      type: z.enum(['created', 'edited', 'opened', 'reviewed', 'linked', 'classified']),
      occurredAt: z.string(),
      payload: z.record(z.string(), z.unknown()).optional(),
    })),
    aggregates: z.array(z.object({
      id: z.string(),
      policyVersion: z.literal(1),
      itemId: z.string(),
      type: z.enum(['created', 'edited', 'opened', 'reviewed', 'linked', 'classified']),
      granularity: z.enum(['day', 'week']),
      bucket: z.string(),
      timeZone: z.string(),
      count: z.number().int().nonnegative(),
      firstOccurredAt: z.string(),
      lastOccurredAt: z.string(),
      heatAtCompactedAt: z.number().nonnegative(),
      compactedAt: z.string(),
    })),
  }).optional(),
  terrainProfiles: z.array(z.object({
    id: z.string(),
    label: z.string(),
    elevation: z.enum(['density', 'mastery', 'exploration', 'activity', 'progression', 'structure']),
    color: z.enum(['area', 'source-kind', 'trust']),
    overlay: z.enum(['temperature', 'confidence', 'staleness', 'gaps']).optional(),
    formulaVersion: z.string(),
  })).optional(),
  activeTerrainProfileId: z.string().optional(),
  taxonomyNodes: z.array(z.object({
    id: z.string(),
    workspaceId: z.string(),
    label: z.string(),
    parentId: z.string().optional(),
    aliases: z.array(z.string()),
    description: z.string().optional(),
    version: z.number().int().positive(),
    status: z.enum(['active', 'archived']),
    createdAt: z.string(),
    updatedAt: z.string(),
  })).optional(),
  taxonomyVersion: z.number().int().nonnegative().optional(),
  activeReferenceAtlasId: z.string().optional(),
  referenceAtlases: z.array(z.object({
    id: z.string(),
    workspaceId: z.string(),
    label: z.string(),
    taxonomyVersion: z.number().int().nonnegative(),
    taxonomyNodeIds: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
  })).optional(),
  explorationItems: z.array(explorationItemSchema).optional(),
  prerequisiteTopology: prerequisiteTopologySchema.optional(),
  vaultSync: vaultSyncStateSchema.optional(),
})

export function downloadProjectBundle(project: TerrainProject): void {
  downloadBlob(
    new Blob([serializeProjectBundle(project)], { type: 'application/json' }),
    `${safeFileName(project.name)}.terrain.json`,
  )
}

export function serializeProjectBundle(project: TerrainProject): string {
  return JSON.stringify({
    ...project,
    snapshots: project.snapshots.map((snapshot) => ({ ...snapshot, values: Array.from(snapshot.values) })),
  })
}

/** A future-dated bundle timestamp that was dropped on import. */
export interface FutureActivityImportWarning {
  scope: 'interaction-event' | 'activity-aggregate'
  itemId: string
  occurredAt: string
}

export interface ParsedProjectBundle {
  project: TerrainProject
  /**
   * Future-dated activity dropped during import. Reported rather than silently
   * discarded so a user whose export carries a bad clock can tell why the
   * terrain no longer shows that activity.
   */
  futureActivityWarnings: FutureActivityImportWarning[]
}

export async function parseProjectBundle(file: File, signal?: AbortSignal): Promise<TerrainProject> {
  return (await parseProjectBundleWithWarnings(file, signal)).project
}

/**
 * Imports a bundle and reports future-dated activity that was dropped.
 *
 * Rejecting the whole bundle would be worse than dropping the offending events:
 * a single bad timestamp should not cost the user their entire project, so the
 * rest of the import proceeds and the drops surface as warnings.
 */
export async function parseProjectBundleWithWarnings(file: File, signal?: AbortSignal): Promise<ParsedProjectBundle> {
  throwIfAborted(signal)
  const value: unknown = JSON.parse(await file.text())
  throwIfAborted(signal)
  const parsed = projectBundleSchema.parse(value)
  const serialized = {
    ...parsed,
    embeddingMode: parsed.embeddingMode ?? 'fallback',
    noteNeighbors: parsed.noteNeighbors ?? [],
    noteNeighborEvidence: parsed.noteNeighborEvidence ?? [],
    notes: parsed.notes.map((note) => ({
      ...note,
      links: note.links ?? [],
      prerequisites: note.prerequisites ?? [],
    })),
    snapshots: parsed.snapshots.map((snapshot) => ({
      ...snapshot,
      values: new Float32Array(snapshot.values),
    })),
  } as unknown as TerrainProject
  // Migration compacts activity and already drops future-dated entries, so collect
  // the diagnostics from it instead of re-filtering the cleaned project.
  const activityDiagnostics = createActivityCompactionDiagnostics()
  const project = migrateProject(serialized, { activityDiagnostics })
  const futureActivityWarnings: FutureActivityImportWarning[] = [
    ...activityDiagnostics.ignoredFutureEvents.map((event): FutureActivityImportWarning => ({
      scope: 'interaction-event',
      itemId: event.itemId,
      occurredAt: event.occurredAt,
    })),
    ...activityDiagnostics.ignoredFutureAggregateIds.map((id): FutureActivityImportWarning => ({
      scope: 'activity-aggregate',
      itemId: id,
      occurredAt: '',
    })),
  ]
  return { project, futureActivityWarnings }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('导入已取消', 'AbortError')
}

export async function exportTerrainPng(
  root: HTMLElement,
  project: TerrainProject,
  snapshot?: TerrainSnapshot,
  referenceGapReport?: ReferenceGapReport,
): Promise<void> {
  const exportGapReport = referenceGapReportForExport(project, referenceGapReport)
  const sourceCanvas = root.querySelector('canvas')
  if (sourceCanvas) {
    sourceCanvas.dispatchEvent(new Event(TERRAIN_PREPARE_EXPORT_EVENT))
    const blob = await renderShareCard({ sourceCanvas, project, snapshot, referenceGapReport: exportGapReport })
    await exportBlobPng(blob, project.name)
    return
  }
  const svg = root.querySelector('svg')
  if (!svg) throw new Error('当前视图没有可导出的画面')
  const bounds = root.getBoundingClientRect()
  const canvas = document.createElement('canvas')
  const scale = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = Math.max(1, Math.round(bounds.width * scale))
  canvas.height = Math.max(1, Math.round(bounds.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建导出画布')
  context.fillStyle = '#151515'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const image = await loadSvgImage(svg)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  drawReferenceGapSummary(context, project, exportGapReport)
  await exportCanvasPng(canvas, project.name)
}

export function referenceGapReportForExport(
  project: TerrainProject,
  report?: ReferenceGapReport,
  evaluatedAt: string | number | Date = Date.now(),
): ReferenceGapReport {
  return report ?? buildProjectReferenceGapReport(project, project.activeReferenceAtlasId ?? '', evaluatedAt)
}

async function exportBlobPng(blob: Blob, projectName: string): Promise<void> {
  const fileName = `${safeFileName(projectName)}.png`
  const file = new File([blob], fileName, { type: 'image/png' })
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: projectName })
    return
  }
  downloadBlob(blob, fileName)
}

async function exportCanvasPng(canvas: HTMLCanvasElement, projectName: string): Promise<void> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png', 1))
  if (!blob) throw new Error('无法生成 PNG')
  await exportBlobPng(blob, projectName)
}

async function loadSvgImage(svg: SVGSVGElement): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function downloadProjectReport(project: TerrainProject): Promise<void> {
  const markdown = await buildProjectReport(project)
  downloadBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), `${safeFileName(project.name)}-review.md`)
}

export async function buildProjectReport(project: TerrainProject): Promise<string> {
  const lines: string[] = []
  const evaluatedAt = Date.now()
  const workingSet = (project.explorationItems ?? [])
    .filter((item) => item.status === 'accepted' || item.status === 'in-progress')
    .sort((left, right) => right.suggestion.priority - left.suggestion.priority || left.id.localeCompare(right.id))
    .slice(0, 3)
  const itemsBySuggestionId = new Map(
    (project.explorationItems ?? []).map((item) => [item.suggestion.id, item]),
  )
  const explorationQueue = generateProjectExplorationSuggestions(project, evaluatedAt)
    .filter((suggestion) => {
      if (suggestion.reopenReason) return true
      const item = itemsBySuggestionId.get(suggestion.id)
      return item === undefined
        || item.status === 'proposed'
        || (item.status === 'snoozed'
          && (!item.snoozedUntil || Date.parse(item.snoozedUntil) <= evaluatedAt))
    })
  lines.push(`# ${project.name} 复盘报告`, '')
  lines.push(`- 生成时间：${new Date().toLocaleString('zh-CN', { timeZone: project.timeZone })}`)
  lines.push(`- 模型：${project.modelId}（${project.embeddingMode}）`)
  lines.push(`- 笔记数：${project.notes.length}`)
  lines.push(`- 主题峰值：${project.peaks.length}`)
  lines.push(`- 当前探索工作集：${workingSet.length}/3`)
  lines.push(`- 可解释建议队列：${explorationQueue.length}/8`, '')
  lines.push(`- 时间层：${project.snapshots.length}`, '')
  appendTerrainSemantics(lines, project)
  lines.push('## 主题峰值', '')
  const sortedPeaks = [...project.peaks].sort((a, b) => b.height - a.height)
  for (const peak of sortedPeaks) {
    const peakNotes = peak.noteIds
      .map((id) => project.notes.find((note) => note.id === id))
      .filter((note): note is NonNullable<typeof note> => Boolean(note))
    lines.push(`### ${peak.label}`)
    lines.push(`- 高度：${peak.height.toFixed(2)}，覆盖 ${peakNotes.length} 条笔记`)
    for (const note of peakNotes) {
      lines.push(`- [${note.title}]（${note.tags.map((tag) => `#${tag}`).join(' ')}）`)
    }
    lines.push('')
  }
  lines.push('## 笔记清单', '')
  const byTime = [...project.notes].sort((a, b) => a.createdAtMs - b.createdAtMs)
  for (const note of byTime) {
    lines.push(`- [${note.title}](${note.source ?? ''}) — ${note.tags.map((tag) => `#${tag}`).join(' ')}`)
  }
  lines.push('', '## 探索工作台', '')
  lines.push('建议仅来自所选参考边界、明确复习时间、未解析关系、自评状态或用户标记目标；不由活动分数单独触发。', '')
  for (const item of workingSet) {
    lines.push(`- [${item.status}] ${item.action.title} — ${item.suggestion.reason.code}：${item.suggestion.reason.detail}`)
  }
  for (const suggestion of explorationQueue) {
    const item = itemsBySuggestionId.get(suggestion.id)
    lines.push(`- [${suggestion.reopenReason ? 'reopened' : item?.status ?? 'proposed'}] ${item?.action.title ?? suggestion.action.title} — ${suggestion.reason.code}：${suggestion.reason.detail}`)
  }
  if (!workingSet.length && !explorationQueue.length) lines.push('- 当前没有需要处理的建议。')
  lines.push('')
  return lines.join('\n')
}

function appendTerrainSemantics(lines: string[], project: TerrainProject): void {
  lines.push('## 地形语义', '')
  lines.push('- 活动海拔（activity-elevation-v1）：仅将近期打开、编辑和复习事件的衰减聚合映射到高度；不代表熟练度、学习进度或知识缺口。')
  lines.push('- 温度：仅将同类近期事件的衰减热度编码为颜色；不改变海拔或语义平面坐标。')
  lines.push('- 熟练度：来自显式 mastery 认知状态；学习进度是独立的跨时间概念，本报告不从活动海拔、温度或单次 mastery 推断。')
  const activeAtlas = project.referenceAtlases?.find((atlas) => atlas.id === project.activeReferenceAtlasId)
  if (activeAtlas) {
    lines.push(`- Active reference atlas：${activeAtlas.label}（taxonomy v${activeAtlas.taxonomyVersion}）`)
    lines.push(`- 海洋/缺口（reference-gap-v1）：enabled；仅表示当前项目相对「${activeAtlas.label}」预期 taxonomy nodes 的覆盖差距，不表示用户能力，且不由低活动推断。`)
  } else {
    lines.push('- 海洋/缺口（reference-gap-v1）：disabled；未选择有效的 active reference atlas，不生成知识或技能缺口声明；低活动不等于缺口。')
  }
  lines.push('')
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'cognitive-terrain'
}
