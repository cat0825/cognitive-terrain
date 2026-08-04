import type { TerrainPeak, TerrainProject, TerrainSnapshot } from '../domain/types'

export const SHARE_CARD_WIDTH = 1280
export const SHARE_CARD_HEIGHT = 720

export interface ShareCardRenderOptions {
  sourceCanvas: HTMLCanvasElement
  project: TerrainProject
  snapshot?: TerrainSnapshot
}

export async function renderShareCard({
  sourceCanvas,
  project,
  snapshot,
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

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('无法生成分享卡片'))
    }, 'image/png', 1)
  })
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
