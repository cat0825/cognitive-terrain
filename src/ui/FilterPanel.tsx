import { Check, RotateCcw, X } from 'lucide-react'
import { useMemo } from 'react'
import { buildPlateCollisions, normalizeArea, summarizeKnowledgePlates } from '../domain/knowledge-plates'
import { buildActivitySummaries, TEMPERATURE_COLORS } from '../domain/activity-temperature'
import { projectTagCounts } from '../domain/project-view'
import type { QualityLevel, VisualDimension } from '../domain/types'
import { useAppStore } from '../store/app-store'

export function FilterPanel() {
  const project = useAppStore((state) => state.project)
  const activeTags = useAppStore((state) => state.activeTags)
  const activeAreas = useAppStore((state) => state.activeAreas)
  const quality = useAppStore((state) => state.quality)
  const visualDimension = useAppStore((state) => state.visualDimension)
  const filtersOpen = useAppStore((state) => state.filtersOpen)
  const toggleTag = useAppStore((state) => state.toggleTag)
  const clearTags = useAppStore((state) => state.clearTags)
  const toggleArea = useAppStore((state) => state.toggleArea)
  const clearAreas = useAppStore((state) => state.clearAreas)
  const setQuality = useAppStore((state) => state.setQuality)
  const setVisualDimension = useAppStore((state) => state.setVisualDimension)
  const setFiltersOpen = useAppStore((state) => state.setFiltersOpen)
  const tags = projectTagCounts(project).slice(0, 18)
  const plates = useMemo(() => summarizeKnowledgePlates(project.notes), [project.notes])
  const collisions = useMemo(() => buildPlateCollisions(project.notes), [project.notes])
  const bridgeCount = collisions.reduce((sum, collision) => sum + collision.relationCount, 0)
  const bandCount = collisions.filter((collision) => collision.mode === 'band').length
  const unassignedCount = useMemo(() => project.notes.filter((note) => !note.area && !note.areas?.length).length, [project.notes])
  const activitySummary = useMemo(() => {
    const summaries = [...buildActivitySummaries(project.notes, project.interactionEvents, Date.now(), project.activityHistory?.aggregates).values()]
    return summaries.reduce((result, summary) => ({
      activeNotes: result.activeNotes + (summary.totalCount > 0 ? 1 : 0),
      eventCount: result.eventCount + summary.totalCount,
      openedCount: result.openedCount + summary.openedCount,
      editedCount: result.editedCount + summary.editedCount,
      reviewedCount: result.reviewedCount + summary.reviewedCount,
    }), { activeNotes: 0, eventCount: 0, openedCount: 0, editedCount: 0, reviewedCount: 0 })
  }, [project.activityHistory?.aggregates, project.interactionEvents, project.notes])

  if (!filtersOpen) return null
  return (
    <aside className="filter-panel" aria-label="地图筛选">
      <header>
        <div>
          <span className="panel-kicker">VIEW PARAMETERS</span>
          <h2>地图筛选</h2>
        </div>
        <button type="button" className="icon-button" aria-label="关闭筛选" onClick={() => setFiltersOpen(false)}>
          <X size={17} />
        </button>
      </header>
      <section className="filter-section">
        <div className="filter-heading">
          <span>主题标签</span>
          {activeTags.length > 0 && (
            <button type="button" onClick={clearTags}>
              <RotateCcw size={13} />
              清除
            </button>
          )}
        </div>
        <div className="tag-filter-list">
          {tags.map(({ tag, count }) => {
            const checked = activeTags.includes(tag)
            return (
              <button
                type="button"
                className={checked ? 'checked' : ''}
                key={tag}
                onClick={() => toggleTag(tag)}
                aria-pressed={checked}
              >
                <span className="check-box">{checked && <Check size={12} />}</span>
                <span>{tag}</span>
                <small>{count}</small>
              </button>
            )
          })}
        </div>
      </section>
      <section className="filter-section">
        <span className="filter-heading">地形口径</span>
        <div className="visual-dimension-control">
          {(['density', 'mastery', 'exploration', 'temperature', 'area'] as VisualDimension[]).map((dimension) => (
            <button
              type="button"
              key={dimension}
              className={visualDimension === dimension ? 'active' : ''}
              onClick={() => setVisualDimension(dimension)}
              aria-pressed={visualDimension === dimension}
            >
              {dimensionLabel(dimension)}
            </button>
          ))}
        </div>
        <p className="dimension-help">{dimensionHelp(visualDimension)}</p>
        {visualDimension === 'temperature' && (
          <div className="temperature-legend" role="group" aria-label="知识温度图例">
            <div className="temperature-scale" aria-hidden="true">
              <span><i style={{ backgroundColor: TEMPERATURE_COLORS.cold }} />冷</span>
              <span><i style={{ backgroundColor: TEMPERATURE_COLORS.warm }} />温</span>
              <span><i style={{ backgroundColor: TEMPERATURE_COLORS.hot }} />热</span>
            </div>
            <p>{activitySummary.activeNotes} 条有活动 · {activitySummary.eventCount} 个事件</p>
            <small>打开 {activitySummary.openedCount} · 编辑 {activitySummary.editedCount} · 复习 {activitySummary.reviewedCount}</small>
          </div>
        )}
        {visualDimension === 'area' && (
          <div className="plate-legend" role="group" aria-label="知识板块图例">
            <div className="plate-legend-heading">
              <span>知识板块</span>
              {activeAreas.length > 0 && <button type="button" onClick={clearAreas}>显示全部</button>}
            </div>
            <div className="plate-legend-list">
              {plates.map((plate) => {
                const area = normalizeArea(plate.label) ?? plate.label
                const selected = activeAreas.includes(area)
                return (
                  <button
                    type="button"
                    key={plate.id}
                    className={selected ? 'is-active' : ''}
                    onClick={() => toggleArea(area)}
                    aria-pressed={selected}
                    title={`${plate.noteCount} 条笔记 · ${plate.crossLinkCount} 条跨板块 WikiLink`}
                  >
                    <span className="plate-swatch" style={{ backgroundColor: plate.color }} aria-hidden="true" />
                    <span>{plate.label}</span>
                    <small>{plate.noteCount}</small>
                  </button>
                )
              })}
            </div>
            <p className="plate-legend-summary">
              {plates.length} 个板块 · {bridgeCount} 条跨域 WikiLink · {bandCount} 个碰撞带
              {unassignedCount > 0 ? ` · ${unassignedCount} 条未分类` : ''}
            </p>
          </div>
        )}
      </section>
      <section className="filter-section">
        <span className="filter-heading">渲染质量</span>
        <div className="quality-control">
          {(['high', 'medium', 'low'] as QualityLevel[]).map((level) => (
            <button
              type="button"
              key={level}
              className={quality === level ? 'active' : ''}
              onClick={() => setQuality(level)}
              aria-pressed={quality === level}
            >
              {qualityLabel(level)}
            </button>
          ))}
        </div>
      </section>
    </aside>
  )
}

function dimensionLabel(dimension: VisualDimension): string {
  if (dimension === 'mastery') return '熟练度'
  if (dimension === 'exploration') return '探索度'
  if (dimension === 'temperature') return '温度'
  if (dimension === 'area') return '领域'
  return '密度'
}

function dimensionHelp(dimension: VisualDimension): string {
  if (dimension === 'mastery') return '海拔：知识密度 × 置信度加权熟练度；未标注不参与高度。'
  if (dimension === 'exploration') return '海拔：知识密度 × 探索度；暖色节点表示更高探索意愿。'
  if (dimension === 'temperature') return '颜色：打开、编辑和复习事件按时间衰减叠加；保持稳定坐标与知识密度海拔。'
  if (dimension === 'area') return '海拔保持知识密度；颜色来自 YAML area/areas，多选板块按任一归属筛选，跨域金色山脊表示可追溯的 WikiLink。'
  return '海拔：笔记在稳定语义坐标中的局部密度。'
}

function qualityLabel(level: QualityLevel): string {
  if (level === 'high') return '高'
  if (level === 'medium') return '中'
  return '低'
}