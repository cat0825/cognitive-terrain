import { calculateActivityElevation } from './activity-elevation'
import { areasForNote, normalizeArea, type PlateCollision } from './knowledge-plates'
import {
  REFERENCE_GAP_FORMULA_VERSION,
  type ReferenceGapReport,
} from './reference-gaps'
import type {
  CognitiveStateProvenance,
  TerrainNote,
  NoteNeighborEvidence as StoredNoteNeighborEvidence,
  TerrainPeak,
  TerrainProfile,
  TerrainProject,
  VisualDimension,
} from './types'
import { profileIdForVisualDimension, terrainProfileById } from './terrain-profile'

export const TERRAIN_EVIDENCE_SCHEMA_VERSION = 'terrain-evidence-v1' as const
export const TERRAIN_LEGEND_FORMULA_VERSION = 'terrain-legend-v1' as const
export const PLANAR_POSITION_FORMULA_VERSION = 'embedding-umap-v1' as const
export const NOTE_NEIGHBOR_EVIDENCE_FORMULA_VERSION = 'note-neighbor-evidence-v1' as const
export const PROVIDED_EMBEDDING_SCORE_FORMULA_VERSION = 'provided-embedding-score-v1' as const
export const UMAP_APPROXIMATE_DISTANCE_FORMULA_VERSION = 'umap-approximate-distance-v1' as const
export const PEAK_EVIDENCE_FORMULA_VERSION = 'peak-local-maximum-v1' as const
export const PEAK_DENSITY_FORMULA_VERSION = 'density-kde-v1' as const
export const PLATE_FORMULA_VERSION = 'declared-taxonomy-plate-v1' as const
export const COLLISION_EVIDENCE_FORMULA_VERSION = 'wikilink-collision-v1' as const
export const COLLISION_DIRECTION_FORMULA_VERSION = 'wikilink-direction-v1' as const
export const COLLISION_STRENGTH_FORMULA_VERSION = 'collision-strength-log2-v1' as const

export type TerrainSemanticKind =
  | 'planar-position'
  | 'peak'
  | 'elevation'
  | 'color'
  | 'overlay'
  | 'plate'
  | 'collision'
  | 'gap'

export type TerrainEvidenceProvenance =
  | 'embedding-model'
  | 'deterministic-fallback'
  | 'demo-fixture'
  | 'stored-neighbor-index'
  | 'umap-projection'
  | 'stored-terrain-output'
  | 'kernel-density'
  | 'terrain-profile'
  | 'declared-taxonomy'
  | 'note-tag'
  | 'explicit-wikilink'
  | 'explicit-prerequisite'
  | 'cognitive-state-yaml'
  | 'cognitive-state-app'
  | 'cognitive-state-migration'
  | 'raw-event'
  | 'retained-aggregate'
  | 'reference-atlas'
  | 'activity-history'
  | 'source-metadata'

export interface TerrainEvidenceEnvelope<Kind extends string> {
  schemaVersion: typeof TERRAIN_EVIDENCE_SCHEMA_VERSION
  kind: Kind
  formulaVersion: string
  provenance: TerrainEvidenceProvenance[]
  supportingIds: string[]
  evaluatedAt?: string
}

export interface TerrainLegendEntry extends TerrainEvidenceEnvelope<TerrainSemanticKind> {
  label: string
  definition: string
  limitation: string
  active: boolean
}

export interface TerrainSemanticsLegend {
  schemaVersion: typeof TERRAIN_EVIDENCE_SCHEMA_VERSION
  formulaVersion: typeof TERRAIN_LEGEND_FORMULA_VERSION
  activeProfileId: string
  embeddingMode: TerrainProject['embeddingMode']
  modelId: string
  entries: TerrainLegendEntry[]
  evaluatedAt?: string
}

export interface TerrainLegendOptions {
  profileId?: string
  visualDimension?: VisualDimension
  evaluatedAt?: string | number | Date
}

export interface NeighborEvidenceOptions {
  /** Original high-dimensional score. It is never inferred from the 2D projection. */
  embeddingScore?: number
  embeddingScoreKind?: 'similarity' | 'distance'
  modelId?: string
  evaluatedAt?: string | number | Date
}

export interface TerrainNeighborEvidence extends TerrainEvidenceEnvelope<'note-neighbor'> {
  originItemId: string
  targetItemId: string
  storedNeighborRank: number | null
  embedding: {
    mode: TerrainProject['embeddingMode']
    modelId: string
    formulaVersion: string
    scoreSource: 'stored-embedding-evidence' | 'provided-input' | 'unavailable'
    score: number | null
    scoreKind: 'similarity' | 'distance' | 'unavailable'
    semanticEvidence: boolean
    limitation: string
  }
  projection: {
    algorithm: 'UMAP'
    formulaVersion: typeof UMAP_APPROXIMATE_DISTANCE_FORMULA_VERSION
    approximate: true
    distance: number
    limitation: string
  }
  taxonomy: {
    sharedNodeIds: string[]
    sharedLabels: string[]
  }
  tags: {
    sharedTags: string[]
  }
  wikiLink: {
    explicit: boolean
    links: Array<{
      id: string
      fromItemId: string
      toItemId: string
      declaredTarget: string
    }>
  }
}

export interface PeakEvidenceOptions {
  profileId?: string
  evaluatedAt?: string | number | Date
}

export interface PeakEvidence extends TerrainEvidenceEnvelope<'peak'> {
  peak: Pick<TerrainPeak, 'id' | 'label' | 'x' | 'y' | 'height'>
  memberItemIds: string[]
  missingMemberItemIds: string[]
  labelEvidence: {
    source: 'dominant-tag' | 'nearest-note-title' | 'stored-label'
    label: string
    supportingItemIds: string[]
    tagCount?: number
  }
  localDensity: {
    formulaVersion: typeof PEAK_DENSITY_FORMULA_VERSION
    basis: 'stored-peak-membership'
    contributions: Array<{
      itemId: string
      noteWeight: number
      projectedDistance: number
    }>
    limitation: string
  }
  activeHeight: {
    profileId: string
    elevation: TerrainProfile['elevation']
    formulaVersion: string
    missingInputBehavior: string
    inputs: Array<{
      itemId: string
      value: number | null
      confidence: number | null
      missing: boolean
      provenance: TerrainEvidenceProvenance[]
      supportingIds: string[]
    }>
  }
}

export interface CollisionEvidence extends TerrainEvidenceEnvelope<'collision'> {
  collisionId: string
  plates: {
    firstArea: string
    secondArea: string
  }
  summary: {
    relationCount: number
    mode: PlateCollision['mode']
    direction: PlateCollision['direction']
    directionConfidence: number
    directionFormulaVersion: typeof COLLISION_DIRECTION_FORMULA_VERSION
    strength: number
    strengthFormulaVersion: typeof COLLISION_STRENGTH_FORMULA_VERSION
  }
  wikiLinks: Array<{
    id: string
    bridgeId: string
    fromItemId: string
    toItemId: string
    fromArea: string
    toArea: string
  }>
  projection: Array<{
    bridgeId: string
    approximate: true
    formulaVersion: typeof UMAP_APPROXIMATE_DISTANCE_FORMULA_VERSION
    distance: number
  }>
  tags: Array<{
    bridgeId: string
    sharedTags: string[]
  }>
  limitation: string
}

export interface GapEvidence extends TerrainEvidenceEnvelope<'gap'> {
  enabled: boolean
  reason?: 'no-reference-atlas' | 'unknown-reference-node'
  referenceAtlasId?: string
  node?: {
    id: string
    label: string
    state: 'missing' | 'sparse' | 'stale' | 'covered'
    expectedWeight: number
    gap: number
    ocean: number
    expectedNodeIds: string[]
    supportingItemIds: string[]
    lastSupportingAt?: string
  }
  relativeToSelectedReference: boolean
  limitation: string
}

export function buildTerrainSemanticsLegend(
  project: TerrainProject,
  options: TerrainLegendOptions = {},
): TerrainSemanticsLegend {
  const evaluatedAt = normalizeOptionalTimestamp(options.evaluatedAt)
  const profile = activeProfile(
    project,
    options.profileId ?? (options.visualDimension ? profileIdForVisualDimension(options.visualDimension) : undefined),
  )
  const color = effectiveColorEncoding(options.visualDimension, profile)
  const activeAtlas = project.referenceAtlases?.find((atlas) => atlas.id === project.activeReferenceAtlasId)
  const positionProvenance = embeddingProvenance(project.embeddingMode)
  const entries: TerrainLegendEntry[] = [
    legendEntry('planar-position', '平面位置', PLANAR_POSITION_FORMULA_VERSION, positionProvenance, [], true,
      '先由模型或确定性回退生成高维表示，再经 UMAP 投影到二维；距离只表示近似布局邻近。',
      '二维距离不是原始 embedding 分数，也不证明显式关系、先修关系或因果。', evaluatedAt),
    legendEntry('peak', '山峰', PEAK_EVIDENCE_FORMULA_VERSION, ['kernel-density', 'stored-terrain-output'], [], true,
      '山峰是地形栅格中的局部极大值，成员来自峰顶附近的已存笔记集合。',
      '峰名是标签或笔记标题的摘要，不是权威学科分类。', evaluatedAt),
    legendEntry('elevation', '海拔', profile.formulaVersion, elevationProvenance(profile.elevation), [profile.id], true,
      `当前海拔采用「${profile.label}」配置，只改变高度，不改变平面位置。`,
      elevationLimitation(profile.elevation), timeSensitive(profile) ? evaluatedAt ?? normalizeTimestamp(project.updatedAt) : undefined),
    legendEntry('color', '颜色', color.formulaVersion, color.provenance, [profile.id], true,
      color.definition,
      '颜色与海拔分开编码；颜色相同不表示 embedding 相同或存在 WikiLink。', color.timeSensitive
        ? evaluatedAt ?? normalizeTimestamp(project.updatedAt)
        : evaluatedAt),
    legendEntry('overlay', '叠加层', activeAtlas ? REFERENCE_GAP_FORMULA_VERSION : 'overlay-none-v1', activeAtlas ? ['reference-atlas', 'declared-taxonomy'] : [], activeAtlas ? [activeAtlas.id] : [], Boolean(activeAtlas),
      activeAtlas ? `当前叠加层显示相对「${activeAtlas.label}」的参考图谱缺口。` : '当前没有启用独立叠加层。',
      '叠加层不改变原始笔记、平面位置或显式关系。', activeAtlas ? evaluatedAt ?? normalizeTimestamp(project.updatedAt) : evaluatedAt),
    legendEntry('plate', '知识板块', PLATE_FORMULA_VERSION, ['declared-taxonomy'], [], true,
      '板块来自笔记显式声明的 area/areas 与版本化 taxonomy 映射。',
      '板块不是由 embedding 聚类自动推断的学科真相。', evaluatedAt),
    legendEntry('collision', '板块碰撞', COLLISION_EVIDENCE_FORMULA_VERSION, ['declared-taxonomy', 'explicit-wikilink'], [], true,
      '碰撞仅由跨板块、可解析的显式 WikiLink 聚合；方向来自链接方向计数。',
      '空间接近、共享标签或 embedding 相似度不能单独生成碰撞。', evaluatedAt),
    legendEntry('gap', '海洋 / 缺口', REFERENCE_GAP_FORMULA_VERSION, activeAtlas ? ['reference-atlas', 'declared-taxonomy'] : [], activeAtlas ? [activeAtlas.id] : [], Boolean(activeAtlas),
      activeAtlas ? `仅表示当前项目相对所选参考图谱「${activeAtlas.label}」的覆盖差距。` : '未选择有效参考图谱，缺口语义禁用。',
      '缺口不是用户能力、无知程度或低活动的判断。', evaluatedAt ?? (activeAtlas ? normalizeTimestamp(project.updatedAt) : undefined)),
  ]
  return {
    schemaVersion: TERRAIN_EVIDENCE_SCHEMA_VERSION,
    formulaVersion: TERRAIN_LEGEND_FORMULA_VERSION,
    activeProfileId: profile.id,
    embeddingMode: project.embeddingMode,
    modelId: project.modelId,
    entries,
    ...(evaluatedAt ? { evaluatedAt } : {}),
  }
}

export const buildTerrainLegend = buildTerrainSemanticsLegend

export function buildNoteNeighborEvidence(
  project: TerrainProject,
  originItemId: string,
  targetItemId: string,
  options: NeighborEvidenceOptions = {},
): TerrainNeighborEvidence | undefined {
  const origin = project.notes.find((note) => note.id === originItemId)
  const target = project.notes.find((note) => note.id === targetItemId)
  if (!origin || !target || origin.id === target.id) return undefined
  const originIndex = project.notes.findIndex((note) => note.id === origin.id)
  const storedEvidence: StoredNoteNeighborEvidence | undefined = project.noteNeighborEvidence
    ?.flat()
    .find((candidate) => candidate.sourceId === origin.id && candidate.targetId === target.id)
  const storedRankIndex = storedEvidence
    ? Math.max(0, storedEvidence.rank - 1)
    : project.noteNeighbors[originIndex]?.indexOf(target.id) ?? -1
  const embeddingMode = storedEvidence?.embeddingMode ?? project.embeddingMode
  const providedScore = finiteOrNull(options.embeddingScore)
  const embeddingScore = providedScore ?? finiteOrNull(storedEvidence?.score)
  const sharedTaxonomy = sharedTaxonomyEvidence(project, origin, target)
  const sharedTags = sharedTagsOf(origin, target)
  const wikiLinks = wikiLinksBetween(origin, target)
  const evaluatedAt = normalizeOptionalTimestamp(options.evaluatedAt)
  const provenance = unique([
    ...embeddingProvenance(embeddingMode),
    ...(storedRankIndex >= 0 ? ['stored-neighbor-index' as const] : []),
    'umap-projection' as const,
    ...(sharedTaxonomy.sharedLabels.length ? ['declared-taxonomy' as const] : []),
    ...(sharedTags.length ? ['note-tag' as const] : []),
    ...(wikiLinks.length ? ['explicit-wikilink' as const] : []),
  ])
  return {
    schemaVersion: TERRAIN_EVIDENCE_SCHEMA_VERSION,
    kind: 'note-neighbor',
    formulaVersion: NOTE_NEIGHBOR_EVIDENCE_FORMULA_VERSION,
    provenance,
    supportingIds: unique([origin.id, target.id, ...wikiLinks.map((link) => link.id)]).sort(),
    ...(evaluatedAt ? { evaluatedAt } : {}),
    originItemId: origin.id,
    targetItemId: target.id,
    storedNeighborRank: storedRankIndex >= 0 ? storedRankIndex + 1 : null,
    embedding: {
      mode: embeddingMode,
      modelId: options.modelId ?? storedEvidence?.modelId ?? project.modelId,
      formulaVersion: providedScore !== null
        ? PROVIDED_EMBEDDING_SCORE_FORMULA_VERSION
        : storedEvidence?.formulaVersion ?? 'embedding-score-unavailable-v1',
      scoreSource: providedScore !== null
        ? 'provided-input'
        : storedEvidence ? 'stored-embedding-evidence' : 'unavailable',
      score: embeddingScore,
      scoreKind: embeddingScore === null ? 'unavailable' : options.embeddingScoreKind ?? 'similarity',
      semanticEvidence: embeddingMode === 'semantic' && embeddingScore !== null,
      limitation: embeddingLimitation(embeddingMode, embeddingScore),
    },
    projection: {
      algorithm: 'UMAP',
      formulaVersion: UMAP_APPROXIMATE_DISTANCE_FORMULA_VERSION,
      approximate: true,
      distance: Math.hypot(origin.x - target.x, origin.y - target.y),
      limitation: '二维 UMAP 距离是近似投影距离，不可替代原始 embedding 分数。',
    },
    taxonomy: sharedTaxonomy,
    tags: { sharedTags },
    wikiLink: { explicit: wikiLinks.length > 0, links: wikiLinks },
  }
}

export const buildNeighborEvidence = buildNoteNeighborEvidence

export function buildPeakEvidence(
  project: TerrainProject,
  peakOrId: TerrainPeak | string,
  options: PeakEvidenceOptions = {},
): PeakEvidence | undefined {
  const peak = typeof peakOrId === 'string'
    ? project.peaks.find((candidate) => candidate.id === peakOrId)
    : peakOrId
  if (!peak) return undefined
  const profile = activeProfile(project, options.profileId)
  const requestedEvaluatedAt = normalizeOptionalTimestamp(options.evaluatedAt)
  const evaluatedAt = profile.elevation === 'activity'
    ? requestedEvaluatedAt ?? normalizeTimestamp(project.updatedAt)
    : requestedEvaluatedAt
  const notesById = new Map(project.notes.map((note) => [note.id, note]))
  const members = peak.noteIds
    .flatMap((itemId) => {
      const note = notesById.get(itemId)
      return note ? [{ note, distance: Math.hypot(note.x - peak.x, note.y - peak.y) }] : []
    })
    .sort((a, b) => a.distance - b.distance || a.note.id.localeCompare(b.note.id))
  const memberIds = members.map(({ note }) => note.id)
  const missingMemberIds = unique(peak.noteIds.filter((itemId) => !notesById.has(itemId))).sort()
  const labelEvidence = peakLabelEvidence(peak, members.map(({ note }) => note))
  const activeInputs = members.map(({ note }) => activeHeightInput(project, note, profile, evaluatedAt))
  return {
    schemaVersion: TERRAIN_EVIDENCE_SCHEMA_VERSION,
    kind: 'peak',
    formulaVersion: PEAK_EVIDENCE_FORMULA_VERSION,
    provenance: unique([
      'stored-terrain-output',
      'kernel-density',
      'terrain-profile',
      ...activeInputs.flatMap((input) => input.provenance),
    ]),
    supportingIds: unique([peak.id, ...memberIds]).sort(),
    ...(evaluatedAt ? { evaluatedAt } : {}),
    peak: { id: peak.id, label: peak.label, x: peak.x, y: peak.y, height: peak.height },
    memberItemIds: memberIds,
    missingMemberItemIds: missingMemberIds,
    labelEvidence,
    localDensity: {
      formulaVersion: PEAK_DENSITY_FORMULA_VERSION,
      basis: 'stored-peak-membership',
      contributions: members.map(({ note, distance }) => ({
        itemId: note.id,
        noteWeight: note.weight,
        projectedDistance: distance,
      })),
      limitation: '当前项目仅保存峰成员与最终高度；精确 Gaussian kernel 带宽及逐像素贡献未持久化。',
    },
    activeHeight: {
      profileId: profile.id,
      elevation: profile.elevation,
      formulaVersion: profile.formulaVersion,
      missingInputBehavior: missingInputBehavior(profile.elevation),
      inputs: activeInputs,
    },
  }
}

export function buildCollisionEvidence(
  collision: PlateCollision,
  evaluatedAt?: string | number | Date,
): CollisionEvidence {
  const timestamp = normalizeOptionalTimestamp(evaluatedAt)
  const bridges = [...collision.bridges].sort((a, b) => a.id.localeCompare(b.id))
  const wikiLinks = bridges.flatMap((bridge) => bridge.evidence.map((evidence) => ({
    id: evidence.relationId,
    bridgeId: bridge.id,
    fromItemId: evidence.fromId,
    toItemId: evidence.toId,
    fromArea: evidence.fromArea,
    toArea: evidence.toArea,
  })))
  return {
    schemaVersion: TERRAIN_EVIDENCE_SCHEMA_VERSION,
    kind: 'collision',
    formulaVersion: COLLISION_EVIDENCE_FORMULA_VERSION,
    provenance: ['declared-taxonomy', 'explicit-wikilink', 'umap-projection'],
    supportingIds: unique([
      collision.id,
      ...bridges.map((bridge) => bridge.id),
      ...wikiLinks.map((link) => link.id),
      ...wikiLinks.flatMap((link) => [link.fromItemId, link.toItemId]),
    ]).sort(),
    ...(timestamp ? { evaluatedAt: timestamp } : {}),
    collisionId: collision.id,
    plates: { firstArea: collision.firstArea, secondArea: collision.secondArea },
    summary: {
      relationCount: collision.relationCount,
      mode: collision.mode,
      direction: collision.direction,
      directionConfidence: collision.directionConfidence,
      directionFormulaVersion: COLLISION_DIRECTION_FORMULA_VERSION,
      strength: collision.strength,
      strengthFormulaVersion: COLLISION_STRENGTH_FORMULA_VERSION,
    },
    wikiLinks,
    projection: bridges.map((bridge) => ({
      bridgeId: bridge.id,
      approximate: true,
      formulaVersion: UMAP_APPROXIMATE_DISTANCE_FORMULA_VERSION,
      distance: bridge.distance,
    })),
    tags: bridges.map((bridge) => ({ bridgeId: bridge.id, sharedTags: [...bridge.sharedTags].sort() })),
    limitation: '碰撞存在性仅由显式 WikiLink 决定；二维距离与共享标签单独展示，不参与关系真实性判断。',
  }
}

export function buildGapEvidence(
  report: ReferenceGapReport,
  nodeId: string,
): GapEvidence {
  const gap = report.gaps.find((candidate) => candidate.nodeId === nodeId)
  const base = {
    schemaVersion: TERRAIN_EVIDENCE_SCHEMA_VERSION,
    kind: 'gap' as const,
    formulaVersion: report.formulaVersion,
    evaluatedAt: normalizeTimestamp(report.evaluatedAt),
    relativeToSelectedReference: report.enabled,
    limitation: '该值只描述项目语料相对所选参考图谱的覆盖，不代表用户能力；低活动本身不会创建缺口。',
  }
  if (!report.enabled) {
    return {
      ...base,
      provenance: [],
      supportingIds: [],
      enabled: false,
      reason: 'no-reference-atlas',
    }
  }
  if (!gap) {
    return {
      ...base,
      provenance: ['reference-atlas'],
      supportingIds: report.referenceAtlasId ? [report.referenceAtlasId] : [],
      enabled: false,
      reason: 'unknown-reference-node',
      referenceAtlasId: report.referenceAtlasId,
    }
  }
  return {
    ...base,
    provenance: unique([
      'reference-atlas',
      'declared-taxonomy',
      ...(gap.lastSupportingAt ? ['activity-history' as const] : []),
    ]),
    supportingIds: unique([
      ...(report.referenceAtlasId ? [report.referenceAtlasId] : []),
      gap.nodeId,
      ...gap.expectedNodeIds,
      ...gap.supportingItemIds,
    ]).sort(),
    enabled: true,
    referenceAtlasId: report.referenceAtlasId,
    node: {
      id: gap.nodeId,
      label: gap.label,
      state: gap.state,
      expectedWeight: gap.expectedWeight,
      gap: gap.gap,
      ocean: gap.ocean,
      expectedNodeIds: [...gap.expectedNodeIds],
      supportingItemIds: [...gap.supportingItemIds],
      ...(gap.lastSupportingAt ? { lastSupportingAt: gap.lastSupportingAt } : {}),
    },
  }
}

export const buildReferenceGapEvidence = buildGapEvidence

function legendEntry(
  kind: TerrainSemanticKind,
  label: string,
  formulaVersion: string,
  provenance: TerrainEvidenceProvenance[],
  supportingIds: string[],
  active: boolean,
  definition: string,
  limitation: string,
  evaluatedAt?: string,
): TerrainLegendEntry {
  return {
    schemaVersion: TERRAIN_EVIDENCE_SCHEMA_VERSION,
    kind,
    formulaVersion,
    provenance,
    supportingIds,
    label,
    definition,
    limitation,
    active,
    ...(evaluatedAt ? { evaluatedAt } : {}),
  }
}

function activeProfile(project: TerrainProject, requestedId?: string): TerrainProfile {
  return project.terrainProfiles.find((profile) => profile.id === (requestedId ?? project.activeTerrainProfileId))
    ?? terrainProfileById(requestedId ?? project.activeTerrainProfileId)
    ?? project.terrainProfiles[0]
    ?? {
      id: 'density',
      label: '知识密度',
      elevation: 'density',
      color: 'area',
      formulaVersion: PEAK_DENSITY_FORMULA_VERSION,
    }
}

function elevationProvenance(elevation: TerrainProfile['elevation']): TerrainEvidenceProvenance[] {
  if (elevation === 'density') return ['kernel-density']
  if (elevation === 'activity') return ['raw-event', 'retained-aggregate']
  if (elevation === 'structure') return ['explicit-prerequisite']
  return ['terrain-profile']
}

function elevationLimitation(elevation: TerrainProfile['elevation']): string {
  if (elevation === 'mastery') return '熟练度是显式自评；缺失值不从活动或空间位置推断。'
  if (elevation === 'exploration') return '探索度表示用户意图，不等于熟练度、学习成果或活动频率。'
  if (elevation === 'activity') return '活动海拔只编码带衰减的打开、编辑、复习记录，不代表掌握程度。'
  if (elevation === 'structure') return '结构高度只依据显式 WikiLink，不从空间接近推断关系。'
  return '知识密度表示局部 KDE 聚合，不代表重要性、真实性或掌握程度。'
}

function effectiveColorEncoding(
  dimension: VisualDimension | undefined,
  profile: TerrainProfile,
): {
  formulaVersion: string
  provenance: TerrainEvidenceProvenance[]
  definition: string
  timeSensitive: boolean
} {
  if (dimension === 'temperature') {
    return {
      formulaVersion: 'activity-temperature-v1',
      provenance: ['raw-event', 'retained-aggregate'],
      definition: '颜色表示近期打开、编辑与复习事件的衰减热度；海拔保持知识密度。',
      timeSensitive: true,
    }
  }
  if (dimension === 'density') {
    return {
      formulaVersion: 'density-height-shading-v1',
      provenance: ['kernel-density', 'stored-terrain-output'],
      definition: '颜色是中性的高度明暗，仅辅助读取知识密度地形。',
      timeSensitive: false,
    }
  }
  if (dimension === 'mastery' || dimension === 'exploration' || dimension === 'activity' || dimension === 'structure' || dimension === 'area') {
    return {
      formulaVersion: 'declared-taxonomy-area-color-v1',
      provenance: ['declared-taxonomy'],
      definition: '颜色表示用户声明并解析到版本化 taxonomy 的领域归属。',
      timeSensitive: false,
    }
  }
  if (profile.color === 'source-kind') {
    return {
      formulaVersion: 'source-kind-color-v1',
      provenance: ['source-metadata'],
      definition: '颜色表示来源类型。',
      timeSensitive: false,
    }
  }
  if (profile.color === 'trust') {
    return {
      formulaVersion: 'trust-color-v1',
      provenance: ['terrain-profile'],
      definition: '颜色表示当前 terrain profile 的 trust 通道。',
      timeSensitive: false,
    }
  }
  return {
    formulaVersion: 'declared-taxonomy-area-color-v1',
    provenance: ['declared-taxonomy'],
    definition: '颜色表示用户声明并解析到版本化 taxonomy 的领域归属。',
    timeSensitive: false,
  }
}

function timeSensitive(profile: TerrainProfile): boolean {
  return profile.elevation === 'activity' || profile.overlay === 'temperature' || profile.overlay === 'staleness'
}

function embeddingProvenance(mode: TerrainProject['embeddingMode']): TerrainEvidenceProvenance[] {
  if (mode === 'semantic') return ['embedding-model', 'umap-projection']
  if (mode === 'fallback') return ['deterministic-fallback', 'umap-projection']
  return ['demo-fixture', 'umap-projection']
}

function embeddingLimitation(mode: TerrainProject['embeddingMode'], score: number | null): string {
  if (mode === 'fallback') return '确定性回退不是语义 embedding，不能视为同等质量的语义相似证据。'
  if (mode === 'demo') return '演示布局是固定样本，不是模型推理结果。'
  if (score === null) return '项目未持久化原始 embedding neighbor score；二维距离不会被冒充为该分数。'
  return '原始 embedding 分数与二维 UMAP 投影距离是不同信号。'
}

function sharedTaxonomyEvidence(
  project: TerrainProject,
  origin: TerrainNote,
  target: TerrainNote,
): { sharedNodeIds: string[]; sharedLabels: string[] } {
  const originAreas = normalizedAreas(origin)
  const targetAreas = new Set(normalizedAreas(target))
  const sharedLabels = unique(originAreas.filter((area) => targetAreas.has(area))).sort()
  const nodeIdsByLabel = new Map<string, string>()
  for (const node of project.taxonomyNodes ?? []) {
    for (const label of [node.label, ...node.aliases]) {
      const normalized = normalizeArea(label)
      if (normalized && !nodeIdsByLabel.has(normalized)) nodeIdsByLabel.set(normalized, node.id)
    }
  }
  return {
    sharedNodeIds: unique(sharedLabels.flatMap((label) => {
      const id = nodeIdsByLabel.get(label)
      return id ? [id] : []
    })).sort(),
    sharedLabels,
  }
}

function normalizedAreas(note: TerrainNote): string[] {
  return areasForNote(note).flatMap((area) => {
    const normalized = normalizeArea(area)
    return normalized ? [normalized] : []
  })
}

function sharedTagsOf(origin: TerrainNote, target: TerrainNote): string[] {
  const targetTags = new Set(target.tags.map((tag) => tag.normalize('NFKC').trim().toLocaleLowerCase()))
  return unique(origin.tags
    .map((tag) => tag.normalize('NFKC').trim().toLocaleLowerCase())
    .filter((tag) => tag && targetTags.has(tag)))
    .sort()
}

function wikiLinksBetween(origin: TerrainNote, target: TerrainNote): TerrainNeighborEvidence['wikiLink']['links'] {
  const links: TerrainNeighborEvidence['wikiLink']['links'] = []
  for (const [from, to] of [[origin, target], [target, origin]] as const) {
    for (const declaredTarget of from.links) {
      if (!noteMatchesLink(to, declaredTarget)) continue
      links.push({
        id: `wikilink:${from.id}->${to.id}:${normalizeRelationKey(declaredTarget)}`,
        fromItemId: from.id,
        toItemId: to.id,
        declaredTarget,
      })
    }
  }
  return links.sort((a, b) => a.id.localeCompare(b.id) || a.declaredTarget.localeCompare(b.declaredTarget))
}

function noteMatchesLink(note: TerrainNote, link: string): boolean {
  const target = normalizeRelationKey(link)
  return [note.title, note.sourcePath, note.sourcePath?.split('/').at(-1)]
    .some((candidate) => candidate !== undefined && normalizeRelationKey(candidate) === target)
}

function normalizeRelationKey(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\.md$/i, '').replace(/^\.\//, '').toLocaleLowerCase()
}

function peakLabelEvidence(
  peak: TerrainPeak,
  members: TerrainNote[],
): PeakEvidence['labelEvidence'] {
  const tagCounts = new Map<string, { label: string; count: number; itemIds: string[] }>()
  for (const note of members) {
    for (const tag of note.tags) {
      const key = tag.normalize('NFKC').trim().toLocaleLowerCase()
      if (!key) continue
      const current = tagCounts.get(key) ?? { label: tag, count: 0, itemIds: [] }
      current.count += 1
      current.itemIds.push(note.id)
      tagCounts.set(key, current)
    }
  }
  const dominant = [...tagCounts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))[0]
  if (dominant && dominant.label === peak.label) {
    return {
      source: 'dominant-tag',
      label: peak.label,
      supportingItemIds: unique(dominant.itemIds).sort(),
      tagCount: dominant.count,
    }
  }
  const titleNote = members.find((note) => note.title.slice(0, 8) === peak.label)
  if (titleNote) {
    return {
      source: 'nearest-note-title',
      label: peak.label,
      supportingItemIds: [titleNote.id],
    }
  }
  return {
    source: 'stored-label',
    label: peak.label,
    supportingItemIds: members.map((note) => note.id).sort(),
  }
}

function activeHeightInput(
  project: TerrainProject,
  note: TerrainNote,
  profile: TerrainProfile,
  evaluatedAt: string | undefined,
): PeakEvidence['activeHeight']['inputs'][number] {
  if (profile.elevation === 'density') {
    return inputEvidence(note.id, note.weight, null, ['kernel-density'], [note.id])
  }
  if (profile.elevation === 'mastery') {
    const value = note.mastery
    const confidence = note.confidence ?? (value === undefined ? undefined : 0.5)
    return inputEvidence(note.id, value, confidence, cognitiveProvenance(note.cognitiveStateProvenance), [note.id])
  }
  if (profile.elevation === 'exploration') {
    return inputEvidence(note.id, note.exploration, null, cognitiveProvenance(note.cognitiveStateProvenance), [note.id])
  }
  if (profile.elevation === 'activity') {
    const result = calculateActivityElevation({
      itemId: note.id,
      events: project.interactionEvents,
      aggregates: project.activityHistory?.aggregates,
      evaluatedAt: evaluatedAt ?? project.updatedAt,
    })
    const provenance = unique(result.evidence.flatMap((evidence) => evidence.provenance))
    return inputEvidence(
      note.id,
      result.historyState === 'missing' ? undefined : result.score,
      null,
      provenance,
      [...result.rawEventIds, ...result.aggregateIds],
    )
  }
  const linkedIds = explicitLinkedItemIds(project.notes, note)
  return inputEvidence(note.id, linkedIds.length, null, ['explicit-wikilink'], [note.id, ...linkedIds])
}

function inputEvidence(
  itemId: string,
  value: number | undefined,
  confidence: number | null | undefined,
  provenance: TerrainEvidenceProvenance[],
  supportingIds: string[],
): PeakEvidence['activeHeight']['inputs'][number] {
  const normalizedValue = finiteOrNull(value)
  return {
    itemId,
    value: normalizedValue,
    confidence: finiteOrNull(confidence),
    missing: normalizedValue === null,
    provenance,
    supportingIds: unique(supportingIds).sort(),
  }
}

function cognitiveProvenance(value: CognitiveStateProvenance | undefined): TerrainEvidenceProvenance[] {
  if (value === 'yaml') return ['cognitive-state-yaml']
  if (value === 'app') return ['cognitive-state-app']
  if (value === 'migration') return ['cognitive-state-migration']
  return []
}

function missingInputBehavior(elevation: TerrainProfile['elevation']): string {
  if (elevation === 'mastery') return '未评估 mastery 的笔记不贡献高度分子；已评估但缺 confidence 时使用 0.5。'
  if (elevation === 'exploration') return '未标注 exploration intent 的笔记不贡献高度分子。'
  if (elevation === 'activity') return '没有有效活动历史的笔记不贡献活动高度；不会回退为 mastery。'
  if (elevation === 'structure') return '没有可解析 WikiLink 的笔记结构输入为 0。'
  return 'density 使用每条笔记已归一化的 weight；不读取 mastery、activity 或 exploration。'
}

function explicitLinkedItemIds(notes: TerrainNote[], origin: TerrainNote): string[] {
  const ids: string[] = []
  for (const target of notes) {
    if (target.id === origin.id) continue
    if (wikiLinksBetween(origin, target).length) ids.push(target.id)
  }
  return unique(ids).sort()
}

function normalizeOptionalTimestamp(value: string | number | Date | undefined): string | undefined {
  return value === undefined ? undefined : normalizeTimestamp(value)
}

function normalizeTimestamp(value: string | number | Date): string {
  const parsed = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(parsed)) throw new RangeError(`Invalid evidence timestamp: ${String(value)}`)
  return new Date(parsed).toISOString()
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) ? value : null
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}
