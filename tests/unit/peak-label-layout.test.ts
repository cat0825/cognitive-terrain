import { describe, expect, it } from 'vitest'
import {
  layoutPeakLabels,
  MOBILE_PEAK_LABEL_LIMIT,
  peakLabelLimitForZoom,
  peakLabelSafeArea,
  resolvePeakLabelZoomTier,
  type PeakLabelCandidate,
} from '../../src/scene/peak-label-layout'

const viewport = { viewportWidth: 390, viewportHeight: 844 }

describe('peak label layout', () => {
  it('clamps visible label boxes inside the safe viewport', () => {
    const safeArea = peakLabelSafeArea(true)
    const [placement] = layoutPeakLabels([
      candidate({ id: 'edge', anchorX: -18, anchorY: 18, width: 100, height: 20 }),
    ], {
      ...viewport,
      safeArea,
      limit: MOBILE_PEAK_LABEL_LIMIT,
    })

    expect(placement.visible).toBe(true)
    expect(placement.x - 50).toBeGreaterThanOrEqual(safeArea.left)
    expect(placement.x + 50).toBeLessThanOrEqual(viewport.viewportWidth - safeArea.right)
    expect(placement.y - 10).toBeGreaterThanOrEqual(safeArea.top)
    expect(placement.y + 10).toBeLessThanOrEqual(viewport.viewportHeight - safeArea.bottom)
  })

  it('resolves collisions by selection, importance, then stable id', () => {
    const selected = layoutPeakLabels([
      candidate({ id: 'important', importance: 20 }),
      candidate({ id: 'selected', importance: 0, selected: true }),
    ], layoutOptions())
    expect(visibleIds(selected)).toEqual(['selected'])

    const important = layoutPeakLabels([
      candidate({ id: 'low', importance: 1 }),
      candidate({ id: 'high', importance: 2 }),
    ], layoutOptions())
    expect(visibleIds(important)).toEqual(['high'])

    const stable = layoutPeakLabels([
      candidate({ id: 'peak-b', importance: 2 }),
      candidate({ id: 'peak-a', importance: 2 }),
    ], layoutOptions())
    expect(visibleIds(stable)).toEqual(['peak-a'])
  })

  it('never exceeds the documented mobile label limit', () => {
    const candidates = Array.from({ length: 12 }, (_, index) => candidate({
      id: `peak-${index.toString().padStart(2, '0')}`,
      anchorX: 30 + (index % 4) * 80,
      anchorY: 80 + Math.floor(index / 4) * 80,
      width: 40,
      height: 16,
    }))
    const placements = layoutPeakLabels(candidates, {
      ...viewport,
      safeArea: peakLabelSafeArea(true),
      limit: MOBILE_PEAK_LABEL_LIMIT,
    })

    expect(placements.filter((placement) => placement.visible)).toHaveLength(MOBILE_PEAK_LABEL_LIMIT)
  })

  it('hides distant offscreen anchors but keeps a selected label available', () => {
    const placements = layoutPeakLabels([
      candidate({ id: 'hidden', anchorX: -200 }),
      candidate({ id: 'selected', anchorX: -200, selected: true }),
      candidate({ id: 'behind', selected: true, depthVisible: false }),
    ], layoutOptions())

    expect(placements.find((placement) => placement.id === 'hidden')?.visible).toBe(false)
    expect(placements.find((placement) => placement.id === 'selected')?.visible).toBe(true)
    expect(placements.find((placement) => placement.id === 'behind')?.visible).toBe(false)
  })

  it('keeps labels hidden until their DOM dimensions are measured', () => {
    const placements = layoutPeakLabels([
      candidate({ id: 'zero-width', width: 0 }),
      candidate({ id: 'zero-height', height: 0 }),
      candidate({ id: 'measured' }),
    ], layoutOptions())

    expect(visibleIds(placements)).toEqual(['measured'])
  })

  it('uses hysteresis at zoom thresholds and reduces the label budget by tier', () => {
    expect(resolvePeakLabelZoomTier(6.7, 'near')).toBe('near')
    expect(resolvePeakLabelZoomTier(6.7, 'medium')).toBe('medium')
    expect(resolvePeakLabelZoomTier(11.5, 'far')).toBe('far')
    expect(resolvePeakLabelZoomTier(11.5, 'medium')).toBe('medium')
    expect(resolvePeakLabelZoomTier(6.5, 'medium')).toBe('near')
    expect(resolvePeakLabelZoomTier(12.1, 'medium')).toBe('far')
    expect(peakLabelLimitForZoom(MOBILE_PEAK_LABEL_LIMIT, 'near')).toBe(8)
    expect(peakLabelLimitForZoom(MOBILE_PEAK_LABEL_LIMIT, 'medium')).toBe(6)
    expect(peakLabelLimitForZoom(MOBILE_PEAK_LABEL_LIMIT, 'far')).toBe(4)
  })
})

function candidate(overrides: Partial<PeakLabelCandidate>): PeakLabelCandidate {
  return {
    id: 'peak',
    anchorX: 160,
    anchorY: 160,
    width: 80,
    height: 20,
    importance: 1,
    selected: false,
    depthVisible: true,
    ...overrides,
  }
}

function layoutOptions() {
  return {
    ...viewport,
    safeArea: peakLabelSafeArea(true),
    limit: MOBILE_PEAK_LABEL_LIMIT,
  }
}

function visibleIds(placements: ReturnType<typeof layoutPeakLabels>): string[] {
  return placements.filter((placement) => placement.visible).map((placement) => placement.id)
}
