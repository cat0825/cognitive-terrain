import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDownLeft, ArrowUpRight, BookOpen, CalendarDays, ExternalLink, Focus, GitCompare, Link2, Pencil, X } from 'lucide-react'
import type { TerrainNote, TerrainProject } from '../domain/types'
import { findNeighbors } from '../pipeline/neighbors'
import { maintenanceCandidates, resolveNoteRelations, semanticLinkCandidates } from '../domain/knowledge-maintenance'
import { useAppStore } from '../store/app-store'

interface NoteDetailProps {
  project: TerrainProject
  note: TerrainNote | undefined
  visibleCount: number
}

export function NoteDetail({ project, note, visibleCount }: NoteDetailProps) {
  const detailsOpen = useAppStore((state) => state.detailsOpen)
  const selectNote = useAppStore((state) => state.selectNote)
  const setDetailsOpen = useAppStore((state) => state.setDetailsOpen)
  if (!detailsOpen) return null

  return (
    <aside className="note-detail">
      <div className="detail-grip" aria-hidden="true" />
      <header>
        <span className="panel-kicker">
          {note ? 'SELECTED NOTE' : 'PROJECT OVERVIEW'}
          <span className={`mode-badge mode-badge--${project.embeddingMode}`}>
            {embeddingModeLabel(project.embeddingMode)}
          </span>
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭详情"
          onClick={() => {
            selectNote(null)
            setDetailsOpen(false)
          }}
        >
          <X size={16} />
        </button>
      </header>
      {note ? <NoteContent key={note.id} note={note} /> : <ProjectOverview project={project} visibleCount={visibleCount} />}
    </aside>
  )
}

function NoteContent({ note }: { note: TerrainNote }) {
  const project = useAppStore((state) => state.project)
  const selectNote = useAppStore((state) => state.selectNote)
  const requestFocus = useAppStore((state) => state.requestFocus)
  const updateNote = useAppStore((state) => state.updateNote)
  const neighbors = findNeighbors(project, note.id, 6)
  const semanticCandidates = semanticLinkCandidates(project.notes, note.id, 3)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(note.title)
  const [draftContent, setDraftContent] = useState(note.content)
  const [draftTags, setDraftTags] = useState(note.tags.join(', '))
  const [draftMastery, setDraftMastery] = useState(note.mastery === undefined ? '' : String(Math.round(note.mastery * 100)))
  const [draftConfidence, setDraftConfidence] = useState(note.confidence === undefined ? '' : String(Math.round(note.confidence * 100)))
  const [draftExploration, setDraftExploration] = useState(note.exploration === undefined ? '' : String(Math.round(note.exploration * 100)))
  const [draftStatus, setDraftStatus] = useState(note.status ?? '')
  const isAnalyzing = useAppStore((state) => state.isAnalyzing)
  const dirty = useMemo(
    () => draftTitle.trim() !== note.title || draftContent.trim() !== note.content || splitTags(draftTags).join(',') !== note.tags.join(',') || draftMastery !== scoreText(note.mastery) || draftConfidence !== scoreText(note.confidence) || draftExploration !== scoreText(note.exploration) || draftStatus !== (note.status ?? ''),
    [draftTitle, draftContent, draftTags, draftMastery, draftConfidence, draftExploration, draftStatus, note],
  )
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
        <div className="state-grid">
          <label className="edit-field"><span>熟练度 0–100</span><input inputMode="numeric" value={draftMastery} onChange={(event) => setDraftMastery(event.target.value)} placeholder="未标注" /></label>
          <label className="edit-field"><span>置信度 0–100</span><input inputMode="numeric" value={draftConfidence} onChange={(event) => setDraftConfidence(event.target.value)} placeholder="未标注" /></label>
          <label className="edit-field"><span>探索度 0–100</span><input inputMode="numeric" value={draftExploration} onChange={(event) => setDraftExploration(event.target.value)} placeholder="未标注" /></label>
          <label className="edit-field"><span>状态</span><select value={draftStatus} onChange={(event) => setDraftStatus(event.target.value)}><option value="">未标注</option><option value="seed">seed · 起点</option><option value="growing">growing · 生长中</option><option value="stable">stable · 稳定</option><option value="gap">gap · 缺口</option><option value="archived">archived · 归档</option></select></label>
        </div>
        <div className="edit-actions">
          <button
            type="button"
            className="primary-button"
            disabled={!dirty || isAnalyzing}
            onClick={async () => {
              await updateNote(note.id, { title: draftTitle, content: draftContent, tags: splitTags(draftTags), mastery: parseScore(draftMastery), confidence: parseScore(draftConfidence), exploration: parseScore(draftExploration), status: draftStatus ? draftStatus as TerrainNote['status'] : null })
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
        <small>{note.status ? `状态：${note.status}` : '尚未标注状态'}{note.area ? ` · ${note.area}` : ''}</small>
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
      </div>
      {neighbors.length > 0 && (
        <section className="neighbor-section">
          <span className="panel-kicker">相关笔记</span>
          <ul className="neighbor-list">
            {neighbors.map((neighbor) => (
              <li key={neighbor.id}>
                <button
                  type="button"
                  onClick={() => selectNote(neighbor.id)}
                >
                  <strong>{neighbor.title}</strong>
                  <small>{neighbor.tags.slice(0, 3).map((tag) => `#${tag}`).join(' ')}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <RelationSection note={note} />
      {semanticCandidates.length > 0 && <SemanticCandidateSection candidates={semanticCandidates} />}
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
  const maintenance = maintenanceCandidates(project, 5)
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
      <div className="peak-index">
        {project.peaks.slice(0, 6).map((peak) => (
          <div key={peak.id}>
            <span>{peak.label}</span>
            <small>{peak.noteIds.length}</small>
          </div>
        ))}
      </div>
      <section className="maintenance-section">
        <div className="section-heading"><span className="panel-kicker">待维护</span><small>按当前标注排序</small></div>
        <ul className="maintenance-list">
          {maintenance.map(({ note, reasons }) => <li key={note.id}><button type="button" onClick={() => useAppStore.getState().selectNote(note.id)}><strong>{note.title}</strong><small>{reasons.slice(0, 2).join(' · ')}</small></button></li>)}
        </ul>
      </section>
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

function SemanticCandidateSection({ candidates }: { candidates: Array<{ note: TerrainNote; distance: number }> }) {
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
  return <section className="relation-section semantic-candidates"><span className="panel-kicker">语义候选补链</span><small>模型投影位置接近，但当前没有明确双链</small><ul className="relation-list">{candidates.map(({ note, distance }) => <li key={note.id}><button type="button" onClick={() => void copy(note.title)}><strong>{note.title}</strong><small>{copied === note.title ? '已复制 wikilink' : `布局距离 ${(distance * 100).toFixed(1)}`}</small></button></li>)}</ul><small aria-live="polite" className={copied ? 'copy-status is-copied' : 'copy-status'}>{copied ? `已复制 [[${copied}]]，确认后再写回 Obsidian。` : '点击候选可复制 [[笔记名]]，确认后再写回 Obsidian。'}</small></section>
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

async function copyWikiLink(title: string, reportError: (message: string) => void): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(`[[${title}]]`)
    return true
  } catch {
    reportError('无法写入剪贴板，请手动复制笔记标题')
    return false
  }
}

/**
 * 有 vault 时用 Obsidian 官方的 vault + file 参数，跨 vault 才能准确定位。
 * 没有 vault 只能退回 path，由 Obsidian 自行猜测所属 vault。
 */
function obsidianUri(path: string, vault?: string): string {
  if (!vault) return `obsidian://open?path=${encodeURIComponent(path)}`
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(path.replace(/\.md$/i, ''))}`
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
