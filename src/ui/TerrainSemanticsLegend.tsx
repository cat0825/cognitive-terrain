import { Info, X } from 'lucide-react'
import { useMemo, useState, type CSSProperties } from 'react'
import { buildTerrainSemanticsLegend } from '../domain/terrain-evidence'
import type { TerrainProject, ViewMode, VisualDimension } from '../domain/types'

export function TerrainSemanticsLegend({
  project,
  visualDimension,
  viewMode,
  evaluatedAt,
}: {
  project: TerrainProject
  visualDimension: VisualDimension
  viewMode: ViewMode
  evaluatedAt: number
}) {
  const [open, setOpen] = useState(false)
  const legend = useMemo(
    () => buildTerrainSemanticsLegend(project, { visualDimension, evaluatedAt }),
    [evaluatedAt, project, visualDimension],
  )
  return (
    <aside
      className="reference-gap-map"
      style={open ? styles.open : styles.closed}
      aria-label="地形语义图例"
      data-view-mode={viewMode}
      data-formula-version={legend.formulaVersion}
    >
      <button
        type="button"
        className="terrain-semantics-toggle"
        style={open ? styles.openToggle : styles.toggle}
        aria-expanded={open}
        aria-controls="terrain-semantics-body"
        title={open ? '关闭地形语义图例' : '查看地形语义图例'}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X size={13} /> : <Info size={13} />}
        <span>地形语义</span>
      </button>
      <div id="terrain-semantics-body" hidden={!open}>
        <header>
          <strong>{viewMode.toUpperCase()} 共同证据契约</strong>
          <small>{legend.modelId} · {embeddingModeLabel(legend.embeddingMode)}</small>
        </header>
        <dl style={styles.list}>
          {legend.entries.map((entry) => (
            <div key={entry.kind} style={entry.active ? styles.entry : styles.disabledEntry}>
              <dt style={styles.term}>{entry.label}<small style={styles.formula}>{entry.formulaVersion}</small></dt>
              <dd style={styles.definition}>{entry.definition}</dd>
              <dd style={styles.limit}>边界：{entry.limitation}</dd>
              {entry.evaluatedAt && <dd style={styles.limit}>评估于 {formatDate(entry.evaluatedAt)}</dd>}
              {entry.supportingIds.length > 0 && <dd style={styles.limit}>证据 IDs：{entry.supportingIds.join('、')}</dd>}
            </div>
          ))}
        </dl>
      </div>
    </aside>
  )
}

const styles: Record<string, CSSProperties> = {
  open: { zIndex: 29, top: 188, right: 48, bottom: 'auto', left: 'auto', width: 'min(268px, calc(100vw - 80px))', maxHeight: 'calc(100dvh - 250px)', overflow: 'auto', pointerEvents: 'auto', font: '8px/1.4 var(--mono)' },
  closed: { zIndex: 29, top: 50, right: 48, bottom: 'auto', left: 'auto', width: 'auto', display: 'flex', padding: 0, border: 0, background: 'none', boxShadow: 'none', backdropFilter: 'none', pointerEvents: 'auto', font: '8px/1.4 var(--mono)' },
  toggle: { height: 27, display: 'flex', alignItems: 'center', gap: 5, padding: '0 7px', border: '1px solid #343432', borderRadius: 3, color: '#aaa9a4', background: '#181817', font: 'inherit', cursor: 'pointer' },
  openToggle: { width: 26, height: 27, marginLeft: 'auto', padding: 0, border: 0, color: '#aaa9a4', background: 'transparent', cursor: 'pointer' },
  list: { margin: '8px 0 0' },
  entry: { padding: '7px 0', borderTop: '1px solid #2d2d2a' },
  disabledEntry: { padding: '7px 0', borderTop: '1px solid #2d2d2a', opacity: 0.58 },
  term: { display: 'flex', justifyContent: 'space-between', color: '#c4c4bf' },
  formula: { overflowWrap: 'anywhere', color: '#8f835f' },
  definition: { margin: 0, overflowWrap: 'anywhere', color: '#92928e' },
  limit: { margin: 0, overflowWrap: 'anywhere', color: '#777773' },
}

function embeddingModeLabel(mode: TerrainProject['embeddingMode']): string {
  if (mode === 'semantic') return 'semantic embedding'
  if (mode === 'fallback') return 'deterministic fallback（非等价语义证据）'
  return 'demo fixture'
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(value))
}
