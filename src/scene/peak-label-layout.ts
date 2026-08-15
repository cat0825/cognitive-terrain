export const MOBILE_PEAK_LABEL_LIMIT = 8
export const DESKTOP_PEAK_LABEL_LIMIT = 24

export type PeakLabelZoomTier = 'near' | 'medium' | 'far'

export interface PeakLabelSafeArea {
  top: number
  right: number
  bottom: number
  left: number
}

export interface PeakLabelCandidate {
  id: string
  anchorX: number
  anchorY: number
  width: number
  height: number
  importance: number
  selected: boolean
  depthVisible: boolean
}

export interface PeakLabelPlacement {
  id: string
  x: number
  y: number
  visible: boolean
}

interface PeakLabelLayoutOptions {
  viewportWidth: number
  viewportHeight: number
  safeArea: PeakLabelSafeArea
  limit: number
  collisionGap?: number
  offscreenTolerance?: number
}

interface OccupiedRect {
  left: number
  top: number
  right: number
  bottom: number
}

const DEFAULT_COLLISION_GAP = 6
const DEFAULT_OFFSCREEN_TOLERANCE = 48

export function peakLabelSafeArea(compact: boolean): PeakLabelSafeArea {
  return compact
    ? { top: 52, right: 48, bottom: 62, left: 20 }
    : { top: 20, right: 56, bottom: 66, left: 20 }
}

export function peakLabelImportance(height: number, noteCount: number): number {
  return Math.max(0, height) * 2 + Math.log1p(Math.max(0, noteCount))
}

export function resolvePeakLabelZoomTier(
  cameraDistance: number,
  previous: PeakLabelZoomTier = 'medium',
): PeakLabelZoomTier {
  if (previous === 'near') return cameraDistance > 7.2 ? 'medium' : 'near'
  if (previous === 'far') return cameraDistance < 11.2 ? 'medium' : 'far'
  if (cameraDistance < 6.6) return 'near'
  if (cameraDistance > 12) return 'far'
  return 'medium'
}

export function peakLabelLimitForZoom(baseLimit: number, tier: PeakLabelZoomTier): number {
  const safeLimit = Math.max(0, Math.floor(baseLimit))
  if (tier === 'near') return safeLimit
  if (tier === 'far') return Math.ceil(safeLimit * 0.5)
  return Math.ceil(safeLimit * 0.75)
}

export function layoutPeakLabels(
  candidates: readonly PeakLabelCandidate[],
  options: PeakLabelLayoutOptions,
): PeakLabelPlacement[] {
  const viewportWidth = Math.max(0, options.viewportWidth)
  const viewportHeight = Math.max(0, options.viewportHeight)
  const leftBound = Math.max(0, options.safeArea.left)
  const topBound = Math.max(0, options.safeArea.top)
  const rightBound = Math.max(leftBound, viewportWidth - Math.max(0, options.safeArea.right))
  const bottomBound = Math.max(topBound, viewportHeight - Math.max(0, options.safeArea.bottom))
  const collisionGap = Math.max(0, options.collisionGap ?? DEFAULT_COLLISION_GAP)
  const offscreenTolerance = Math.max(0, options.offscreenTolerance ?? DEFAULT_OFFSCREEN_TOLERANCE)
  const limit = Math.max(0, Math.floor(options.limit))
  const placements = new Map<string, PeakLabelPlacement>()
  const occupied: OccupiedRect[] = []
  let visibleCount = 0

  const ordered = [...candidates].sort(compareCandidates)
  for (const candidate of ordered) {
    const fallback = { id: candidate.id, x: candidate.anchorX, y: candidate.anchorY, visible: false }
    if (!candidate.depthVisible || !isAnchorNearViewport(candidate, viewportWidth, viewportHeight, offscreenTolerance)) {
      placements.set(candidate.id, fallback)
      continue
    }

    const usableWidth = Math.max(0, rightBound - leftBound)
    const usableHeight = Math.max(0, bottomBound - topBound)
    const halfWidth = Math.min(Math.max(0, candidate.width), usableWidth) * 0.5
    const halfHeight = Math.min(Math.max(0, candidate.height), usableHeight) * 0.5
    const x = clamp(candidate.anchorX, leftBound + halfWidth, rightBound - halfWidth)
    const y = clamp(candidate.anchorY, topBound + halfHeight, bottomBound - halfHeight)
    const rect = {
      left: x - halfWidth,
      top: y - halfHeight,
      right: x + halfWidth,
      bottom: y + halfHeight,
    }
    const blocked = occupied.some((existing) => rectanglesOverlap(rect, existing, collisionGap))
    const overBudget = visibleCount >= limit && !candidate.selected

    if (blocked || overBudget) {
      placements.set(candidate.id, { ...fallback, x, y })
      continue
    }

    occupied.push(rect)
    visibleCount += 1
    placements.set(candidate.id, { id: candidate.id, x, y, visible: true })
  }

  return candidates.map((candidate) => placements.get(candidate.id) ?? {
    id: candidate.id,
    x: candidate.anchorX,
    y: candidate.anchorY,
    visible: false,
  })
}

function compareCandidates(a: PeakLabelCandidate, b: PeakLabelCandidate): number {
  if (a.selected !== b.selected) return a.selected ? -1 : 1
  if (a.importance !== b.importance) return b.importance - a.importance
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

function isAnchorNearViewport(
  candidate: PeakLabelCandidate,
  viewportWidth: number,
  viewportHeight: number,
  tolerance: number,
): boolean {
  if (candidate.selected) return true
  return candidate.anchorX >= -tolerance
    && candidate.anchorX <= viewportWidth + tolerance
    && candidate.anchorY >= -tolerance
    && candidate.anchorY <= viewportHeight + tolerance
}

function rectanglesOverlap(a: OccupiedRect, b: OccupiedRect, gap: number): boolean {
  return a.left < b.right + gap
    && a.right + gap > b.left
    && a.top < b.bottom + gap
    && a.bottom + gap > b.top
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) return (min + max) * 0.5
  return Math.max(min, Math.min(max, value))
}
