import type { GapEvidence } from '../domain/terrain-evidence'
import type { TerrainNote } from '../domain/types'

export function GapEvidenceContent({
  evidence,
  notes,
  onSelectNote,
}: {
  evidence: GapEvidence & { enabled: true; node: NonNullable<GapEvidence['node']> }
  notes: TerrainNote[]
  onSelectNote: (id: string) => void
}) {
  const node = evidence.node
  const notesById = new Map(notes.map((note) => [note.id, note]))
  return (
    <div className="gap-evidence-content" data-evidence-kind="gap" data-formula-version={evidence.formulaVersion}>
      <span className="panel-kicker">参考图谱缺口</span>
      <h2>{node.label}</h2>
      <div className="collision-metric"><strong>{Math.round(node.ocean * 100)}%</strong><span>{gapStateLabel(node.state)} · 海洋值</span></div>
      <p className="collision-method">仅相对所选参考图谱「{evidence.referenceAtlasId ?? 'unknown'}」；这不是用户能力、无知程度或低活动判断。</p>
      <div className="reference-gap-evidence peak-evidence-grid">
        <small>缺口公式：{evidence.formulaVersion}</small>
        <small>参考边界：{evidence.referenceAtlasId}</small>
        <small>预期节点：{node.expectedNodeIds.join('、')}</small>
        <small>支持项：{node.supportingItemIds.length ? node.supportingItemIds.join('、') : '暂无支持项'}</small>
        {node.lastSupportingAt && <small>最近支持：{formatDate(node.lastSupportingAt)}</small>}
        {evidence.evaluatedAt && <small>评估于：{formatDate(evidence.evaluatedAt)}</small>}
        <small>来源：{evidence.provenance.join('、')}</small>
        <small>证据 IDs：{evidence.supportingIds.join('、')}</small>
      </div>
      {node.supportingItemIds.length > 0 && (
        <section className="collision-pairs" aria-label="缺口支持笔记">
          <span className="panel-kicker">支持笔记</span>
          <ul>
            {node.supportingItemIds.slice(0, 8).map((itemId) => {
              const note = notesById.get(itemId)
              return note ? <li key={itemId}><button type="button" onClick={() => onSelectNote(itemId)}><span>{note.title}</span><small>{itemId}</small></button></li> : null
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

function gapStateLabel(state: 'missing' | 'sparse' | 'stale' | 'covered'): string {
  if (state === 'missing') return '未覆盖'
  if (state === 'sparse') return '覆盖稀疏'
  if (state === 'stale') return '已过期'
  return '已覆盖'
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value))
}
