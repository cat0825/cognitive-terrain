import { ACTIVITY_ELEVATION_FORMULA_VERSION } from './activity-elevation'
import { ACTIVITY_TEMPERATURE_FORMULA_VERSION } from './activity-temperature'
import { DENSITY_FORMULA_VERSION } from './derived-data'
import { AREA_COLOR_FORMULA_VERSION } from './knowledge-plates'
import { STABLE_LAYOUT_FORMULA_VERSION } from './layout-version'
import { DEFAULT_LEARNING_PROGRESSION_PROFILE_VERSION } from './learning-progression'
import { PREREQUISITE_FORMULA_VERSION } from './prerequisite-topology'
import { REFERENCE_GAP_FORMULA_VERSION } from './reference-gaps'
import { DEFAULT_TERRAIN_PROFILES } from './terrain-profile'
import {
  COLLISION_EVIDENCE_FORMULA_VERSION,
  DENSITY_SHADING_FORMULA_VERSION,
  PEAK_EVIDENCE_FORMULA_VERSION,
  PLANAR_POSITION_FORMULA_VERSION,
  PLATE_FORMULA_VERSION,
  type TerrainSemanticKind,
} from './terrain-evidence'
import type { VisualDimension } from './types'

export const VISUAL_CONTRACT_VERSION = 'visual-dimension-contract-v1' as const

/**
 * Which visual channel a row occupies.
 *
 * The separation is the point: a dimension that owns `elevation` must leave
 * `color` alone, and a dimension that owns `color` must leave the height field
 * as knowledge density. Encoding the same signal twice makes the map look like
 * it has more evidence than it does.
 */
export type VisualChannel = 'planar-position' | 'elevation' | 'color' | 'overlay'

/**
 * When the row's value is a function of the moment it was evaluated.
 *
 * - `declared`: only user-declared data; the same project always yields the same value.
 * - `structural`: derived from explicit relations; no clock involved.
 * - `evaluation-time`: needs an explicit evaluation timestamp, taken from
 *   `evaluationTimeForProject(project.updatedAt)` so recorded activity is never
 *   treated as future-dated.
 */
export type VisualTimeSemantics = 'declared' | 'structural' | 'evaluation-time'

export interface VisualContractRow {
  /** Legend entry this row is proven against, or null for shared channels without one. */
  legendKind: TerrainSemanticKind
  label: string
  channel: VisualChannel
  /** Channel this row deliberately leaves untouched, and what stays there. */
  channelsLeftIntact: string
  /** Core fields the value is read from. Never derived from layout coordinates. */
  sourceFields: readonly string[]
  formulaVersion: string
  timeSemantics: VisualTimeSemantics
  /** What invalidates or freezes the value across versions. */
  versionSemantics: string
  /** What happens when the source field is absent. Never an inferred substitute. */
  missingValue: string
  /** How the value is reproduced from core data. */
  reproducibility: string
  /** Tests that prove the reproducibility and missing-value rules. */
  tests: readonly string[]
}

const NO_INFERENCE_FROM_POSITION =
  '不从二维布局坐标、embedding 距离或活动事件反推该值。'

/**
 * The eight shipped visual dimensions.
 *
 * A `Record` rather than an array so adding a `VisualDimension` without a
 * contract row is a type error, not a silent gap.
 */
export const VISUAL_DIMENSION_CONTRACT: Readonly<Record<VisualDimension, VisualContractRow>> = {
  density: {
    legendKind: 'elevation',
    label: '知识密度',
    channel: 'elevation',
    channelsLeftIntact: `颜色为中性高度明暗（${DENSITY_SHADING_FORMULA_VERSION}），不承载 taxonomy 或活动语义。`,
    sourceFields: ['notes[].x', 'notes[].y', 'notes[].weight', 'notes[].createdAt'],
    formulaVersion: DENSITY_FORMULA_VERSION,
    timeSemantics: 'declared',
    versionSemantics: `随 ${DENSITY_FORMULA_VERSION} 与布局 ${STABLE_LAYOUT_FORMULA_VERSION} 变化；两者都记入 ProjectVersionTuple。`,
    missingValue: `使用导入时归一化的 weight；不读取 mastery、activity 或 exploration。${NO_INFERENCE_FROM_POSITION}`,
    reproducibility: 'rebuildProjectDerivedData 用 core 笔记加 gridSize/bandwidth/timeZone 复算快照与峰，逐值比较。',
    tests: ['tests/unit/terrain.test.ts', 'tests/unit/derived-data.test.ts'],
  },
  mastery: {
    legendKind: 'elevation',
    label: '熟练度',
    channel: 'elevation',
    channelsLeftIntact: `颜色仍是声明领域（${AREA_COLOR_FORMULA_VERSION}），平面坐标不动。`,
    sourceFields: ['notes[].mastery', 'notes[].confidence', 'notes[].cognitiveStateProvenance'],
    formulaVersion: profileFormulaVersion('mastery'),
    timeSemantics: 'declared',
    versionSemantics: '熟练度是显式自评状态，不随时间衰减；只有显式选择版本化衰减 profile 才改变。',
    missingValue: `未评估 mastery 的笔记不贡献高度分子；已评估但缺 confidence 时使用 0.5。${NO_INFERENCE_FROM_POSITION}`,
    reproducibility: '同一批 cognitiveStates 与 observations 复算得到同一高度；打开或编辑事件不会改变结果。',
    tests: ['tests/unit/terrain.test.ts', 'tests/unit/cognitive-state.test.ts'],
  },
  exploration: {
    legendKind: 'elevation',
    label: '探索度',
    channel: 'elevation',
    channelsLeftIntact: `颜色仍是声明领域（${AREA_COLOR_FORMULA_VERSION}），平面坐标不动。`,
    sourceFields: ['notes[].exploration', 'notes[].cognitiveStateProvenance'],
    formulaVersion: profileFormulaVersion('exploration'),
    timeSemantics: 'declared',
    versionSemantics: '探索度表示用户意图，与熟练度分开版本化，不互相回退。',
    missingValue: `未标注 exploration intent 的笔记不贡献高度分子。${NO_INFERENCE_FROM_POSITION}`,
    reproducibility: '纯声明输入，复算即等值。',
    tests: ['tests/unit/terrain.test.ts', 'tests/unit/exploration-loop.test.ts'],
  },
  activity: {
    legendKind: 'elevation',
    label: '近期活跃',
    channel: 'elevation',
    channelsLeftIntact: '颜色仍是声明领域；温度颜色只在 temperature 维度启用。',
    sourceFields: ['interactionEvents[]', 'activityHistory.aggregates[]', 'timeZone'],
    formulaVersion: ACTIVITY_ELEVATION_FORMULA_VERSION,
    timeSemantics: 'evaluation-time',
    versionSemantics: `传入的 formulaVersion 与 ${ACTIVITY_ELEVATION_FORMULA_VERSION} 不符时直接拒绝，不做静默换算。`,
    missingValue: '没有有效活动历史的笔记不贡献活动高度，不回退为 mastery；未来时间戳与超过时钟偏移容差的输入一律忽略。',
    reproducibility: '固定 evaluatedAt 后结果确定：同一事件集合与聚合复算得到同一 rawHeat 与 score。',
    tests: [
      'tests/unit/activity-elevation.test.ts',
      'tests/unit/future-activity.test.ts',
      'tests/unit/activity-history.test.ts',
    ],
  },
  progression: {
    legendKind: 'elevation',
    label: '学习进程',
    channel: 'elevation',
    channelsLeftIntact: `颜色仍是声明领域（${AREA_COLOR_FORMULA_VERSION}），平面坐标不动。`,
    sourceFields: ['cognitiveObservations[]', 'learningProgressionProfileVersion', 'timeZone'],
    formulaVersion: DEFAULT_LEARNING_PROGRESSION_PROFILE_VERSION,
    timeSemantics: 'evaluation-time',
    versionSemantics: '只有显式选择版本化衰减 profile 才随时间改变；默认 profile 不衰减。',
    missingValue: '没有显式认知观测时使用中性海拔并标记高不确定性；不从活动事件补造历史，旧项目不补造快照。',
    reproducibility: '重放同一组带时区观测得到同一 elevation 与 uncertainty；等价瞬时会被规范化。',
    tests: ['tests/unit/learning-progression.test.ts', 'tests/unit/terrain.test.ts'],
  },
  structure: {
    legendKind: 'elevation',
    label: '基础层级',
    channel: 'elevation',
    channelsLeftIntact: '颜色仍是声明领域；叠加层交给参考缺口。',
    sourceFields: ['notes[].prerequisites', 'notes[].buildsOn', 'prerequisiteTopology'],
    formulaVersion: profileFormulaVersion('structure'),
    timeSemantics: 'structural',
    versionSemantics: `拓扑由 ${PREREQUISITE_FORMULA_VERSION} 产出并记入 ProjectVersionTuple；关系集合不变则层级不变。`,
    missingValue: '没有可解析 prerequisite/buildsOn 的笔记结构输入为 0；循环、自指、歧义与未解析目标被排除并记录诊断。',
    reproducibility: 'buildPrerequisiteTopology 从声明关系重算，不信任持久化拓扑。',
    tests: ['tests/unit/prerequisite-topology.test.ts', 'tests/unit/derived-data.test.ts'],
  },
  temperature: {
    legendKind: 'color',
    label: '活动温度',
    channel: 'color',
    channelsLeftIntact: '海拔保持知识密度，平面坐标不动。',
    sourceFields: ['interactionEvents[]', 'activityHistory.aggregates[]'],
    formulaVersion: ACTIVITY_TEMPERATURE_FORMULA_VERSION,
    timeSemantics: 'evaluation-time',
    versionSemantics: '与 activity 海拔共用衰减模型但独立版本化；改动任一方都要单独升版。',
    missingValue: '无活动的笔记为冷色 score 0，不代表缺口，也不降低熟练度。',
    reproducibility: '固定评估时间后颜色确定；未来事件不参与热度。',
    tests: ['tests/unit/cognitive-state.test.ts', 'tests/unit/future-activity.test.ts'],
  },
  area: {
    legendKind: 'color',
    label: '领域',
    channel: 'color',
    channelsLeftIntact: '海拔保持知识密度；跨域山脊只来自可追溯 WikiLink。',
    sourceFields: ['notes[].area', 'notes[].areas', 'taxonomyNodes[]', 'taxonomyVersion'],
    formulaVersion: AREA_COLOR_FORMULA_VERSION,
    timeSemantics: 'declared',
    versionSemantics: '归属解析到版本化 taxonomy node；重命名与重挂改变标签但不改变 node ID 与成员。',
    missingValue: `未声明领域的笔记使用中性灰，不由 embedding 聚类推断领域。${NO_INFERENCE_FROM_POSITION}`,
    reproducibility: 'normalizeArea 与 taxonomy 解析确定；同一声明得到同一板块 ID 与颜色。',
    tests: ['tests/unit/knowledge-plates.test.ts', 'tests/unit/taxonomy.test.ts'],
  },
}

/**
 * Channels shared by every dimension.
 *
 * They are not selectable, so they cannot be covered by the dimension table,
 * but they carry semantics that the admission gate still has to pin down.
 */
export const SHARED_CHANNEL_CONTRACT: readonly VisualContractRow[] = [
  {
    legendKind: 'planar-position',
    label: '平面位置',
    channel: 'planar-position',
    channelsLeftIntact: '认知状态只能改变海拔，不能移动坐标。',
    sourceFields: ['notes[].content', 'notes[].x', 'notes[].y', 'modelId', 'embeddingMode'],
    formulaVersion: PLANAR_POSITION_FORMULA_VERSION,
    timeSemantics: 'declared',
    versionSemantics: `布局版本 ${STABLE_LAYOUT_FORMULA_VERSION} 与 embedding model/mode 一同记入 ProjectVersionTuple。`,
    missingValue: '模型不可用时切换为确定性回退并在界面标注降级，不冒充语义向量。',
    reproducibility: '同一模型与同一文本得到同一坐标；二维距离不被当作原始 embedding 分数。',
    tests: ['tests/unit/layout.test.ts', 'tests/unit/neighbors.test.ts'],
  },
  {
    legendKind: 'peak',
    label: '山峰',
    channel: 'elevation',
    channelsLeftIntact: '峰名只是标签摘要，不改变板块或领域颜色。',
    sourceFields: ['snapshots[].values', 'peaks[].noteIds', 'notes[].tags', 'notes[].title'],
    formulaVersion: PEAK_EVIDENCE_FORMULA_VERSION,
    timeSemantics: 'declared',
    versionSemantics: 'demo 地形的 authored 峰不被密度复算替换；derived 峰随密度公式升版重算。',
    missingValue: '成员笔记缺失时列入 missingMemberItemIds，不静默补齐。',
    reproducibility: 'detectPeaks 用同一 bandwidth 与栅格复算；ProjectDerivedRecord 记录 peaks 来源。',
    tests: ['tests/unit/derived-data.test.ts', 'tests/unit/peak-label-layout.test.ts'],
  },
  {
    legendKind: 'plate',
    label: '知识板块',
    channel: 'color',
    channelsLeftIntact: '板块不改变海拔，也不生成缺口。',
    sourceFields: ['notes[].area', 'notes[].areas', 'taxonomyNodes[]'],
    formulaVersion: PLATE_FORMULA_VERSION,
    timeSemantics: 'declared',
    versionSemantics: 'taxonomy 版本决定标签解析；自动聚类只能作为建议，不能成为板块。',
    missingValue: '未归类笔记进入维护队列，不被分配到任何板块。',
    reproducibility: 'summarizeKnowledgePlates 对同一声明集合输出同一板块与成员。',
    tests: ['tests/unit/knowledge-plates.test.ts', 'tests/unit/taxonomy.test.ts'],
  },
  {
    legendKind: 'collision',
    label: '板块碰撞',
    channel: 'overlay',
    channelsLeftIntact: '碰撞不改变海拔与领域颜色。',
    sourceFields: ['notes[].links', 'notes[].area', 'notes[].areas'],
    formulaVersion: COLLISION_EVIDENCE_FORMULA_VERSION,
    timeSemantics: 'structural',
    versionSemantics: '存在性、方向与强度分别版本化；方向需要至少 2 组唯一关系且置信度达 60%。',
    missingValue: '空间接近、共享标签或 embedding 相似度单独不能生成碰撞；歧义标题不解析。',
    reproducibility: 'buildPlateCollisions 对同一显式 WikiLink 集合确定输出。',
    tests: ['tests/unit/knowledge-plates.test.ts', 'tests/unit/terrain-evidence.test.ts'],
  },
  {
    legendKind: 'gap',
    label: '海洋 / 知识缺口',
    channel: 'overlay',
    channelsLeftIntact: '海洋只承载参考缺口；不改变海拔、颜色或平面坐标。',
    sourceFields: ['referenceAtlases[].taxonomySnapshot', 'activeReferenceAtlasId', 'notes[].area', 'notes[].areas'],
    formulaVersion: REFERENCE_GAP_FORMULA_VERSION,
    timeSemantics: 'evaluation-time',
    versionSemantics: 'atlas 绑定不可变 taxonomy 快照；taxonomy 变化后 legacy atlas 禁用并要求显式重绑。',
    missingValue: '未选择有效 atlas 时缺口计算 disabled，不输出用户能力或无知判断；低活动不等于缺口。',
    reproducibility: '固定 evaluatedAt 与快照后覆盖率确定；重命名、重挂、合并不改变历史报告。',
    tests: ['tests/unit/reference-gaps.test.ts', 'tests/unit/terrain-evidence.test.ts'],
  },
]

/**
 * Constraints a new visual channel has to satisfy before it ships.
 *
 * These are the channel-separation rules from the icebox proposal, written as
 * assertions instead of prose so a new dimension cannot quietly overload a
 * channel that already means something else.
 */
export const CHANNEL_SEPARATION_RULES: readonly string[] = [
  '颜色只承载 taxonomy 归属或来源类型，不承载认知状态强弱。',
  '渐变只承载显式声明的层级，不承载推断出的重要性。',
  '海洋只承载相对显式 atlas 的参考缺口，不承载低活动或低熟练度。',
  '活动信号只叠加，不改写基础语义：不得覆盖 mastery、exploration 或结构层级。',
  'embedding 位置只表示布局邻近，永不表示能力、掌握度或先修顺序。',
  '同一指标不得同时编码到海拔与颜色。',
]

export interface VisualContractFinding {
  row: string
  problem: string
}

/**
 * Admission gate for the visual layer.
 *
 * Returns every under-specified row instead of throwing, so the gate can report
 * all gaps in one run. An empty result is the precondition for adding a new
 * visual channel.
 */
export function evaluateVisualContract(): VisualContractFinding[] {
  const findings: VisualContractFinding[] = []
  const rows: Array<[string, VisualContractRow]> = [
    ...Object.entries(VISUAL_DIMENSION_CONTRACT),
    ...SHARED_CHANNEL_CONTRACT.map((row) => [row.legendKind, row] as [string, VisualContractRow]),
  ]
  for (const [name, row] of rows) {
    const prose: Array<[string, string]> = [
      ['label', row.label],
      ['channelsLeftIntact', row.channelsLeftIntact],
      ['formulaVersion', row.formulaVersion],
      ['versionSemantics', row.versionSemantics],
      ['missingValue', row.missingValue],
      ['reproducibility', row.reproducibility],
    ]
    for (const [field, value] of prose) {
      if (!value.trim()) findings.push({ row: name, problem: `${field} 为空` })
    }
    if (!row.sourceFields.length) findings.push({ row: name, problem: 'sourceFields 为空' })
    if (!row.tests.length) findings.push({ row: name, problem: '没有链接证明可复现的测试' })
  }
  return findings
}

function profileFormulaVersion(id: string): string {
  const profile = DEFAULT_TERRAIN_PROFILES.find((candidate) => candidate.id === id)
  if (!profile) throw new Error(`Unknown terrain profile for contract row: ${id}`)
  return profile.formulaVersion
}
