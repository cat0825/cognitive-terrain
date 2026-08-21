import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ACTIVITY_ELEVATION_FORMULA_VERSION } from '../../src/domain/activity-elevation'
import { ACTIVITY_TEMPERATURE_FORMULA_VERSION } from '../../src/domain/activity-temperature'
import { AREA_COLOR_FORMULA_VERSION } from '../../src/domain/knowledge-plates'
import { REFERENCE_GAP_FORMULA_VERSION } from '../../src/domain/reference-gaps'
import { DEFAULT_TERRAIN_PROFILES } from '../../src/domain/terrain-profile'
import { buildTerrainSemanticsLegend } from '../../src/domain/terrain-evidence'
import {
  CHANNEL_SEPARATION_RULES,
  SHARED_CHANNEL_CONTRACT,
  VISUAL_DIMENSION_CONTRACT,
  evaluateVisualContract,
} from '../../src/domain/visual-contract'
import type { VisualDimension } from '../../src/domain/types'
import { projectFixture } from '../helpers/visual-contract-fixture'

const SHIPPED_DIMENSIONS: VisualDimension[] = [
  'density',
  'mastery',
  'exploration',
  'activity',
  'progression',
  'structure',
  'temperature',
  'area',
]

describe('visual dimension contract', () => {
  it('covers every shipped dimension with no blank fields', () => {
    expect(Object.keys(VISUAL_DIMENSION_CONTRACT).sort()).toEqual([...SHIPPED_DIMENSIONS].sort())
    expect(evaluateVisualContract()).toEqual([])
  })

  it('covers every dimension the UI can select', () => {
    const panel = readFileSync('src/ui/FilterPanel.tsx', 'utf8')
    const offered = panel.match(/\(\[(?:'[a-z]+', )+'[a-z]+'\] as VisualDimension\[\]\)/)
    expect(offered).not.toBeNull()
    const dimensions = [...(offered?.[0] ?? '').matchAll(/'([a-z]+)'/g)].map((match) => match[1])
    expect(dimensions.sort()).toEqual([...SHIPPED_DIMENSIONS].sort())
    for (const dimension of dimensions) {
      expect(VISUAL_DIMENSION_CONTRACT[dimension as VisualDimension]).toBeDefined()
    }
  })

  it('states the type of the VisualDimension union so a new channel must add a row', () => {
    const types = readFileSync('src/domain/types.ts', 'utf8')
    const union = types.match(/export type VisualDimension = ([^\n]+)/)
    expect(union).not.toBeNull()
    const declared = [...(union?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((match) => match[1])
    expect(declared.sort()).toEqual([...SHIPPED_DIMENSIONS].sort())
  })

  it('reuses the formula version each module owns instead of restating a literal', () => {
    expect(VISUAL_DIMENSION_CONTRACT.activity.formulaVersion).toBe(ACTIVITY_ELEVATION_FORMULA_VERSION)
    expect(VISUAL_DIMENSION_CONTRACT.temperature.formulaVersion).toBe(ACTIVITY_TEMPERATURE_FORMULA_VERSION)
    expect(VISUAL_DIMENSION_CONTRACT.area.formulaVersion).toBe(AREA_COLOR_FORMULA_VERSION)
    for (const profile of DEFAULT_TERRAIN_PROFILES) {
      expect(VISUAL_DIMENSION_CONTRACT[profile.id as VisualDimension].formulaVersion).toBe(profile.formulaVersion)
    }
    expect(SHARED_CHANNEL_CONTRACT.find((row) => row.legendKind === 'gap')?.formulaVersion)
      .toBe(REFERENCE_GAP_FORMULA_VERSION)
  })

  it('links a real test file for every row', () => {
    const rows = [...Object.entries(VISUAL_DIMENSION_CONTRACT), ...SHARED_CHANNEL_CONTRACT.map((row) => [row.legendKind, row] as const)]
    for (const [name, row] of rows) {
      for (const path of row.tests) {
        expect(existsSync(path), `${String(name)} 引用了不存在的测试 ${path}`).toBe(true)
      }
    }
  })

  it('agrees with the legend on the formula version actually rendered', () => {
    const project = projectFixture()
    for (const dimension of SHIPPED_DIMENSIONS) {
      const legend = buildTerrainSemanticsLegend(project, {
        visualDimension: dimension,
        evaluatedAt: '2026-08-21T00:00:00.000Z',
      })
      const row = VISUAL_DIMENSION_CONTRACT[dimension]
      const entry = legend.entries.find((candidate) => candidate.kind === row.legendKind)
      expect(entry?.formulaVersion, `${dimension} 的契约版本与图例不一致`).toBe(row.formulaVersion)
    }
  })

  it('keeps elevation and color channels separate for every dimension', () => {
    for (const [dimension, row] of Object.entries(VISUAL_DIMENSION_CONTRACT)) {
      if (row.channel === 'elevation') {
        expect(row.channelsLeftIntact, `${dimension} 未声明颜色通道保持什么`).toMatch(/颜色/)
      }
      if (row.channel === 'color') {
        expect(row.channelsLeftIntact, `${dimension} 未声明海拔通道保持什么`).toMatch(/海拔/)
      }
    }
    const elevationVersions = Object.values(VISUAL_DIMENSION_CONTRACT)
      .filter((row) => row.channel === 'elevation')
      .map((row) => row.formulaVersion)
    const colorVersions = Object.values(VISUAL_DIMENSION_CONTRACT)
      .filter((row) => row.channel === 'color')
      .map((row) => row.formulaVersion)
    expect(elevationVersions.filter((version) => colorVersions.includes(version))).toEqual([])
  })

  it('never sources a value from layout coordinates or embedding distance', () => {
    for (const [dimension, row] of Object.entries(VISUAL_DIMENSION_CONTRACT)) {
      if (dimension === 'density') continue
      for (const field of row.sourceFields) {
        expect(field, `${dimension} 从布局坐标取值`).not.toMatch(/^notes\[\]\.(x|y)$/)
      }
    }
  })

  it('requires an explicit evaluation time for every time-sensitive row', () => {
    const timeSensitive = ['activity', 'progression', 'temperature'] as const
    for (const dimension of timeSensitive) {
      expect(VISUAL_DIMENSION_CONTRACT[dimension].timeSemantics).toBe('evaluation-time')
    }
    expect(VISUAL_DIMENSION_CONTRACT.mastery.timeSemantics).toBe('declared')
    expect(VISUAL_DIMENSION_CONTRACT.structure.timeSemantics).toBe('structural')
  })

  it('documents the admission rule where a contributor will see it', () => {
    const adr = readFileSync('docs/adr/006-visual-dimension-contract.md', 'utf8')
    for (const rule of CHANNEL_SEPARATION_RULES) {
      expect(adr, `ADR 缺少通道约束：${rule}`).toContain(rule)
    }
    for (const dimension of SHIPPED_DIMENSIONS) {
      expect(adr).toContain(VISUAL_DIMENSION_CONTRACT[dimension].formulaVersion)
    }
    const template = readFileSync('.github/pull_request_template.md', 'utf8')
    expect(template).toContain('docs/adr/006-visual-dimension-contract.md')
    expect(template).toMatch(/视觉维度准入/)
  })
})
