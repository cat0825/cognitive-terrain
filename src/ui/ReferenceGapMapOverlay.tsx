import type { ReferenceGapReport } from '../domain/reference-gaps'
import type { CSSProperties } from 'react'

const gapButtonStyle: CSSProperties = { minWidth: 0, width: '100%', display: 'flex', alignItems: 'center', gap: 5, padding: 0, border: 0, color: 'inherit', background: 'transparent', font: 'inherit', textAlign: 'left', cursor: 'pointer' }
const gapLabelStyle: CSSProperties = { width: 72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

export function ReferenceGapMapOverlay({
  atlasLabel,
  report,
  selectedNodeId,
  onSelectGap,
}: {
  atlasLabel: string
  report: ReferenceGapReport
  selectedNodeId: string | null
  onSelectGap: (nodeId: string | null) => void
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
      style={{ pointerEvents: 'auto' }}
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
              <button
                type="button"
                className={selectedNodeId === gap.nodeId ? 'is-active' : undefined}
                style={{ ...gapButtonStyle, outline: selectedNodeId === gap.nodeId ? '1px solid #78aeb3' : undefined }}
                aria-label={`查看缺口 ${gap.label}`}
                aria-pressed={selectedNodeId === gap.nodeId}
                onClick={() => onSelectGap(selectedNodeId === gap.nodeId ? null : gap.nodeId)}
              >
                <span style={gapLabelStyle}>{gap.label}</span>
                <i style={{ width: `${gap.ocean * 82}px`, maxWidth: 82, height: 3, borderRadius: 2, background: 'linear-gradient(90deg, #3b7178, #7cb6bb)' }} />
                <small style={{ marginLeft: 'auto', color: '#9dc6c8' }}>{Math.round(gap.ocean * 100)}%</small>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <small className="reference-gap-map-covered">当前图谱无待补覆盖节点</small>
      )}
    </aside>
  )
}
