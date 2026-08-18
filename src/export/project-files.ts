import { z } from 'zod'
import { buildProjectReferenceGapReport, type ReferenceGapReport } from '../domain/reference-gaps'
import type { TerrainProject, TerrainSnapshot } from '../domain/types'
import { TERRAIN_PREPARE_EXPORT_EVENT } from '../scene/terrain-events'
import { migrateProject } from '../storage/db'
import { drawReferenceGapSummary, renderShareCard } from './share-card'

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
    elevation: z.enum(['density', 'mastery', 'exploration', 'activity', 'structure']),
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

export async function parseProjectBundle(file: File): Promise<TerrainProject> {
  const value: unknown = JSON.parse(await file.text())
  const parsed = projectBundleSchema.parse(value)
  const serialized = {
    ...parsed,
    embeddingMode: parsed.embeddingMode ?? 'fallback',
    noteNeighbors: parsed.noteNeighbors ?? [],
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
  return migrateProject(serialized)
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
  lines.push(`# ${project.name} 复盘报告`, '')
  lines.push(`- 生成时间：${new Date().toLocaleString('zh-CN', { timeZone: project.timeZone })}`)
  lines.push(`- 模型：${project.modelId}（${project.embeddingMode}）`)
  lines.push(`- 笔记数：${project.notes.length}`)
  lines.push(`- 主题峰值：${project.peaks.length}`)
  const maintenance = [...project.notes].sort(maintenancePriority).slice(0, 8)
  lines.push(`- 待维护建议：${maintenance.length}`, '')
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
  lines.push('', '## 待维护建议', '')
  for (const note of maintenance) {
    lines.push(`- ${note.title} — 熟练度 ${note.mastery === undefined ? '未标注' : `${(note.mastery * 100).toFixed(0)}%`}，连接 ${note.links.length} 条，状态 ${note.status ?? '未标注'}`)
  }
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

function maintenancePriority(a: TerrainProject['notes'][number], b: TerrainProject['notes'][number]): number {
  const scoreA = maintenanceScore(a)
  const scoreB = maintenanceScore(b)
  return scoreB - scoreA || a.title.localeCompare(b.title)
}

function maintenanceScore(note: TerrainProject['notes'][number]): number {
  const needsAssessment = note.mastery === undefined ? 0.25 : 0
  return needsAssessment
    + (1 - (note.mastery ?? 0.5)) * 0.4
    + (1 - (note.confidence ?? 0.5)) * 0.15
    + Math.min(1, note.links.length / 6) * 0.1
    + (note.exploration ?? 0.5) * 0.1
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
