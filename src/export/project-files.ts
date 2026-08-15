import { z } from 'zod'
import type { TerrainProject, TerrainSnapshot } from '../domain/types'
import { TERRAIN_PREPARE_EXPORT_EVENT } from '../scene/terrain-events'
import { migrateProject } from '../storage/db'
import { renderShareCard } from './share-card'

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
      reviewedAt: z.string().optional(),
      cognitiveStateProvenance: z.enum(['yaml', 'app', 'migration']).optional(),
      links: z.array(z.string()).optional(),
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
  terrainProfiles: z.array(z.object({
    id: z.string(),
    label: z.string(),
    elevation: z.enum(['density', 'mastery', 'exploration', 'activity', 'structure']),
    color: z.enum(['area', 'source-kind', 'trust']),
    overlay: z.enum(['temperature', 'confidence', 'staleness', 'gaps']).optional(),
    formulaVersion: z.string(),
  })).optional(),
  activeTerrainProfileId: z.string().optional(),
})

export function downloadProjectBundle(project: TerrainProject): void {
  const serializable = {
    ...project,
    snapshots: project.snapshots.map((snapshot) => ({ ...snapshot, values: Array.from(snapshot.values) })),
  }
  downloadBlob(
    new Blob([JSON.stringify(serializable)], { type: 'application/json' }),
    `${safeFileName(project.name)}.terrain.json`,
  )
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
): Promise<void> {
  const sourceCanvas = root.querySelector('canvas')
  if (sourceCanvas) {
    sourceCanvas.dispatchEvent(new Event(TERRAIN_PREPARE_EXPORT_EVENT))
    const blob = await renderShareCard({ sourceCanvas, project, snapshot })
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
  await exportCanvasPng(canvas, project.name)
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
