import type { TerrainProfile, VisualDimension } from './types'

export const DEFAULT_TERRAIN_PROFILE_ID = 'density'

export const DEFAULT_TERRAIN_PROFILES = [
  {
    id: 'density',
    label: '知识密度',
    elevation: 'density',
    color: 'area',
    formulaVersion: 'density-kde-v1',
  },
  {
    id: 'mastery',
    label: '熟练度',
    elevation: 'mastery',
    color: 'area',
    overlay: 'confidence',
    formulaVersion: 'mastery-density-v1',
  },
  {
    id: 'exploration',
    label: '探索度',
    elevation: 'exploration',
    color: 'area',
    formulaVersion: 'exploration-density-v1',
  },
  {
    id: 'activity',
    label: '近期活跃',
    elevation: 'activity',
    color: 'area',
    overlay: 'temperature',
    formulaVersion: 'activity-decay-v1',
  },
  {
    id: 'structure',
    label: '基础层级',
    elevation: 'structure',
    color: 'area',
    overlay: 'gaps',
    formulaVersion: 'explicit-prerequisite-strata-v1',
  },
] as const satisfies readonly TerrainProfile[]

export function terrainProfileById(id: string): TerrainProfile | undefined {
  return DEFAULT_TERRAIN_PROFILES.find((profile) => profile.id === id)
}

export function profileIdForVisualDimension(dimension: VisualDimension): string {
  return dimension === 'area' || dimension === 'temperature' ? DEFAULT_TERRAIN_PROFILE_ID : dimension
}
