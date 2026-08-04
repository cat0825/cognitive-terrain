import { useMemo, useState } from 'react'
import { BookOpen, CalendarDays, ExternalLink, Focus, GitCompare, Pencil, X } from 'lucide-react'
import type { TerrainNote, TerrainProject } from '../domain/types'
import { findNeighbors } from '../pipeline/neighbors'
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
      {note ? <NoteContent note={note} /> : <ProjectOverview project={project} visibleCount={visibleCount} />}
    </aside>
  )
}

function NoteContent({ note }: { note: TerrainNote }) {
  const project = useAppStore((state) => state.project)
  const selectNote = useAppStore((state) => state.selectNote)
  const requestFocus = useAppStore((state) => state.requestFocus)
  const updateNote = useAppStore((state) => state.updateNote)
  const neighbors = findNeighbors(project, note.id, 6)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(note.title)
  const [draftContent, setDraftContent] = useState(note.content)
  const [draftTags, setDraftTags] = useState(note.tags.join(', '))
  const isAnalyzing = useAppStore((state) => state.isAnalyzing)
  const dirty = useMemo(
    () => draftTitle.trim() !== note.title || draftContent.trim() !== note.content || splitTags(draftTags).join(',') !== note.tags.join(','),
    [draftTitle, draftContent, draftTags, note],
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
        <div className="edit-actions">
          <button
            type="button"
            className="primary-button"
            disabled={!dirty || isAnalyzing}
            onClick={async () => {
              await updateNote(note.id, { title: draftTitle, content: draftContent, tags: splitTags(draftTags) })
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
      {note.source?.startsWith('http') && (
        <a href={note.source} target="_blank" rel="noreferrer">
          打开来源
          <ExternalLink size={13} />
        </a>
      )}
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
    </div>
  )
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
