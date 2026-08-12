import { Check, RotateCcw, X } from 'lucide-react'
import { projectTagCounts } from '../domain/project-view'
import type { QualityLevel, VisualDimension } from '../domain/types'
import { useAppStore } from '../store/app-store'

export function FilterPanel() {
  const project = useAppStore((state) => state.project)
  const activeTags = useAppStore((state) => state.activeTags)
  const quality = useAppStore((state) => state.quality)
  const visualDimension = useAppStore((state) => state.visualDimension)
  const filtersOpen = useAppStore((state) => state.filtersOpen)
  const toggleTag = useAppStore((state) => state.toggleTag)
  const clearTags = useAppStore((state) => state.clearTags)
  const setQuality = useAppStore((state) => state.setQuality)
  const setVisualDimension = useAppStore((state) => state.setVisualDimension)
  const setFiltersOpen = useAppStore((state) => state.setFiltersOpen)
  const tags = projectTagCounts(project).slice(0, 18)

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
        <span className="filter-heading">点云编码</span>
        <div className="visual-dimension-control">
          {(['density', 'mastery', 'exploration', 'area'] as VisualDimension[]).map((dimension) => (
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
  if (dimension === 'area') return '领域'
  return '密度'
}

function dimensionHelp(dimension: VisualDimension): string {
  if (dimension === 'mastery') return '越清晰、越明亮表示掌握程度越高；未标注保持中性。'
  if (dimension === 'exploration') return '暖色和较大节点表示更值得继续探索。'
  if (dimension === 'area') return '颜色来自 YAML area；没有 area 时使用首个标签。'
  return '沿用当前地形层级：高度、重要性、新鲜度与峰值邻近共同决定亮度。'
}

function qualityLabel(level: QualityLevel): string {
  if (level === 'high') return '高'
  if (level === 'medium') return '中'
  return '低'
}
