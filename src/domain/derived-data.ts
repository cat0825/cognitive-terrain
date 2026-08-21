import { buildTerrainData } from '../pipeline/terrain'
import { EMBEDDING_NEIGHBOR_FORMULA_VERSION } from '../pipeline/neighbors'
import { STABLE_LAYOUT_FORMULA_VERSION } from './layout-version'
import { PREREQUISITE_FORMULA_VERSION, buildPrerequisiteTopology } from './prerequisite-topology'
import { DEFAULT_TERRAIN_PROFILE_ID } from './terrain-profile'
import type { TerrainProject, TerrainSnapshot } from './types'

export const DERIVED_TUPLE_VERSION = 1 as const
export const DENSITY_FORMULA_VERSION = 'density-kde-v1' as const

/**
 * The inputs that decide what derived data is allowed to look like.
 *
 * Derived data is only comparable across two projects when their tuples match:
 * a taxonomy rename, an atlas rebind, a new embedding model or a new layout
 * formula all change the meaning of the same numbers. Persisting the tuple next
 * to the derived values is what makes "rebuild and compare" a real check rather
 * than a hope.
 */
export interface ProjectVersionTuple {
  tupleVersion: typeof DERIVED_TUPLE_VERSION
  taxonomyVersion: number
  /** `taxonomyVersion` of the bound atlas, or null when no atlas is active. */
  referenceAtlasVersion: number | null
  /** Formula of the active terrain profile, which drives elevation semantics. */
  terrainFormulaVersion: string
  /** Formula behind the persisted density snapshots and peaks. */
  densityFormulaVersion: typeof DENSITY_FORMULA_VERSION
  layoutFormulaVersion: typeof STABLE_LAYOUT_FORMULA_VERSION
  neighborFormulaVersion: typeof EMBEDDING_NEIGHBOR_FORMULA_VERSION
  prerequisiteFormulaVersion: typeof PREREQUISITE_FORMULA_VERSION
  embeddingModelId: string
  embeddingMode: TerrainProject['embeddingMode']
}

/**
 * Parameters needed to reproduce the persisted terrain byte-for-byte.
 *
 * `bandwidth` is the reason this record exists: it was previously computed and
 * thrown away, so nobody could tell whether stored snapshots came from the
 * current formula or an older run. `peaks: 'authored'` marks projects whose
 * peaks are hand-placed (the demo terrain) rather than detected from density.
 */
export interface DerivedTerrainRecord {
  gridSize: number
  bandwidth: number
  timeZone: string
  formulaVersion: typeof DENSITY_FORMULA_VERSION
  peaks: 'derived' | 'authored'
}

export interface ProjectDerivedRecord {
  versionTuple: ProjectVersionTuple
  /** null when the project predates this record and its terrain is cache-only. */
  terrain: DerivedTerrainRecord | null
}

export interface DerivedRebuildResult {
  project: TerrainProject
  /** `cached` means the stored derived data was kept because it is not reproducible. */
  status: 'rebuilt' | 'cached'
  reason?: string
  /** Derived fields whose rebuilt value differed from what was stored. */
  mismatches: string[]
}

export function projectVersionTuple(project: TerrainProject): ProjectVersionTuple {
  const activeAtlas = project.referenceAtlases?.find(
    (manifest) => manifest.id === project.activeReferenceAtlasId,
  )
  const activeProfile = project.terrainProfiles?.find(
    (profile) => profile.id === project.activeTerrainProfileId,
  ) ?? project.terrainProfiles?.find((profile) => profile.id === DEFAULT_TERRAIN_PROFILE_ID)
  return {
    tupleVersion: DERIVED_TUPLE_VERSION,
    taxonomyVersion: Math.max(
      0,
      project.taxonomyVersion
        ?? (project.taxonomyNodes ?? []).reduce((max, node) => Math.max(max, node.version), 0),
    ),
    referenceAtlasVersion: activeAtlas ? activeAtlas.taxonomyVersion : null,
    terrainFormulaVersion: activeProfile?.formulaVersion ?? DENSITY_FORMULA_VERSION,
    densityFormulaVersion: DENSITY_FORMULA_VERSION,
    layoutFormulaVersion: STABLE_LAYOUT_FORMULA_VERSION,
    neighborFormulaVersion: EMBEDDING_NEIGHBOR_FORMULA_VERSION,
    prerequisiteFormulaVersion: PREREQUISITE_FORMULA_VERSION,
    embeddingModelId: project.modelId,
    embeddingMode: project.embeddingMode,
  }
}

export function sameVersionTuple(left: ProjectVersionTuple, right: ProjectVersionTuple): boolean {
  return left.tupleVersion === right.tupleVersion
    && left.taxonomyVersion === right.taxonomyVersion
    && left.referenceAtlasVersion === right.referenceAtlasVersion
    && left.terrainFormulaVersion === right.terrainFormulaVersion
    && left.densityFormulaVersion === right.densityFormulaVersion
    && left.layoutFormulaVersion === right.layoutFormulaVersion
    && left.neighborFormulaVersion === right.neighborFormulaVersion
    && left.prerequisiteFormulaVersion === right.prerequisiteFormulaVersion
    && left.embeddingModelId === right.embeddingModelId
    && left.embeddingMode === right.embeddingMode
}

export function derivedTerrainRecord(input: {
  gridSize: number
  bandwidth: number
  timeZone: string
  peaks?: DerivedTerrainRecord['peaks']
}): DerivedTerrainRecord {
  return {
    gridSize: input.gridSize,
    bandwidth: input.bandwidth,
    timeZone: input.timeZone,
    formulaVersion: DENSITY_FORMULA_VERSION,
    peaks: input.peaks ?? 'derived',
  }
}

/**
 * Refreshes the derived record without touching the derived values themselves.
 *
 * The version tuple always tracks the project's current core data, so a
 * taxonomy bump or atlas rebind is visible immediately. The terrain parameters
 * are carried over untouched: they describe how the stored snapshots were
 * produced, and inventing them for a legacy project would claim reproducibility
 * that does not exist.
 */
export function refreshDerivedRecord(project: TerrainProject): ProjectDerivedRecord {
  return {
    versionTuple: projectVersionTuple(project),
    terrain: project.derived?.terrain
      ? { ...project.derived.terrain }
      : null,
  }
}

/**
 * Rebuilds every derived field that core data plus the version tuple can
 * reproduce, and reports which stored values disagreed.
 *
 * Not everything derived is rebuildable here: neighbor evidence needs the
 * embedding vectors, which are deliberately not persisted. Those stay cached and
 * are listed in the ADR rather than silently recomputed from coordinates, which
 * would fabricate semantic evidence out of layout positions.
 */
export function rebuildProjectDerivedData(project: TerrainProject): DerivedRebuildResult {
  const prerequisiteTopology = buildPrerequisiteTopology(project.notes)
  const mismatches: string[] = []
  if (!sameTopology(project.prerequisiteTopology, prerequisiteTopology)) {
    mismatches.push('prerequisiteTopology')
  }

  const terrain = project.derived?.terrain
  if (!terrain) {
    return {
      project: { ...project, prerequisiteTopology, derived: refreshDerivedRecord(project) },
      status: 'cached',
      reason: '缺少地形派生参数（bandwidth / gridSize），无法复算快照',
      mismatches,
    }
  }

  const rebuilt = buildTerrainData(
    project.notes,
    terrain.gridSize,
    terrain.timeZone,
    terrain.bandwidth,
  )
  if (!sameSnapshots(project.snapshots, rebuilt.snapshots)) mismatches.push('snapshots')
  const peaks = terrain.peaks === 'authored' ? project.peaks : rebuilt.peaks
  if (terrain.peaks === 'derived' && !samePeaks(project.peaks, rebuilt.peaks)) mismatches.push('peaks')

  const next: TerrainProject = {
    ...project,
    gridSize: terrain.gridSize,
    snapshots: rebuilt.snapshots,
    peaks,
    prerequisiteTopology,
  }
  return {
    project: { ...next, derived: refreshDerivedRecord(next) },
    status: 'rebuilt',
    mismatches,
  }
}

function sameSnapshots(left: readonly TerrainSnapshot[], right: readonly TerrainSnapshot[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a.bucket !== b.bucket || a.label !== b.label) return false
    if (a.values.length !== b.values.length) return false
    for (let value = 0; value < a.values.length; value += 1) {
      if (a.values[value] !== b.values[value]) return false
    }
  }
  return true
}

function samePeaks(left: TerrainProject['peaks'], right: TerrainProject['peaks']): boolean {
  if (left.length !== right.length) return false
  return left.every((peak, index) => {
    const other = right[index]
    return peak.id === other.id
      && peak.label === other.label
      && peak.x === other.x
      && peak.y === other.y
      && peak.height === other.height
      && peak.noteIds.length === other.noteIds.length
      && peak.noteIds.every((noteId, noteIndex) => noteId === other.noteIds[noteIndex])
  })
}

function sameTopology(
  left: TerrainProject['prerequisiteTopology'],
  right: TerrainProject['prerequisiteTopology'],
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}
