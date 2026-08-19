import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDownLeft, ArrowUpRight, BookOpen, CalendarDays, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, FilePenLine, Focus, GitCompare, Link2, Pencil, X } from 'lucide-react'
import { evaluationTimeForProject } from '../domain/evaluation-time'
import { calculateActivityElevation } from '../domain/activity-elevation'
import { calculateProjectLearningProgression } from '../domain/learning-progression'
import type { CognitiveObservation, InteractionEventType, TerrainNote, TerrainProject } from '../domain/types'
import { buildActivitySummaries, temperatureColor } from '../domain/activity-temperature'
import { aggregateActivityHistoryCounts } from '../domain/activity-history'
import {
  areasForNote,
  COLLISION_DIRECTION_MIN_CONFIDENCE,
  COLLISION_DIRECTION_MIN_RELATIONS,
  plateColor,
  type PlateCollision,
} from '../domain/knowledge-plates'
import type { ReferenceGapReport } from '../domain/reference-gaps'
import { findNeighbors } from '../pipeline/neighbors'
import {
  buildCollisionEvidence,
  buildGapEvidence,
  buildNoteNeighborEvidence,
  buildPeakEvidence,
  type TerrainNeighborEvidence,
} from '../domain/terrain-evidence'
import { profileIdForVisualDimension } from '../domain/terrain-profile'
import { resolveNoteRelations, semanticLinkCandidates } from '../domain/knowledge-maintenance'
import {
  vaultWikiLinkCandidate,
  vaultWritebackCandidates,
  type VaultWritebackCandidate,
} from '../domain/vault-writeback-candidates'
import { obsidianUri } from '../import/obsidian-uri'
import { useAppStore } from '../store/app-store'
import { ActivityHistory, type ActivityHistoryBucket } from './ActivityHistory'

const ReferenceGapSection = lazy(async () => import('./ReferenceGapSection').then((module) => ({ default: module.ReferenceGapSection })))
const ExplorationWorkbench = lazy(async () => import('./ExplorationWorkbench').then((module) => ({ default: module.ExplorationWorkbench })))
const GapEvidenceContent = lazy(async () => import('./GapEvidenceContent').then((module) => ({ default: module.GapEvidenceContent })))

interface NoteDetailProps {
  project: TerrainProject
  note: TerrainNote | undefined
  peak?: TerrainProject['peaks'][number]
  collision?: PlateCollision
  gapReport?: ReferenceGapReport
  gapNodeId?: string
  visibleCount: number
  onWriteback: (candidates: VaultWritebackCandidate[]) => void
}

export function NoteDetail({ project, note, peak, collision, gapReport, gapNodeId, visibleCount, onWriteback }: NoteDetailProps) {
  const detailsOpen = useAppStore((state) => state.detailsOpen)
  const selectNote = useAppStore((state) => state.selectNote)
  const closeButton = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const returnFocus = useRef<HTMLElement | SVGElement | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (!detailsOpen) return
    const activeElement = document.activeElement
    returnFocus.current = (activeElement instanceof HTMLElement || activeElement instanceof SVGElement)
      && !activeElement.closest('.note-detail')
      ? activeElement
      : document.getElementById('terrain-export-source')
    setCollapsed(false)
    const focusFrame = window.requestAnimationFrame(() => closeButton.current?.focus())
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      selectNote(null)
    }
    document.addEventListener('keydown', closeWithEscape)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', closeWithEscape)
      const target = returnFocus.current
      window.requestAnimationFrame(() => {
        if (target?.isConnected) target.focus()
        else document.getElementById('terrain-export-source')?.focus()
      })
    }
  }, [detailsOpen, selectNote])

  useEffect(() => {
    setCollapsed(false)
    if (panel.current) panel.current.scrollTop = 0
  }, [collision?.id, gapNodeId, note?.id, peak?.id])

  if (!detailsOpen) return null

  return (
    <aside
      ref={panel}
      className={`${collapsed ? 'note-detail is-collapsed' : 'note-detail'}${!collision && !gapNodeId && !peak && !note ? ' note-detail--overview' : ''}`}
      aria-label={collision ? '板块碰撞详情' : gapNodeId ? '知识缺口证据详情' : peak ? '峰值证据详情' : note ? '笔记详情' : '知识概览'}
    >
      <div className="detail-grip" aria-hidden="true" />
      <header>
        <span className="panel-kicker">
          {collision ? 'PLATE COLLISION' : gapNodeId ? 'REFERENCE GAP' : peak ? 'SELECTED PEAK' : note ? 'SELECTED NOTE' : 'PROJECT OVERVIEW'}
          <span className={`mode-badge mode-badge--${project.embeddingMode}`}>
            {embeddingModeLabel(project.embeddingMode)}
          </span>
        </span>
        <div className="detail-header-actions">
          <button
            type="button"
            className="icon-button detail-collapse"
            aria-label={collapsed ? '展开详情' : '收起详情'}
            aria-expanded={!collapsed}
            aria-controls="note-detail-body"
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          <button
            ref={closeButton}
            type="button"
            className="icon-button"
            aria-label="关闭详情"
            onClick={() => selectNote(null)}
          >
            <X size={16} />
          </button>
        </div>
      </header>
      <div id="note-detail-body" className="detail-body" hidden={collapsed}>
        {collision
          ? <CollisionContent collision={collision} project={project} />
          : gapNodeId && gapReport
            ? <GapContent project={project} report={gapReport} nodeId={gapNodeId} />
            : peak
            ? <PeakContent peak={peak} project={project} />
            : note
              ? <NoteContent key={note.id} note={note} onWriteback={onWriteback} />
              : <ProjectOverview project={project} visibleCount={visibleCount} />}
      </div>
    </aside>
  )
}

function GapContent({ project, report, nodeId }: { project: TerrainProject; report: ReferenceGapReport; nodeId: string }) {
  const selectNote = useAppStore((state) => state.selectNote)
  const evidence = buildGapEvidence(report, nodeId)
  if (!evidence.enabled || !evidence.node) {
    return <p role="status">{evidence.reason === 'no-reference-atlas' ? '未选择参考图谱。' : '参考图谱节点不存在。'}</p>
  }
  return (
    <Suspense fallback={<p role="status">正在加载缺口证据</p>}>
      <GapEvidenceContent evidence={{ ...evidence, enabled: true, node: evidence.node }} notes={project.notes} onSelectNote={selectNote} />
    </Suspense>
  )
}

function CollisionContent({ collision, project }: { collision: PlateCollision; project: TerrainProject }) {
  const selectNote = useAppStore((state) => state.selectNote)
  const notesById = new Map(project.notes.map((note) => [note.id, note]))
  const pairs = collision.bridges.flatMap((bridge) => bridge.evidence.flatMap((evidence, evidenceIndex) => {
    const from = notesById.get(evidence.fromId)
    const to = notesById.get(evidence.toId)
    return from && to ? [{ from, to, key: `${bridge.id}-${evidenceIndex}` }] : []
  }))
  const routeSymbol = collision.direction === 'first-to-second'
    ? '→'
    : collision.direction === 'second-to-first'
      ? '←'
      : '×'
  const directionLabel = collision.direction === 'first-to-second'
    ? `${collision.firstArea} → ${collision.secondArea}`
    : collision.direction === 'second-to-first'
      ? `${collision.secondArea} → ${collision.firstArea}`
      : '方向证据不足，保持无向'
  const confidence = Math.round(collision.directionConfidence * 100)
  const confidenceThreshold = Math.round(COLLISION_DIRECTION_MIN_CONFIDENCE * 100)
  const evidence = buildCollisionEvidence(collision)
  return (
    <div className="collision-content">
      <span className="panel-kicker">板块碰撞带</span>
      <h2>{collision.firstArea} × {collision.secondArea}</h2>
      <div className="collision-route" aria-label={`${collision.firstArea} 与 ${collision.secondArea}`}>
        <span><i style={{ backgroundColor: plateColor(collision.firstArea) }} aria-hidden="true" />{collision.firstArea}</span>
        <b aria-label={collision.direction === 'neutral' ? '无向' : '主要链接方向'}>{routeSymbol}</b>
        <span><i style={{ backgroundColor: plateColor(collision.secondArea) }} aria-hidden="true" />{collision.secondArea}</span>
      </div>
      <div className="collision-metric"><strong>{collision.relationCount}</strong><span>条跨域 WikiLink</span></div>
      <div className="collision-route" aria-label="链接方向计数">
        <span>{collision.firstArea} → {collision.secondArea}: {collision.firstToSecondCount}</span>
        <span>{collision.secondArea} → {collision.firstArea}: {collision.secondToFirstCount}</span>
        <span>双向配对: {collision.bidirectionalCount}</span>
      </div>
      <p className="collision-method">当前判定：{directionLabel}（方向置信度 {confidence}%）。至少需要 {COLLISION_DIRECTION_MIN_RELATIONS} 组跨域关系且置信度达到 {confidenceThreshold}% 才显示方向标记；未达阈值时 2D/3D 均保持无向。</p>
      <p className="collision-method">仅统计当前搜索/领域筛选后的最终时间层中可解析的源笔记 → 目标笔记 WikiLink。共享任一领域时不计为跨域，完全不相交时按双方主领域聚合。方向只描述链接证据，带宽只表示唯一笔记对数量；不推断因果、先修顺序或语义方向。</p>
      <details className="activity-elevation-evidence terrain-evidence-details">
        <summary>查看碰撞证据契约</summary>
        <div>
          <small>公式 {evidence.formulaVersion} · 方向 {evidence.summary.directionFormulaVersion} · 强度 {evidence.summary.strengthFormulaVersion}</small>
          <small>来源：{evidence.provenance.join('、')}</small>
          <small>证据 IDs：{evidence.supportingIds.join('、')}</small>
        </div>
      </details>
      <section className="collision-pairs">
        <span className="panel-kicker">方向证据</span>
        <ul>
          {pairs.slice(0, 6).map(({ from, to, key }) => (
            <li key={key}>
              <button
                type="button"
                data-source-note-id={from.id}
                data-target-note-id={to.id}
                aria-label={`${from.title} 指向 ${to.title}`}
                onClick={() => selectNote(from.id)}
              >
                <span>{from.title}</span><small>→ {to.title}</small>
              </button>
            </li>
          ))}
        </ul>
        {pairs.length > 6 && <small>另有 {pairs.length - 6} 条方向证据</small>}
      </section>
    </div>
  )
}

function PeakContent({ peak, project }: { peak: TerrainProject['peaks'][number]; project: TerrainProject }) {
  const selectNote = useAppStore((state) => state.selectNote)
  const visualDimension = useAppStore((state) => state.visualDimension)
  const profileId = profileIdForVisualDimension(visualDimension)
  const evaluatedAt = evaluationTimeForProject(project.updatedAt)
  const evidence = buildPeakEvidence(project, peak, { profileId, evaluatedAt })
  if (!evidence) return <p role="status">峰值证据不可用。</p>
  const notesById = new Map(project.notes.map((note) => [note.id, note]))
  const missingInputs = evidence.activeHeight.inputs.filter((input) => input.missing).length
  return (
    <div className="peak-evidence-content" data-evidence-kind="peak" data-formula-version={evidence.formulaVersion}>
      <span className="panel-kicker">峰值证据</span>
      <h2>{peak.label}</h2>
      <div className="collision-metric"><strong>{evidence.memberItemIds.length}</strong><span>条成员笔记</span></div>
      <p className="collision-method">全项目最终时间层的局部极大值；成员是峰顶半径内最多 24 条笔记，不是互斥 cluster，也不随筛选或历史时间层重算。</p>
      <div className="reference-gap-evidence peak-evidence-grid">
        <small>峰值公式：{evidence.formulaVersion}</small>
        <small>局部密度：{evidence.localDensity.formulaVersion}</small>
        <small>当前海拔：{evidence.activeHeight.formulaVersion} · {evidence.activeHeight.elevation}</small>
        <small>命名来源：{peakLabelSource(evidence.labelEvidence.source)} · {evidence.labelEvidence.supportingItemIds.length} 条支持</small>
        <small>缺失输入：{missingInputs} · {evidence.activeHeight.missingInputBehavior}</small>
        {evidence.evaluatedAt && <small>评估于 {formatDate(evidence.evaluatedAt)}</small>}
        <small>来源：{evidence.provenance.join('、')}</small>
        <small>证据 IDs：{evidence.supportingIds.join('、')}</small>
      </div>
      <section className="collision-pairs" aria-label="峰值成员笔记">
        <span className="panel-kicker">成员与密度贡献</span>
        <ul>
          {evidence.localDensity.contributions.slice(0, 8).map((contribution) => {
            const member = notesById.get(contribution.itemId)
            return member ? (
              <li key={member.id}>
                <button type="button" onClick={() => selectNote(member.id)}>
                  <span>{member.title}</span>
                  <small>weight {contribution.noteWeight.toFixed(2)} · 投影距离 {contribution.projectedDistance.toFixed(4)}</small>
                </button>
              </li>
            ) : null
          })}
        </ul>
      </section>
    </div>
  )
}

function NoteContent({ note, onWriteback }: { note: TerrainNote; onWriteback: (candidates: VaultWritebackCandidate[]) => void }) {
  const project = useAppStore((state) => state.project)
  const selectNote = useAppStore((state) => state.selectNote)
  const requestFocus = useAppStore((state) => state.requestFocus)
  const updateNote = useAppStore((state) => state.updateNote)
  const markNoteReviewed = useAppStore((state) => state.markNoteReviewed)
  const neighbors = findNeighbors(project, note.id, 6)
  const semanticCandidates = semanticLinkCandidates(project.notes, note.id, 3)
  const pendingWriteback = vaultWritebackCandidates(project, note.id)
  const noteAreas = areasForNote(note)
  const activityEvaluatedAt = useMemo(
    () => evaluationTimeForProject(project.updatedAt),
    [project.updatedAt],
  )
  const activity = useMemo(
    () => buildActivitySummaries([note], project.interactionEvents, activityEvaluatedAt, project.activityHistory?.aggregates).get(note.id),
    [activityEvaluatedAt, note, project.activityHistory?.aggregates, project.interactionEvents],
  )
  const activityElevation = useMemo(
    () => calculateActivityElevation({
      itemId: note.id,
      events: project.interactionEvents,
      aggregates: project.activityHistory?.aggregates,
      evaluatedAt: activityEvaluatedAt,
    }),
    [activityEvaluatedAt, note.id, project.activityHistory?.aggregates, project.interactionEvents],
  )
  const activityHistory = useMemo(() => {
    const state = project.activityHistory ?? {
      policyVersion: 1 as const,
      timeZone: project.timeZone,
      rawEvents: project.interactionEvents,
      aggregates: [],
    }
    const toBucket = (bucket: ReturnType<typeof aggregateActivityHistoryCounts>[number]): ActivityHistoryBucket => ({
      key: `${bucket.granularity}:${bucket.bucket}`,
      label: bucket.granularity === 'day' ? bucket.bucket.slice(5) : `周 ${bucket.bucket.slice(5)}`,
      openedCount: bucket.counts.opened ?? 0,
      editedCount: bucket.counts.edited ?? 0,
      reviewedCount: bucket.counts.reviewed ?? 0,
      totalCount: bucket.totalCount,
    })
    return {
      daily: aggregateActivityHistoryCounts({ ...state, rawEvents: state.rawEvents.filter((event) => event.itemId === note.id), aggregates: state.aggregates.filter((aggregate) => aggregate.itemId === note.id) }, 'day').map(toBucket),
      weekly: aggregateActivityHistoryCounts({ ...state, rawEvents: state.rawEvents.filter((event) => event.itemId === note.id), aggregates: state.aggregates.filter((aggregate) => aggregate.itemId === note.id) }, 'week').map(toBucket),
    }
  }, [note.id, project.activityHistory, project.interactionEvents, project.timeZone])
  const progressionEvaluatedAt = project.updatedAt
  const progression = useMemo(
    () => calculateProjectLearningProgression(project, note.id, progressionEvaluatedAt),
    [note.id, project, progressionEvaluatedAt],
  )
  const progressionObservations = useMemo(
    () => (project.cognitiveObservations ?? [])
      .filter((observation) => observation.itemId === note.id)
      .sort(compareCognitiveObservations),
    [note.id, project.cognitiveObservations],
  )
  const progressionCheckpoints = useMemo(
    () => [...new Set(progressionObservations
      .filter(isNumericCognitiveObservation)
      .map((observation) => observation.observedAt))],
    [progressionObservations],
  )
  const [progressionCheckpoint, setProgressionCheckpoint] = useState('current')
  useEffect(() => setProgressionCheckpoint('current'), [note.id])
  const checkpointProgression = useMemo(
    () => progressionCheckpoint === 'current'
      ? undefined
      : calculateProjectLearningProgression(project, note.id, progressionCheckpoint),
    [note.id, project, progressionCheckpoint],
  )
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(note.title)
  const [draftContent, setDraftContent] = useState(note.content)
  const [draftTags, setDraftTags] = useState(note.tags.join(', '))
  const [draftAreas, setDraftAreas] = useState(noteAreas.join(', '))
  const [draftMastery, setDraftMastery] = useState(note.mastery === undefined ? '' : String(Math.round(note.mastery * 100)))
  const [draftConfidence, setDraftConfidence] = useState(note.confidence === undefined ? '' : String(Math.round(note.confidence * 100)))
  const [draftExploration, setDraftExploration] = useState(note.exploration === undefined ? '' : String(Math.round(note.exploration * 100)))
  const [draftStatus, setDraftStatus] = useState(note.status ?? '')
  const [draftObservationProvenance, setDraftObservationProvenance] = useState<'self-assessment' | 'review-outcome'>('self-assessment')
  const [draftObservationReason, setDraftObservationReason] = useState('手动自评')
  const [isReviewing, setIsReviewing] = useState(false)
  const isAnalyzing = useAppStore((state) => state.isAnalyzing)
  const dirty = draftTitle.trim() !== note.title || draftContent.trim() !== note.content || splitTags(draftTags).join(',') !== note.tags.join(',') || splitAreas(draftAreas).join(',') !== noteAreas.join(',') || draftMastery !== scoreText(note.mastery) || draftConfidence !== scoreText(note.confidence) || draftExploration !== scoreText(note.exploration) || draftStatus !== (note.status ?? '')
  if (editing) {
    return (
      <div className="note-content">
        <span className="panel-kicker">EDIT NOTE</span>
        <label className="edit-field">
          <span>标题</span>
          <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} />
        </label>
        <label className="edit-field">
          <span>正文</span>
          <textarea value={draftContent} rows={7} onChange={(event) => setDraftContent(event.target.value)} />
        </label>
        <label className="edit-field">
          <span>标签（逗号分隔）</span>
          <input value={draftTags} onChange={(event) => setDraftTags(event.target.value)} />
        </label>
        <label className="edit-field">
          <span>领域（逗号分隔）</span>
          <input value={draftAreas} onChange={(event) => setDraftAreas(event.target.value)} placeholder="例如：数学, 物理" />
        </label>
        <div className="state-grid">
          <label className="edit-field"><span>熟练度 0–100</span><input inputMode="numeric" value={draftMastery} onChange={(event) => setDraftMastery(event.target.value)} placeholder="未标注" /></label>
          <label className="edit-field"><span>置信度 0–100</span><input inputMode="numeric" value={draftConfidence} onChange={(event) => setDraftConfidence(event.target.value)} placeholder="未标注" /></label>
          <label className="edit-field"><span>探索度 0–100</span><input inputMode="numeric" value={draftExploration} onChange={(event) => setDraftExploration(event.target.value)} placeholder="未标注" /></label>
          <label className="edit-field"><span>状态</span><select value={draftStatus} onChange={(event) => setDraftStatus(event.target.value)}><option value="">未标注</option><option value="seed">seed · 起点</option><option value="growing">growing · 生长中</option><option value="stable">stable · 稳定</option><option value="gap">gap · 缺口</option><option value="archived">archived · 归档</option></select></label>
        </div>
        <div className="state-grid observation-fields">
          <label className="edit-field"><span>认知变更来源</span><select aria-label="认知变更来源" value={draftObservationProvenance} onChange={(event) => {
            const provenance = event.target.value as 'self-assessment' | 'review-outcome'
            setDraftObservationProvenance(provenance)
            setDraftObservationReason(provenance === 'review-outcome' ? '显式复习结果' : '手动自评')
          }}><option value="self-assessment">自我评估</option><option value="review-outcome">复习结果</option></select></label>
          <label className="edit-field observation-reason"><span>变更理由</span><input required value={draftObservationReason} onChange={(event) => setDraftObservationReason(event.target.value)} /></label>
        </div>
        <div className="edit-actions">
          <button
            type="button"
            className="primary-button"
            disabled={!dirty || isAnalyzing}
            onClick={async () => {
              await updateNote(note.id, { title: draftTitle, content: draftContent, tags: splitTags(draftTags), areas: splitAreas(draftAreas), mastery: parseScore(draftMastery), confidence: parseScore(draftConfidence), exploration: parseScore(draftExploration), status: draftStatus ? draftStatus as TerrainNote['status'] : null }, { provenance: draftObservationProvenance, reason: draftObservationReason })
              setEditing(false)
            }}
          >
            {isAnalyzing ? '重新分析中…' : '保存并重新分析'}
          </button>
          <button type="button" className="icon-button" disabled={isAnalyzing} onClick={() => setEditing(false)}>
            取消
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="note-content">
      <div className="note-meta">
        <span>
          <CalendarDays size={13} />
          {formatDate(note.createdAt)}
        </span>
        {note.source && (
          <span>
            <BookOpen size={13} />
            {note.source}
          </span>
        )}
      </div>
      <h2>{note.title}</h2>
      {note.content && <p>{note.content}</p>}
      <div className="note-tags">
        {note.tags.map((tag) => (
          <span key={tag}>#{tag}</span>
        ))}
      </div>
      <section className="note-state" aria-label="学习状态">
        <span className="panel-kicker">学习状态</span>
        <div className="state-metrics">
          <span>熟练度 <strong>{scoreLabel(note.mastery)}</strong></span>
          <span>置信度 <strong>{scoreLabel(note.confidence)}</strong></span>
          <span>探索度 <strong>{scoreLabel(note.exploration)}</strong></span>
        </div>
        <small>{note.status ? `状态：${note.status}` : '尚未标注状态'}</small>
        {noteAreas.length > 0 && (
          <div className="note-areas" aria-label="领域归属">
            {noteAreas.map((area) => (
              <span key={area}><i style={{ backgroundColor: plateColor(area) }} aria-hidden="true" />{area}</span>
            ))}
          </div>
        )}
        <section className="note-progression" aria-label="学习进程证据">
          <div className="note-progression__heading"><span>学习进程海拔</span><strong>{Math.round(progression.elevation * 100)}%</strong></div>
          <small>{progressionHistoryLabel(progression.historyState)} · 不确定性 {Math.round(progression.uncertainty * 100)}% · {progression.profileVersion}{progression.observationsTruncated ? ' · 历史已按上限截断' : ''}</small>
          {progressionCheckpoints.length > 0 && <label className="progression-checkpoint"><span>对比检查点</span><select aria-label="学习进程检查点" value={progressionCheckpoint} onChange={(event) => setProgressionCheckpoint(event.target.value)}><option value="current">当前状态</option>{progressionCheckpoints.map((checkpoint) => <option key={checkpoint} value={checkpoint}>{formatDate(checkpoint)}</option>)}</select></label>}
          {checkpointProgression && <div className="progression-comparison" data-testid="progression-comparison"><small>检查点海拔 {Math.round(checkpointProgression.elevation * 100)}% → 当前 {Math.round(progression.elevation * 100)}%</small><strong>{progression.elevation - checkpointProgression.elevation >= 0 ? '+' : ''}{Math.round((progression.elevation - checkpointProgression.elevation) * 100)}%</strong></div>}
          <details className="progression-evidence">
            <summary>查看学习进程证据</summary>
            <div>
              <small>评估于 {formatDate(progression.evaluatedAt)} · 语义平面坐标保持不变</small>
              {progressionObservations.length > 0 ? progressionObservations.map((observation) => <small key={observation.id}>{cognitiveObservationFieldLabel(observation)} · {cognitiveObservationProvenanceLabel(observation.provenance)} · {formatDate(observation.observedAt)} · {observation.reason}</small>) : <small>无显式观测；当前快照仅作为中性基线。</small>}
            </div>
          </details>
        </section>
        <div className="note-activity" aria-label="知识温度">
          <div><span>知识温度</span><strong style={{ color: temperatureColor(activity?.score ?? 0) }}>{Math.round((activity?.score ?? 0) * 100)}%</strong></div>
          <small>打开 {activity?.openedCount ?? 0} · 编辑 {activity?.editedCount ?? 0} · 复习 {activity?.reviewedCount ?? 0}</small>
          <small>{activity?.lastActivityAt ? `最近活动：${relativeActivityTime(activity.lastActivityAt)}` : '尚无活动记录'}</small>
          <small>海拔 {Math.round(activityElevation.elevation * 100)}% · {activityElevation.historyState === 'missing' ? '无历史' : activityElevation.historyState === 'sparse' ? '历史稀疏' : activityElevation.historyState === 'stale' ? '历史过期' : '历史活跃'} · {activityElevation.formulaVersion}</small>
          <details className="activity-elevation-evidence">
            <summary>查看活动海拔证据</summary>
            <div>
              <small>评估于 {formatDate(activityElevation.evaluatedAt)} · raw heat {activityElevation.rawHeat.toFixed(3)}</small>
              <small>输入：原始事件 {activityElevation.validEventCount} · 聚合记录 {activityElevation.validAggregateCount} · 聚合事件 {activityElevation.aggregateEventCount}</small>
              <small>近期：原始事件 {activityElevation.recentEventCount - activityElevation.recentAggregateEventCount} · 聚合事件 {activityElevation.recentAggregateEventCount} · 去重抑制 {activityElevation.suppressedDuplicateEventCount + activityElevation.suppressedDuplicateAggregateCount}</small>
              {activityElevation.evidence.length > 0 ? activityElevation.evidence.map((evidence) => (
                <small key={evidence.type}>
                  {activityTypeLabel(evidence.type)}：{evidence.count} 次 · raw {evidence.rawEventCount} · aggregate {evidence.aggregateEventCount} · heat {evidence.rawHeat.toFixed(3)} · {evidence.provenance.map(provenanceLabel).join('、')}
                </small>
              )) : <small>没有可用的原始或聚合证据。</small>}
            </div>
          </details>
          <ActivityHistory daily={activityHistory.daily} weekly={activityHistory.weekly} />
        </div>
      </section>
      <div className="note-actions">
        <button type="button" className="focus-button" onClick={() => requestFocus(note.id)}>
          <Focus size={13} />
          聚焦到笔记
        </button>
        <button type="button" className="focus-button" onClick={() => setEditing(true)}>
          <Pencil size={13} />
          编辑
        </button>
        <button
          type="button"
          className="focus-button"
          disabled={isReviewing || isAnalyzing}
          onClick={async () => {
            setIsReviewing(true)
            await markNoteReviewed(note.id)
            setIsReviewing(false)
          }}
        >
          <CheckCircle2 size={13} />
          {isReviewing ? '记录中…' : '标记已复习'}
        </button>
        {pendingWriteback.length > 0 && (
          <button type="button" className="focus-button" onClick={() => onWriteback(pendingWriteback)}>
            <FilePenLine size={13} />
            写回 Obsidian ({pendingWriteback.length})
          </button>
        )}
      </div>
      {neighbors.length > 0 && (
        <section className="neighbor-section" aria-label="邻居证据">
          <span className="panel-kicker">相关笔记</span>
          <small>各信号独立展示；2D 投影接近不等于显式关系。</small>
          <ul className="neighbor-list">
            {neighbors.map((neighbor) => {
              const evidence = buildNoteNeighborEvidence(project, note.id, neighbor.id)
              return <li key={neighbor.id}>
                <button
                  type="button"
                  onClick={() => selectNote(neighbor.id)}
                  aria-label={`查看邻居 ${neighbor.title}${evidence ? `；${neighborEvidenceAriaLabel(evidence)}` : ''}`}
                >
                  <strong>{neighbor.title}</strong>
                  {evidence && <NeighborEvidence evidence={evidence} />}
                </button>
              </li>
            })}
          </ul>
        </section>
      )}
      <RelationSection note={note} />
      {semanticCandidates.length > 0 && <SemanticCandidateSection candidates={semanticCandidates} originId={note.id} project={project} onWriteback={onWriteback} />}
      {note.source?.startsWith('http') && (
        <a href={note.source} target="_blank" rel="noreferrer">
          打开来源
          <ExternalLink size={13} />
        </a>
      )}
      {note.sourcePath && !note.source?.startsWith('http') && <a href={obsidianUri(note.sourcePath, note.vault)} className="source-link" title={note.vault ? `vault：${note.vault}` : '未记录 vault，按路径打开'}>在 Obsidian 中打开 <ExternalLink size={13} /></a>}
    </div>
  )
}

function ProjectOverview({ project, visibleCount }: { project: TerrainProject; visibleCount: number }) {
  const setReferenceAtlas = useAppStore((state) => state.setReferenceAtlas)
  const selectNote = useAppStore((state) => state.selectNote)
  const transitionExploration = useAppStore((state) => state.transitionExploration)
  const editExploration = useAppStore((state) => state.editExploration)
  const isAnalyzing = useAppStore((state) => state.isAnalyzing)
  const timeline = useAppStore((state) => state.timeline)
  const compareRef = useAppStore((state) => state.compareRef)
  const setCompareRef = useAppStore((state) => state.setCompareRef)
  const currentBucket = Math.min(project.snapshots.length - 1, Math.max(0, Math.ceil(timeline)))
  const reference = compareRef !== null ? Math.min(project.snapshots.length - 1, Math.max(0, compareRef)) : null
  const referenceCutoff = reference === null ? null : snapshotCutoff(project, reference)
  const currentCutoff = snapshotCutoff(project, currentBucket)
  const delta =
    referenceCutoff === null
      ? null
      : {
          added: project.notes.filter((note) => note.createdAtMs > referenceCutoff && note.createdAtMs <= currentCutoff).length,
          removed: project.notes.filter((note) => note.createdAtMs <= referenceCutoff && note.createdAtMs > currentCutoff).length,
        }
  return (
    <div className="project-overview">
      <h2>{project.name}</h2>
      <div className="overview-stats">
        <div>
          <strong>{visibleCount}</strong>
          <span>当前笔记</span>
        </div>
        <div>
          <strong>{project.peaks.length}</strong>
          <span>主题峰值</span>
        </div>
        <div>
          <strong>{project.snapshots.length}</strong>
          <span>时间层</span>
        </div>
      </div>
      <div className="compare-strip">
        <button
          type="button"
          className={compareRef === null ? 'compare-btn is-on' : 'compare-btn'}
          aria-pressed={compareRef === null}
          onClick={() => setCompareRef(null)}
        >
          <GitCompare size={13} />
          关闭对比
        </button>
        {project.snapshots.slice(0, Math.max(1, currentBucket)).map((snapshot, index) => (
          <button
            type="button"
            key={snapshot.bucket}
            className={compareRef === index ? 'compare-btn is-active' : 'compare-btn'}
            aria-pressed={compareRef === index}
            onClick={() => setCompareRef(compareRef === index ? null : index)}
            title={snapshot.label}
          >
            {snapshot.label}
          </button>
        ))}
        {delta && (
          <div className="compare-delta">
            {delta.added > 0 && <span className="delta-added">+{delta.added} 新增</span>}
            {delta.removed > 0 && <span className="delta-removed">−{delta.removed} 消失</span>}
            {delta.added === 0 && delta.removed === 0 && <span className="delta-none">无变化</span>}
          </div>
        )}
      </div>
      <Suspense fallback={<div className="reference-gap-empty" role="status">正在加载参考图谱缺口</div>}>
        <ReferenceGapSection project={project} onSelectAtlas={(id) => void setReferenceAtlas(id || undefined)} />
      </Suspense>
      <Suspense fallback={<section className="exploration-workbench" aria-label="探索工作台" aria-busy="true"><p className="exploration-empty" role="status">正在加载探索工作台</p></section>}>
        <ExplorationWorkbench
          project={project}
          isLoading={isAnalyzing}
          onCommand={transitionExploration}
          onEdit={editExploration}
          onSelectNote={selectNote}
        />
      </Suspense>
      <div className="peak-index">
        {project.peaks.slice(0, 6).map((peak) => (
          <div key={peak.id}>
            <span>{peak.label}</span>
            <small>{peak.noteIds.length}</small>
          </div>
        ))}
      </div>
    </div>
  )
}

function RelationSection({ note }: { note: TerrainNote }) {
  const project = useAppStore((state) => state.project)
  const selectNote = useAppStore((state) => state.selectNote)
  const relations = resolveNoteRelations(project.notes, note.id)
  if (!relations.outgoing.length && !relations.incoming.length && !relations.unresolved.length) return null
  return <section className="relation-section"><span className="panel-kicker">OBSIDIAN RELATIONS</span>{relations.outgoing.length > 0 && <RelationList icon={<ArrowUpRight size={12} />} label="出链" notes={relations.outgoing} onSelect={selectNote} />}{relations.incoming.length > 0 && <RelationList icon={<ArrowDownLeft size={12} />} label="反链" notes={relations.incoming} onSelect={selectNote} />}{relations.unresolved.length > 0 && <div className="unresolved-links"><Link2 size={12} />未解析：{relations.unresolved.join('、')}</div>}</section>
}

function RelationList({ icon, label, notes, onSelect }: { icon: ReactNode; label: string; notes: TerrainNote[]; onSelect: (id: string) => void }) {
  return <div className="relation-group"><span>{icon}{label}</span><ul className="relation-list">{notes.slice(0, 5).map((linked) => <li key={linked.id}><button type="button" onClick={() => onSelect(linked.id)}>{linked.title}</button></li>)}</ul></div>
}

function SemanticCandidateSection({ candidates, originId, project, onWriteback }: { candidates: Array<{ note: TerrainNote; distance: number }>; originId: string; project: TerrainProject; onWriteback: (candidates: VaultWritebackCandidate[]) => void }) {
  const reportError = useAppStore((state) => state.reportError)
  const [copied, setCopied] = useState<string | null>(null)
  const copiedTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
  }, [])
  const copy = async (title: string) => {
    const ok = await copyWikiLink(title, reportError)
    if (!ok) return
    setCopied(title)
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
    copiedTimer.current = window.setTimeout(() => setCopied(null), 2400)
  }
  return <section className="relation-section semantic-candidates"><span className="panel-kicker">语义候选补链</span><small>候选只表示模型邻居或投影接近，不是显式关系；确认后再写回 Obsidian。</small><ul className="relation-list">{candidates.map(({ note }) => { const evidence = buildNoteNeighborEvidence(project, originId, note.id); const writeback = vaultWikiLinkCandidate(project, originId, note.id); return <li key={note.id}><button type="button" aria-label={`${writeback ? '预览写回' : '复制'} ${note.title} 的 WikiLink${evidence ? `；${neighborEvidenceAriaLabel(evidence)}` : ''}`} onClick={() => writeback ? onWriteback([writeback]) : void copy(note.title)}><strong>{note.title}</strong>{evidence && <NeighborEvidence evidence={evidence} />}{copied === note.title && <small>已复制 wikilink</small>}{writeback && <small>点击后预览 exact diff</small>}</button></li> })}</ul><small aria-live="polite" className={copied ? 'copy-status is-copied' : 'copy-status'}>{copied ? `已复制 [[${copied}]]。` : 'Vault 内候选会先显示 exact diff；其他来源只复制 WikiLink。'}</small></section>
}

function NeighborEvidence({ evidence }: { evidence: TerrainNeighborEvidence }) {
  return (
    <>
      <small className="similarity-reasons">Embedding：{embeddingEvidenceLabel(evidence)}</small>
      <small className="similarity-reasons">2D UMAP approximate distance：{evidence.projection.distance.toFixed(4)} · {evidence.projection.formulaVersion}（投影近似，不代表关系）</small>
      <small className="similarity-reasons">共享 taxonomy：{evidence.taxonomy.sharedLabels.length ? evidence.taxonomy.sharedLabels.join('、') : '无'}</small>
      <small className="similarity-reasons">共享 tags：{evidence.tags.sharedTags.length ? evidence.tags.sharedTags.map((tag) => `#${tag}`).join(' ') : '无'}</small>
      <small className="similarity-reasons">显式 WikiLink：{wikiLinkLabel(evidence)}</small>
      <small className="similarity-reasons">证据 IDs：{evidence.supportingIds.join('、')}</small>
    </>
  )
}

function neighborEvidenceAriaLabel(evidence: TerrainNeighborEvidence): string {
  return [
    `Embedding ${embeddingEvidenceLabel(evidence)}`,
    `2D UMAP approximate distance ${evidence.projection.distance.toFixed(4)}，${evidence.projection.formulaVersion}，投影近似不代表关系`,
    `共享 taxonomy ${evidence.taxonomy.sharedLabels.length ? evidence.taxonomy.sharedLabels.join('、') : '无'}`,
    `共享 tags ${evidence.tags.sharedTags.length ? evidence.tags.sharedTags.join('、') : '无'}`,
    `显式 WikiLink ${wikiLinkLabel(evidence)}`,
  ].join('；')
}

function embeddingEvidenceLabel(evidence: TerrainNeighborEvidence): string {
  const embedding = evidence.embedding
  const score = embedding.score === null ? '原始分数未持久化' : `cosine ${embedding.score.toFixed(4)}`
  const formula = ` · ${embedding.formulaVersion}`
  const rank = evidence.storedNeighborRank === null ? 'rank 未持久化' : `rank ${evidence.storedNeighborRank}`
  if (embedding.mode === 'fallback') {
    return `deterministic fallback · ${embedding.modelId} · ${score} · ${rank}${formula} · 非等价语义证据`
  }
  if (embedding.mode === 'demo') return `演示布局 · ${embedding.modelId} · 无原始模型分数 · ${rank}`
  return `${embedding.modelId} · ${score} · ${rank}${formula}`
}

function wikiLinkLabel(evidence: TerrainNeighborEvidence): string {
  const outgoing = evidence.wikiLink.links.some((link) => link.fromItemId === evidence.originItemId)
  const incoming = evidence.wikiLink.links.some((link) => link.toItemId === evidence.originItemId)
  if (outgoing && incoming) return '双向'
  if (outgoing) return '当前笔记 → 邻居'
  if (incoming) return '邻居 → 当前笔记'
  return '无'
}

function peakLabelSource(source: 'dominant-tag' | 'nearest-note-title' | 'stored-label'): string {
  if (source === 'dominant-tag') return '成员高频标签'
  if (source === 'nearest-note-title') return '最近成员标题'
  return '已存峰标签'
}

function snapshotCutoff(project: TerrainProject, index: number): number {
  const bucket = project.snapshots[index]?.bucket
  if (!bucket || bucket === 'empty') return Number.POSITIVE_INFINITY
  const [year, month] = bucket.split('-').map(Number)
  return Date.UTC(year, month, 1) - 1
}

function splitTags(value: string): string[] {
  return value
    .split(/[,\s|]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function splitAreas(value: string): string[] {
  return areasForNote({ areas: value.split(/[,，|\n]+/) })
}

function parseScore(value: string): number | null {
  const parsed = Number(value)
  return value.trim() && Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed / 100)) : null
}

function scoreText(value: number | undefined): string {
  return value === undefined ? '' : String(Math.round(value * 100))
}

function scoreLabel(value: number | undefined): string {
  return value === undefined ? '未标注' : `${Math.round(value * 100)}%`
}

function isNumericCognitiveObservation(
  observation: CognitiveObservation,
): observation is Extract<CognitiveObservation, { field: 'mastery' | 'confidence' | 'exploration' }> {
  return observation.field === 'mastery' || observation.field === 'confidence' || observation.field === 'exploration'
}

function compareCognitiveObservations(a: CognitiveObservation, b: CognitiveObservation): number {
  return Date.parse(a.observedAt) - Date.parse(b.observedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

function progressionHistoryLabel(historyState: ReturnType<typeof calculateProjectLearningProgression>['historyState']): string {
  if (historyState === 'missing') return '无历史：中性海拔'
  if (historyState === 'snapshot-only') return '仅当前快照：中性海拔'
  if (historyState === 'sparse') return '观测稀疏'
  if (historyState === 'stale') return '观测过期'
  if (historyState === 'conflicting') return '观测冲突：中性海拔'
  return '观测历史'
}

function cognitiveObservationFieldLabel(observation: CognitiveObservation): string {
  if (observation.field === 'mastery') return `熟练度 ${Math.round(observation.value * 100)}%`
  if (observation.field === 'confidence') return `置信度 ${Math.round(observation.value * 100)}%`
  if (observation.field === 'exploration') return `探索度 ${Math.round(observation.value * 100)}%`
  if (observation.field === 'status') return `状态 ${observation.value}`
  return `复习时间 ${formatDate(String(observation.value))}`
}

function cognitiveObservationProvenanceLabel(provenance: CognitiveObservation['provenance']): string {
  if (provenance === 'self-assessment') return '自我评估'
  if (provenance === 'yaml-import') return 'YAML 导入'
  if (provenance === 'review-outcome') return '复习结果'
  return '迁移快照'
}

function relativeActivityTime(value: string): string {
  const elapsedMs = Math.max(0, Date.now() - Date.parse(value))
  const minutes = Math.floor(elapsedMs / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return days < 30 ? `${days} 天前` : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value))
}

function activityTypeLabel(type: InteractionEventType): string {
  if (type === 'opened') return '打开'
  if (type === 'edited') return '编辑'
  if (type === 'reviewed') return '复习'
  return type
}

function provenanceLabel(provenance: 'raw-event' | 'retained-aggregate'): string {
  return provenance === 'raw-event' ? '原始事件' : '保留聚合'
}

async function copyWikiLink(title: string, reportError: (message: string) => void): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(`[[${title}]]`)
    return true
  } catch {
    reportError('无法写入剪贴板，请手动复制笔记标题')
    return false
  }
}

function formatDate(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`
}

function embeddingModeLabel(mode: TerrainProject['embeddingMode']): string {
  if (mode === 'semantic') return '语义模式'
  if (mode === 'fallback') return '降级模式'
  return '演示数据'
}
