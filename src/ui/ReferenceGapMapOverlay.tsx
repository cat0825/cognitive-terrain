import type { ReferenceGapReport } from '../domain/reference-gaps'
import type { CSSProperties } from 'react'

export function ReferenceGapMapOverlay({
  atlasLabel,
  report,
}: {
  atlasLabel: string
  report: ReferenceGapReport
}) {
  if (!report.enabled) return null
  const openGaps = report.gaps
    .filter((gap) => gap.gap > 0)
    .sort((left, right) => right.gap * right.expectedWeight - left.gap * left.expectedWeight)
  const counts = {
    missing: report.gaps.filter((gap) => gap.state === 'missing').length,
    sparse: report.gaps.filter((gap) => gap.state === 'sparse').length,
    stale: report.gaps.filter((gap) => gap.state === 'stale').length,
  }

  return (
    <aside
      className="reference-gap-map"
      aria-label="参考图谱海洋图层"
      aria-live="polite"
      data-formula-version={report.formulaVersion}
    >
      <header>
        <span>REFERENCE OCEAN</span>
        <small>非空间层</small>
      </header>
      <strong>{atlasLabel}</strong>
      <p>仅相对所选图谱，不改变语义投影坐标</p>
      <div className="reference-gap-map-counts">
        <span>缺失 {counts.missing}</span>
        <span>稀疏 {counts.sparse}</span>
        <span>过期 {counts.stale}</span>
      </div>
      {openGaps.length > 0 ? (
        <ol>
          {openGaps.slice(0, 4).map((gap) => (
            <li key={gap.nodeId}>
              <span>{gap.label}</span>
              <i style={{ '--gap-ocean': gap.ocean } as CSSProperties} />
              <small>{Math.round(gap.ocean * 100)}%</small>
            </li>
          ))}
        </ol>
      ) : (
        <small className="reference-gap-map-covered">当前图谱无待补覆盖节点</small>
      )}
    </aside>
  )
}
