import { BookOpen, CalendarDays, ExternalLink, X } from 'lucide-react'
import type { TerrainNote, TerrainProject } from '../domain/types'
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
        <span className="panel-kicker">{note ? 'SELECTED NOTE' : 'PROJECT OVERVIEW'}</span>
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
