import type { ReferenceGapReport } from '../domain/reference-gaps'
import type { TerrainPeak, TerrainProject, TerrainSnapshot } from '../domain/types'

export const SHARE_CARD_WIDTH = 1280
export const SHARE_CARD_HEIGHT = 720

export interface ShareCardRenderOptions {
  sourceCanvas: HTMLCanvasElement
  project: TerrainProject
  snapshot?: TerrainSnapshot
  referenceGapReport?: ReferenceGapReport
}

export async function renderShareCard({
  sourceCanvas,
  project,
  snapshot,
  referenceGapReport,
}: ShareCardRenderOptions): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = SHARE_CARD_WIDTH
  canvas.height = SHARE_CARD_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建导出画布')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  context.fillStyle = '#101010'
  context.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT)

  const grid = drawTerrainGrid(snapshot)
  drawTerrainImage(context, sourceCanvas, grid)
  drawVignette(context, grid)
  drawPeaks(context, grid, project.peaks)
  drawOverlay(context, project, snapshot)
  drawReferenceGapSummary(context, project, referenceGapReport, {
    left: 0,
    top: 0,
    width: SHARE_CARD_WIDTH,
    height: SHARE_CARD_HEIGHT - 52,
  })

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('无法生成分享卡片'))
    }, 'image/png', 1)
  })
}

interface CanvasBounds {
  left: number
  top: number
  width: number
  height: number
}

const MAX_REFERENCE_GAP_ITEMS = 3

export function drawReferenceGapSummary(
  context: CanvasRenderingContext2D,
  project: TerrainProject,
  report: ReferenceGapReport | undefined,
  bounds: CanvasBounds = {
    left: 0,
    top: 0,
    width: context.canvas.width,
    height: context.canvas.height,
  },
): void {
  if (!report?.enabled) return

  const scale = Math.max(0.7, Math.min(1.6, Math.min(bounds.width / SHARE_CARD_WIDTH, bounds.height / SHARE_CARD_HEIGHT)))
  const margin = 24 * scale
  const padding = 18 * scale
  const panelWidth = Math.min(360 * scale, bounds.width - margin * 2)
  if (panelWidth <= padding * 2) return

  const counts = { missing: 0, sparse: 0, stale: 0 }
  for (const gap of report.gaps) {
    if (gap.state !== 'covered') counts[gap.state] += 1
  }
  const gaps = report.gaps
    .filter((gap) => gap.state !== 'covered')
    .sort((a, b) => b.gap * b.expectedWeight - a.gap * a.expectedWeight || a.label.localeCompare(b.label))
    .slice(0, MAX_REFERENCE_GAP_ITEMS)
  const rowHeight = 25 * scale
  const panelHeight = (gaps.length ? 142 : 150) * scale + gaps.length * rowHeight
  const left = bounds.left + bounds.width - panelWidth - margin
  const top = bounds.top + Math.max(margin, bounds.height - panelHeight - margin)
  const atlas = project.referenceAtlases?.find((candidate) => candidate.id === report.referenceAtlasId)
  const atlasLabel = atlas?.label ?? report.referenceAtlasId ?? '已选参考图谱'

  context.save()
  context.fillStyle = 'rgba(10, 15, 17, 0.92)'
  context.fillRect(left, top, panelWidth, panelHeight)
  context.strokeStyle = 'rgba(121, 169, 174, 0.7)'
  context.lineWidth = Math.max(1, scale)
  context.strokeRect(left + 0.5, top + 0.5, panelWidth - 1, panelHeight - 1)
  context.fillStyle = '#79a9ae'
  context.fillRect(left, top, 3 * scale, panelHeight)
  context.textBaseline = 'alphabetic'
  context.textAlign = 'left'

  let y = top + padding + 11 * scale
  context.fillStyle = 'rgba(151, 201, 205, 0.92)'
  context.font = `700 ${11 * scale}px -apple-system, "PingFang SC", sans-serif`
  context.fillText('REFERENCE OCEAN / GAP · 非空间摘要', left + padding, y)

  y += 26 * scale
  context.fillStyle = '#f3eee2'
  context.font = `700 ${19 * scale}px -apple-system, "PingFang SC", "Noto Sans CJK SC", sans-serif`
  context.fillText(truncateText(context, atlasLabel, panelWidth - padding * 2), left + padding, y)

  y += 23 * scale
  context.fillStyle = 'rgba(243, 238, 226, 0.7)'
  context.font = `500 ${12 * scale}px -apple-system, "PingFang SC", sans-serif`
  context.fillText(`未覆盖 ${counts.missing} · 稀疏 ${counts.sparse} · 已过期 ${counts.stale}`, left + padding, y)

  y += 14 * scale
  context.strokeStyle = 'rgba(121, 169, 174, 0.28)'
  context.beginPath()
  context.moveTo(left + padding, y)
  context.lineTo(left + panelWidth - padding, y)
  context.stroke()

  if (gaps.length === 0) {
    y += 26 * scale
    context.fillStyle = 'rgba(243, 238, 226, 0.72)'
    context.fillText('当前没有待补覆盖节点', left + padding, y)
  } else {
    for (const gap of gaps) {
      y += rowHeight
      context.fillStyle = gap.state === 'missing' ? '#df9d78' : gap.state === 'stale' ? '#8fb8b2' : '#d6bd72'
      context.fillText('●', left + padding, y)
      context.fillStyle = 'rgba(243, 238, 226, 0.9)'
      context.fillText(truncateText(context, gap.label, panelWidth - padding * 2 - 102 * scale), left + padding + 16 * scale, y)
      context.fillStyle = 'rgba(243, 238, 226, 0.58)'
      context.textAlign = 'right'
      context.fillText(`${gapStateLabel(gap.state)} ${Math.round(gap.gap * 100)}%`, left + panelWidth - padding, y)
      context.textAlign = 'left'
    }
  }

  y = top + panelHeight - 17 * scale
  context.fillStyle = 'rgba(151, 201, 205, 0.65)'
  context.font = `500 ${10 * scale}px -apple-system, "PingFang SC", sans-serif`
  const remaining = report.gaps.filter((gap) => gap.state !== 'covered').length - gaps.length
  context.fillText(
    remaining > 0 ? `另有 ${remaining} 项 · 仅相对所选 atlas，不对应地图坐标` : '仅相对所选 atlas，不对应地图坐标',
    left + padding,
    y,
  )
  context.restore()
}

function gapStateLabel(state: ReferenceGapReport['gaps'][number]['state']): string {
  return state === 'missing' ? '未覆盖' : state === 'sparse' ? '稀疏' : '已过期'
}

interface Grid {
  left: number
  top: number
  width: number
  height: number
  gap: number
}

function drawTerrainGrid(snapshot?: TerrainSnapshot): Grid {
  const gridSize = snapshot ? Math.round(Math.sqrt(snapshot.values.length)) : 0
  const horizontalGap = snapshot ? gridSize * 1.6 : 0
  const width = snapshot ? Math.round(SHARE_CARD_WIDTH - 168 - horizontalGap) : SHARE_CARD_WIDTH
  const left = snapshot ? 168 : 0
  const top = 0
  const height = SHARE_CARD_HEIGHT
  return { left, top, width, height, gap: horizontalGap }
}

function drawTerrainImage(
  context: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  grid: Grid,
): void {
  const scale = grid.width / sourceCanvas.width
  const drawHeight = Math.round(sourceCanvas.height * scale)
  context.drawImage(sourceCanvas, grid.left, grid.top, grid.width, drawHeight)
  if (drawHeight < grid.height) {
    context.fillStyle = '#101010'
    context.fillRect(grid.left, drawHeight, grid.width, grid.height - drawHeight)
  }
}

function drawVignette(context: CanvasRenderingContext2D, grid: Grid): void {
  const gradient = context.createLinearGradient(grid.left, 0, grid.left + grid.width, 0)
  gradient.addColorStop(0, 'rgba(16, 16, 16, 0.75)')
  gradient.addColorStop(0.55, 'rgba(16, 16, 16, 0)')
  gradient.addColorStop(1, 'rgba(16, 16, 16, 0.55)')
  context.fillStyle = gradient
  context.fillRect(grid.left, 0, grid.width, grid.height)
}

function drawPeaks(context: CanvasRenderingContext2D, grid: Grid, peaks: TerrainPeak[]): void {
  const top = peaks.slice(0, 5)
  const centerX = grid.left + grid.width / 2
  const centerY = grid.top + grid.height / 2
  const halfW = grid.width * 0.44
  const halfH = grid.height * 0.44
  const dotSize = 5
  context.font = '600 15px -apple-system, "PingFang SC", "Noto Sans CJK SC", sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'bottom'
  top.forEach((peak) => {
    const x = centerX + peak.x * halfW
    const y = centerY - peak.y * halfH
    if (x < grid.left || x > grid.left + grid.width || y < grid.top || y > grid.top + grid.height) return
    context.beginPath()
    context.arc(x, y, dotSize, 0, Math.PI * 2)
    context.fillStyle = 'rgba(243, 238, 222, 0.95)'
    context.fill()
    context.strokeStyle = 'rgba(185, 171, 118, 0.9)'
    context.lineWidth = 1.5
    context.stroke()
    context.fillStyle = 'rgba(243, 238, 222, 0.92)'
    context.shadowColor = 'rgba(0, 0, 0, 0.8)'
    context.shadowBlur = 6
    context.fillText(peak.label, x, y - dotSize - 4)
    context.shadowBlur = 0
  })
}

function drawOverlay(
  context: CanvasRenderingContext2D,
  project: TerrainProject,
  snapshot: TerrainSnapshot | undefined,
): void {
  context.textBaseline = 'alphabetic'
  const labelX = 168
  const labelY = 76

  context.fillStyle = '#b9ab76'
  context.font = '700 14px -apple-system, "PingFang SC", sans-serif'
  context.textAlign = 'left'
  context.fillText('认知地形 · COGNITIVE TERRAIN', labelX, labelY)

  context.fillStyle = '#f3eee2'
  context.font = '700 40px -apple-system, "PingFang SC", "Noto Sans CJK SC", sans-serif'
  context.fillText(truncateText(context, project.name, 780), labelX, labelY + 56)

  const stats = [
    `${project.notes.length} 条笔记`,
    `${project.peaks.length} 个主题顶峰`,
    project.embeddingMode === 'semantic' ? '语义向量' : project.embeddingMode === 'demo' ? '演示布局' : '降级向量',
  ]
  context.font = '500 17px -apple-system, "PingFang SC", sans-serif'
  context.fillStyle = 'rgba(243, 238, 222, 0.82)'
  context.fillText(stats.join(' · '), labelX, labelY + 92)

  const timeRange = formatTimeRange(project)
  context.font = '400 15px -apple-system, "PingFang SC", sans-serif'
  context.fillStyle = 'rgba(243, 238, 222, 0.5)'
  context.fillText(timeRange, labelX, labelY + 122)

  const footerY = SHARE_CARD_HEIGHT - 44
  context.fillStyle = 'rgba(185, 171, 118, 0.9)'
  context.font = '600 13px -apple-system, "PingFang SC", sans-serif'
  context.fillText('在认知地形中查看 →', labelX, footerY)

  if (snapshot) {
    context.fillStyle = 'rgba(243, 238, 222, 0.45)'
    context.font = '400 13px -apple-system, "PingFang SC", sans-serif'
    context.fillText(snapshot.label, labelX, footerY)
  }

  context.strokeStyle = 'rgba(185, 171, 118, 0.55)'
  context.lineWidth = 1
  context.strokeRect(labelX - 22, 48, 2, 104)
}

function formatTimeRange(project: TerrainProject): string {
  if (!project.notes.length) return '暂无笔记'
  let min = Infinity
  let max = -Infinity
  for (const note of project.notes) {
    if (note.createdAtMs < min) min = note.createdAtMs
    if (note.createdAtMs > max) max = note.createdAtMs
  }
  const format = (value: number) =>
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: project.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(value))
  if (min === Infinity || max === -Infinity) return '暂无笔记'
  return `${format(min)} — ${format(max)}`
}

function truncateText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text
  let low = 0
  let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (context.measureText(text.slice(0, middle)).width + 24 <= maxWidth) low = middle
    else high = middle - 1
  }
  return `${text.slice(0, low)}…`
}
