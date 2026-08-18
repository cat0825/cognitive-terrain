import { useEffect, useMemo, useState } from 'react'
import { buildProjectReferenceGapReport } from '../domain/reference-gaps'
import type { TerrainProject } from '../domain/types'

export function ReferenceGapSection({
  project,
  onSelectAtlas,
}: {
  project: TerrainProject
  onSelectAtlas: (id: string) => void
}) {
  const [selectedAtlasId, setSelectedAtlasId] = useState(project.activeReferenceAtlasId ?? '')
  const [evaluatedAt] = useState(() => Date.now())
  useEffect(() => {
    setSelectedAtlasId(project.activeReferenceAtlasId ?? '')
  }, [project.activeReferenceAtlasId])
  const report = useMemo(
    () => buildProjectReferenceGapReport(project, selectedAtlasId, evaluatedAt),
    [evaluatedAt, project, selectedAtlasId],
  )
  const atlases = project.referenceAtlases ?? []
  const nodesById = new Map((project.taxonomyNodes ?? []).map((node) => [node.id, node]))
  const supportingTitles = new Map(project.notes.map((note) => [note.id, note.title]))
  const expectedLabels = (ids: string[]) => ids.map((id) => nodesById.get(id)?.label ?? id)
  return (
    <section className="reference-gap-section" aria-label="参考图谱知识缺口">
      <div className="section-heading">
        <span className="panel-kicker">参考图谱缺口</span>
        {atlases.length > 0 && (
          <label className="reference-gap-select">
            <span className="sr-only">选择参考图谱</span>
            <select value={selectedAtlasId} onChange={(event) => {
              setSelectedAtlasId(event.target.value)
              onSelectAtlas(event.target.value)
            }}>
              <option value="">未选择</option>
              {atlases.map((atlas) => <option value={atlas.id} key={atlas.id}>{atlas.label}</option>)}
            </select>
          </label>
        )}
      </div>
      {!report.enabled ? (
        <p className="reference-gap-empty">未选择参考图谱；活动低不等于知识缺口，选择一个明确的参考图谱后才会计算覆盖缺口。</p>
      ) : report.gaps.filter((gap) => gap.gap > 0).length === 0 ? (
        <p className="reference-gap-empty">当前参考图谱没有待补覆盖节点。</p>
      ) : (
        <div className="reference-gap-list">
          {report.gaps.filter((gap) => gap.gap > 0).map((gap) => (
            <details key={gap.nodeId} className="reference-gap-item" data-reference-node-id={gap.nodeId}>
              <summary>
                <span>{gap.label}</span>
                <small>{gap.state === 'stale' ? '已过期' : gap.state === 'sparse' ? '覆盖稀疏' : '未覆盖'} · {Math.round(gap.gap * 100)}%</small>
              </summary>
              <div className="reference-gap-evidence">
                <span>预期节点：{expectedLabels(gap.expectedNodeIds).join('、')}</span>
                <span>支持项：{gap.supportingItemIds.length > 0 ? gap.supportingItemIds.map((id) => supportingTitles.get(id) ?? id).join('、') : '暂无支持项'}</span>
                {gap.lastSupportingAt && <span>最近支持：{formatDate(gap.lastSupportingAt)}</span>}
              </div>
            </details>
          ))}
        </div>
      )}
      {report.enabled && <small className="reference-gap-meta">公式 {report.formulaVersion} · 评估于 {formatDate(report.evaluatedAt)}</small>}
    </section>
  )
}

function formatDate(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((candidate) => candidate.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`
}
