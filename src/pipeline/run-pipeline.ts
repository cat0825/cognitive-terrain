import type { AnalysisOptions, NoteInput, ProcessingProgress, TerrainNote } from '../domain/types'
import { createProjectFromNotes } from '../domain/demo'
import { buildStableLayout, normalizeVector } from './layout'

const DEFAULT_MODEL = 'Xenova/multilingual-e5-small'
const FALLBACK_DIMENSIONS = 384

export async function analyzeNotes(
  name: string,
  inputs: NoteInput[],
  options: AnalysisOptions = {},
  onProgress?: (progress: ProcessingProgress) => void,
  isCancelled: () => boolean = () => false,
) {
  const modelId = options.modelId ?? DEFAULT_MODEL
  const timeZone = options.timeZone ?? 'Asia/Shanghai'
  const embeddingStrategy = options.embeddingStrategy ?? 'transformers'
  const ordered = inputs
    .map((input, index) => materializeInput(input, index))
    .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint))
  report(onProgress, 'parsing', 1, 1, `已读取 ${ordered.length} 条笔记`)
  if (isCancelled()) throw new DOMException('分析已取消', 'AbortError')

  let vectors: number[][]
  let actualModelId = modelId
  if (embeddingStrategy === 'deterministic') {
    actualModelId = 'deterministic-local-fallback'
    report(onProgress, 'model', 1, 1, '使用本地确定性向量')
    vectors = ordered.map((note) => fallbackEmbedding(`${note.title}\n${note.content}\n${note.tags.join(' ')}`))
  } else {
    try {
      vectors = await embedWithTransformers(ordered, modelId, onProgress, isCancelled)
    } catch (error) {
      actualModelId = 'deterministic-local-fallback'
      report(onProgress, 'model', 1, 1, `模型不可用，已切换为本地确定性向量`)
      vectors = ordered.map((note) => fallbackEmbedding(`${note.title}\n${note.content}\n${note.tags.join(' ')}`))
      if (error instanceof Error) console.warn('[cognitive-terrain] embedding fallback:', error.message)
    }
  }
  if (isCancelled()) throw new DOMException('分析已取消', 'AbortError')

  report(onProgress, 'layout', 0, 1, '正在计算稳定的二维布局')
  const coordinates = await buildStableLayout(vectors, (completed, total) => {
    report(onProgress, 'layout', completed, total, `布局迭代 ${completed}/${total}`)
  })
  for (let index = 0; index < ordered.length; index += 1) {
    ordered[index].x = coordinates[index]?.[0] ?? 0
    ordered[index].y = coordinates[index]?.[1] ?? 0
  }
  report(onProgress, 'layout', 1, 1, '二维布局完成')
  if (isCancelled()) throw new DOMException('分析已取消', 'AbortError')

  report(onProgress, 'terrain', 0, 1, '正在生成密度地形与时间快照')
  const project = createProjectFromNotes(name, ordered, actualModelId)
  report(onProgress, 'terrain', 1, 1, `${project.snapshots.length} 个时间快照已生成`)
  report(onProgress, 'cache', 1, 1, '项目已准备好，可保存到本地')
  return projectWithTimeZone(project, timeZone)
}

async function embedWithTransformers(
  notes: TerrainNote[],
  modelId: string,
  onProgress: ((progress: ProcessingProgress) => void) | undefined,
  isCancelled: () => boolean,
): Promise<number[][]> {
  report(onProgress, 'model', 0, 1, `加载本地模型 ${modelId}`)
  const device = typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm'
  const { pipeline } = await import('@huggingface/transformers')
  const extractor = await pipeline('feature-extraction', modelId, {
    device,
    dtype: 'q8',
    progress_callback: (progress) => {
      if (progress.status === 'initiate' || progress.status === 'download') {
        report(onProgress, 'model', 0, 100, `下载模型 ${progress.file}`)
      } else if (progress.status === 'progress') {
        const loaded = progress.loaded ?? 0
        const total = progress.total ?? 1
        report(onProgress, 'model', loaded, total, `${progress.file} ${formatBytes(loaded)}/${formatBytes(total)}`)
      } else if (progress.status === 'progress_total') {
        report(onProgress, 'model', progress.loaded ?? 0, progress.total ?? 1, `模型 ${formatBytes(progress.loaded ?? 0)}/${formatBytes(progress.total ?? 1)}`)
      } else if (progress.status === 'ready') {
        report(onProgress, 'model', 1, 1, '模型已就绪')
      }
    },
  })
  report(onProgress, 'model', 1, 1, device === 'webgpu' ? 'WebGPU 模型已就绪' : 'WASM 模型已就绪')

  const vectors: number[][] = []
  const batchSize = 12
  for (let start = 0; start < notes.length; start += batchSize) {
    if (isCancelled()) throw new DOMException('分析已取消', 'AbortError')
    const batch = notes.slice(start, start + batchSize).map((note) => `passage: ${note.title}\n${note.content}`)
    const output = await extractor(batch, { pooling: 'mean', normalize: true })
    const tensor = output as unknown as { data: Float32Array | Int8Array; dims: number[] }
    const dimension = tensor.dims.at(-1) ?? FALLBACK_DIMENSIONS
    for (let row = 0; row < batch.length; row += 1) {
      const offset = row * dimension
      vectors.push(normalizeVector(Array.from(tensor.data.slice(offset, offset + dimension), Number)))
    }
    report(onProgress, 'embedding', Math.min(start + batch.length, notes.length), notes.length, `向量化 ${Math.min(start + batch.length, notes.length)}/${notes.length}`)
    await idle()
  }
  return vectors
}

function materializeInput(input: NoteInput, index: number): TerrainNote {
  const title = input.title?.trim() || input.content.trim().slice(0, 48) || `未命名笔记 ${index + 1}`
  const content = input.content.trim()
  const createdAtMs = Date.parse(input.createdAt)
  const createdAt = Number.isNaN(createdAtMs) ? new Date().toISOString() : new Date(createdAtMs).toISOString()
  const tags = normalizeTags(input.tags)
  const links = normalizeLinks(input.links)
  const fingerprint = input.id?.trim() || hash(`${title}\n${content}\n${createdAt}\n${tags.join('|')}\n${links.join('|')}`)
  return {
    id: input.id?.trim() || `note-${fingerprint}`,
    fingerprint,
    title,
    content,
    createdAt,
    createdAtMs: Number.isNaN(createdAtMs) ? Date.parse(createdAt) : createdAtMs,
    tags,
    source: input.source,
    sourcePath: input.sourcePath,
    vault: input.vault,
    weight: Number.isFinite(input.weight) ? Math.max(0.05, input.weight ?? 1) : 1,
    mastery: normalizeScore(input.mastery),
    confidence: normalizeScore(input.confidence),
    exploration: normalizeScore(input.exploration),
    status: input.status,
    area: input.area,
    reviewedAt: normalizeReviewedAt(input.reviewedAt),
    links,
    x: 0,
    y: 0,
  }
}

function normalizeLinks(links: NoteInput['links']): string[] {
  if (!Array.isArray(links)) return []
  return [...new Set(links.map((link) => link.trim()).filter(Boolean))]
}

function normalizeScore(value: number | undefined): number | undefined {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value as number)) : undefined
}

function normalizeReviewedAt(value: string | undefined): string | undefined {
  if (!value) return undefined
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString()
}

function normalizeTags(tags: NoteInput['tags']): string[] {
  if (Array.isArray(tags)) return tags.map((tag) => tag.trim()).filter(Boolean)
  return tags?.split(/[,\s|]+/).map((tag) => tag.trim()).filter(Boolean) ?? []
}

function fallbackEmbedding(text: string): number[] {
  const vector = new Array<number>(FALLBACK_DIMENSIONS).fill(0)
  const normalized = text.toLocaleLowerCase()
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index)
    vector[(code * 17 + index * 13) % vector.length] += 1
    if (index + 1 < normalized.length) {
      const next = normalized.charCodeAt(index + 1)
      vector[(code * 31 + next * 7) % vector.length] += 0.5
    }
  }
  return normalizeVector(vector)
}

function projectWithTimeZone<T extends { timeZone: string }>(project: T, timeZone: string): T {
  return { ...project, timeZone }
}

function report(
  onProgress: ((progress: ProcessingProgress) => void) | undefined,
  stage: ProcessingProgress['stage'],
  completed: number,
  total: number,
  message: string,
): void {
  onProgress?.({ stage, completed, total, message })
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let index = 0
  let size = value
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function hash(value: string): string {
  let hashValue = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hashValue ^= value.charCodeAt(index)
    hashValue = Math.imul(hashValue, 16777619)
  }
  return (hashValue >>> 0).toString(16).padStart(8, '0')
}

function idle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
