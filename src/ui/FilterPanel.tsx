import { Check, RotateCcw, X } from 'lucide-react'
import { projectTagCounts } from '../domain/project-view'
import type { QualityLevel } from '../domain/types'
import { useAppStore } from '../store/app-store'

export function FilterPanel() {
  const project = useAppStore((state) => state.project)
  const activeTags = useAppStore((state) => state.activeTags)
  const quality = useAppStore((state) => state.quality)
  const filtersOpen = useAppStore((state) => state.filtersOpen)
  const toggleTag = useAppStore((state) => state.toggleTag)
  const clearTags = useAppStore((state) => state.clearTags)
  const setQuality = useAppStore((state) => state.setQuality)
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

function qualityLabel(level: QualityLevel): string {
  if (level === 'high') return '高'
  if (level === 'medium') return '中'
  return '低'
}
