import type { QualityLevel } from '../domain/types'

export const TERRAIN_VISUAL_PROFILE = {
  colors: {
    background: '#080a0b',
    field: '#0b0e10',
    fieldGrid: '#263136',
    terrainLow: '#0d1012',
    terrainMiddle: '#182024',
    terrainHigh: '#7b878d',
    contour: '#c2c8c7',
    pointLow: '#647178',
    pointHigh: '#d5e1e0',
    peak: '#eef4f2',
    selected: '#f0c96a',
    mist: '#70858e',
  },
  terrain: {
    contourLevels: {
      high: 30,
      medium: 22,
      low: 15,
    },
    contourOpacity: {
      high: 0.105,
      medium: 0.075,
      low: 0.045,
    },
    reflectionSpeed: 0.22,
    reflectionAmount: 0.075,
    fresnelAmount: 0.12,
  },
  points: {
    baseSize: 0.029,
    minimumPixels: 1.1,
    maximumPixels: 7.8,
  },
  peaks: {
    coreSize: 0.052,
    glowSize: 0.72,
    glowOpacity: 0.24,
  },
  mist: {
    altitude: 0.012,
    opacity: {
      high: 0.11,
      medium: 0.075,
      low: 0,
    },
    period: 18,
  },
  post: {
    bloomIntensity: {
      high: 0.34,
      medium: 0.25,
    },
    bloomThreshold: 0.72,
    bloomSmoothing: 0.66,
    vignetteOffset: 0.22,
    vignetteDarkness: 0.42,
  },
} as const

export function getTerrainQualityProfile(quality: QualityLevel) {
  return {
    contourLevels: TERRAIN_VISUAL_PROFILE.terrain.contourLevels[quality],
    contourOpacity: TERRAIN_VISUAL_PROFILE.terrain.contourOpacity[quality],
    mistOpacity: TERRAIN_VISUAL_PROFILE.mist.opacity[quality],
    useDynamicTerrain: quality === 'high',
    useMist: quality !== 'low',
  }
}
