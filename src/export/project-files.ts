import { z } from 'zod'
import type { TerrainProject } from '../domain/types'
import { TERRAIN_PREPARE_EXPORT_EVENT } from '../scene/terrain-events'

const projectBundleSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
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
      weight: z.number(),
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
  const migrated: TerrainProject = {
    ...parsed,
    schemaVersion: 2,
    embeddingMode: parsed.embeddingMode ?? 'fallback',
    noteNeighbors: parsed.noteNeighbors ?? [],
    snapshots: parsed.snapshots.map((snapshot) => ({
      ...snapshot,
      values: new Float32Array(snapshot.values),
    })),
  }
  return migrated
}

export async function exportTerrainPng(root: HTMLElement, projectName: string): Promise<void> {
  const sourceCanvas = root.querySelector('canvas')
  if (sourceCanvas) {
    sourceCanvas.dispatchEvent(new Event(TERRAIN_PREPARE_EXPORT_EVENT))
    await exportCanvasPng(sourceCanvas, projectName)
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
  await exportCanvasPng(canvas, projectName)
}

async function exportCanvasPng(canvas: HTMLCanvasElement, projectName: string): Promise<void> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png', 1))
  if (!blob) throw new Error('无法生成 PNG')
  const fileName = `${safeFileName(projectName)}.png`
  const file = new File([blob], fileName, { type: 'image/png' })
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: projectName })
    return
  }
  downloadBlob(blob, fileName)
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
