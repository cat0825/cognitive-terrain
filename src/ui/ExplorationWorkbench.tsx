import { CheckCircle2, Clock3, ExternalLink, FileWarning, Pencil, Play, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { evaluationTimeForProject } from '../domain/evaluation-time'
import { generateProjectExplorationSuggestions } from '../domain/exploration-loop'
import type {
  ExplorationLifecycleItem,
  ExplorationLifecycleStatus,
  ExplorationReasonCode,
  ExplorationSuggestion,
  TerrainNote,
  TerrainProject,
} from '../domain/types'

export type ExplorationWorkbenchCommand =
  | { type: 'accept' | 'start' | 'complete' | 'dismiss' | 'reject'; note?: string }
  | { type: 'snooze'; note?: string; snoozedUntil: string }

export interface ExplorationWorkbenchEdit {
  actionTitle: string
  actionDetail?: string
  userNotes?: string
}

interface ExplorationWorkbenchProps {
  project: TerrainProject
  isLoading?: boolean
  onCommand: (suggestion: ExplorationSuggestion, command: ExplorationWorkbenchCommand) => Promise<void>
  onEdit: (suggestion: ExplorationSuggestion, patch: ExplorationWorkbenchEdit) => Promise<void>
  onSelectNote: (noteId: string) => void
}

const WORKING_SET_LIMIT = 3
const EMPTY_EXPLORATION_ITEMS: readonly ExplorationLifecycleItem[] = []

export function ExplorationWorkbench({
  project,
  isLoading = false,
  onCommand,
  onEdit,
  onSelectNote,
}: ExplorationWorkbenchProps) {
  const evaluatedAt = useMemo(() => evaluationTimeForProject(project.updatedAt), [project.updatedAt])
  const suggestions = useMemo(
    () => generateProjectExplorationSuggestions(project, evaluatedAt),
    [evaluatedAt, project],
  )
  const lifecycleItems = project.explorationItems ?? EMPTY_EXPLORATION_ITEMS
  const itemsBySuggestionId = useMemo(
    () => new Map(lifecycleItems.map((item) => [item.suggestion.id, item])),
    [lifecycleItems],
  )
  const workingSet = lifecycleItems
    .filter((item) => item.status === 'accepted' || item.status === 'in-progress')
    .sort(compareLifecycleItems)
    .slice(0, WORKING_SET_LIMIT)
  const now = Date.now()
  const queue = suggestions.filter((suggestion) => {
    if (suggestion.reopenReason) return true
    const item = itemsBySuggestionId.get(suggestion.id)
    return item === undefined
      || item.status === 'proposed'
      || (item.status === 'snoozed' && (!item.snoozedUntil || Date.parse(item.snoozedUntil) <= now))
  })
  const snoozed = lifecycleItems
    .filter((item) => item.status === 'snoozed'
      && Boolean(item.snoozedUntil)
      && Date.parse(item.snoozedUntil!) > now)
    .sort(compareLifecycleItems)
  const recentDecisions = lifecycleItems
    .filter((item) => item.status === 'completed' || item.status === 'dismissed' || item.status === 'rejected')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 5)
  const [busyId, setBusyId] = useState<string | null>(null)

  const runCommand = async (suggestion: ExplorationSuggestion, command: ExplorationWorkbenchCommand) => {
    setBusyId(suggestion.id)
    try {
      await onCommand(suggestion, command)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section
      className="exploration-workbench"
      aria-label="探索工作台"
      aria-busy={isLoading || busyId !== null}
    >
      <div className="section-heading">
        <span className="panel-kicker">探索工作台</span>
        <small>{workingSet.length}/{WORKING_SET_LIMIT} 个进行中</small>
      </div>
      {!project.activeReferenceAtlasId && (
        <p className="exploration-notice" role="note">
          未选择参考图谱，不生成覆盖缺口建议；其他明确证据仍可进入队列。
        </p>
      )}
      {isLoading ? (
        <p className="exploration-empty" role="status">正在从最新证据刷新探索建议</p>
      ) : (
        <>
          <section className="exploration-group" aria-label="当前工作集">
            <div className="exploration-group__heading">
              <strong>当前工作集</strong>
              <small>接受后由你决定何时开始和完成</small>
            </div>
            {workingSet.length > 0 ? (
              <ul className="exploration-list">
                {workingSet.map((item) => (
                  <li key={item.id}>
                    <ExplorationCard
                      project={project}
                      suggestion={item.suggestion}
                      item={item}
                      busy={busyId !== null}
                      onCommand={runCommand}
                      onEdit={async (suggestion, patch) => {
                        setBusyId(suggestion.id)
                        try {
                          await onEdit(suggestion, patch)
                        } finally {
                          setBusyId(null)
                        }
                      }}
                      onSelectNote={onSelectNote}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="exploration-empty">尚未接受建议；从下方队列选择一个具体动作。</p>
            )}
          </section>

          <section className="exploration-group" aria-label="探索建议队列">
            <div className="exploration-group__heading">
              <strong>建议队列</strong>
              <small>按可解释优先级排序</small>
            </div>
            {queue.length > 0 ? (
              <ul className="exploration-list">
                {queue.map((suggestion) => (
                  <li key={suggestion.id}>
                    <ExplorationCard
                      project={project}
                      suggestion={suggestion}
                      item={itemsBySuggestionId.get(suggestion.id)}
                      busy={busyId !== null}
                      onCommand={runCommand}
                      onEdit={async (current, patch) => {
                        setBusyId(current.id)
                        try {
                          await onEdit(current, patch)
                        } finally {
                          setBusyId(null)
                        }
                      }}
                      onSelectNote={onSelectNote}
                    />
                  </li>
                ))}
              </ul>
            ) : workingSet.length === 0 ? (
              <p className="exploration-empty" role="status">当前没有需要处理的建议。</p>
            ) : (
              <p className="exploration-empty">当前队列已清空；可以继续处理工作集。</p>
            )}
          </section>

          {snoozed.length > 0 && (
            <details className="exploration-snoozed">
              <summary>稍后提醒 · {snoozed.length}</summary>
              <ul>
                {snoozed.map((item) => (
                  <li key={item.id}>
                    <strong>{item.action.title}</strong>
                    <small>{item.snoozedUntil ? `提醒时间：${formatDate(item.snoozedUntil)}` : '等待重新处理'}</small>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {recentDecisions.length > 0 && (
            <details className="exploration-snoozed exploration-history">
              <summary>最近决定 · {recentDecisions.length}</summary>
              <ul>
                {recentDecisions.map((item) => (
                  <li key={item.id} data-exploration-history-id={item.id}>
                    <strong>{item.action.title}</strong>
                    <small>{statusLabel(item.status)} · {formatDate(item.updatedAt)} · {item.history.length} 条记录</small>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  )
}

function ExplorationCard({
  project,
  suggestion,
  item,
  busy,
  onCommand,
  onEdit,
  onSelectNote,
}: {
  project: TerrainProject
  suggestion: ExplorationSuggestion
  item?: ExplorationLifecycleItem
  busy: boolean
  onCommand: (suggestion: ExplorationSuggestion, command: ExplorationWorkbenchCommand) => Promise<void>
  onEdit: (suggestion: ExplorationSuggestion, patch: ExplorationWorkbenchEdit) => Promise<void>
  onSelectNote: (noteId: string) => void
}) {
  const action = item?.action ?? suggestion.action
  const isFreshReopen = Boolean(suggestion.reopenReason)
  const displayAction = isFreshReopen ? suggestion.action : action
  const displayStatus = isFreshReopen ? 'proposed' : item?.status ?? 'proposed'
  const [editing, setEditing] = useState(false)
  const [actionTitle, setActionTitle] = useState(action.title)
  const [actionDetail, setActionDetail] = useState(action.detail ?? '')
  const [userNotes, setUserNotes] = useState(item?.userNotes ?? '')
  const source = sourceContext(project, suggestion)
  const supporting = suggestion.supportingItemIds.flatMap((id) => {
    const note = project.notes.find((candidate) => candidate.id === id)
    return note ? [note] : []
  })

  useEffect(() => {
    setActionTitle(displayAction.title)
    setActionDetail(displayAction.detail ?? '')
    setUserNotes(item?.userNotes ?? '')
  }, [displayAction.detail, displayAction.title, item?.userNotes])

  return (
    <article
      className="exploration-card"
      data-exploration-id={suggestion.id}
      data-exploration-status={displayStatus}
      data-reason-code={suggestion.reason.code}
    >
      <div className="exploration-card__heading">
        <span className={`exploration-status exploration-status--${displayStatus}`}>
          {isFreshReopen ? '新证据' : statusLabel(displayStatus)}
        </span>
        <small>{reasonLabel(suggestion.reason.code)}</small>
      </div>
      <strong className="exploration-action-title">{displayAction.title}</strong>
      {displayAction.detail && <p>{displayAction.detail}</p>}
      <details className="exploration-evidence">
        <summary>查看原因与证据</summary>
        <div>
          <p>{suggestion.reason.detail}</p>
          {suggestion.referenceBoundary && (
            <small>
              参考边界：{suggestion.referenceBoundary.label ?? suggestion.referenceBoundary.taxonomyNodeId}
              {suggestion.referenceBoundary.taxonomyVersion !== undefined
                ? ` · taxonomy v${suggestion.referenceBoundary.taxonomyVersion}`
                : ''}
            </small>
          )}
          {suggestion.reopenReason && suggestion.previousDecision && (
            <small>
              新证据与上次指纹不同；上次决定为“{statusLabel(suggestion.previousDecision.status)}”
              （{formatDate(suggestion.previousDecision.decidedAt)}）。这里只说明证据变化，不声明由上次动作导致。
            </small>
          )}
          <div className="exploration-supporting" aria-label="支持项">
            {supporting.length > 0 ? supporting.map((note) => (
              <button
                type="button"
                key={note.id}
                data-supporting-item-id={note.id}
                onClick={() => onSelectNote(note.id)}
              >
                {note.title}
              </button>
            )) : <small>暂无本地支持项</small>}
          </div>
          <SourceReturn source={source} onSelectNote={onSelectNote} />
          {item && item.history.length > 0 && (
            <details className="exploration-decision-history">
              <summary>决定历史 · {item.history.length}</summary>
              <ol>
                {item.history.slice(-5).map((event) => (
                  <li key={event.id}>{statusLabel(event.toStatus)} · {formatDate(event.occurredAt)}</li>
                ))}
              </ol>
            </details>
          )}
        </div>
      </details>

      {editing && item && !isFreshReopen && (
        <div className="exploration-editor">
          <label>
            <span>下一步动作</span>
            <input value={actionTitle} onChange={(event) => setActionTitle(event.target.value)} />
          </label>
          <label>
            <span>动作说明</span>
            <textarea rows={2} value={actionDetail} onChange={(event) => setActionDetail(event.target.value)} />
          </label>
          <label>
            <span>个人记录</span>
            <textarea rows={2} value={userNotes} onChange={(event) => setUserNotes(event.target.value)} />
          </label>
          <div className="exploration-editor__actions">
            <button
              type="button"
              className="primary-button"
              disabled={busy || !actionTitle.trim()}
              onClick={async () => {
                await onEdit(suggestion, {
                  actionTitle: actionTitle.trim(),
                  actionDetail: actionDetail.trim() || undefined,
                  userNotes: userNotes.trim() || undefined,
                })
                setEditing(false)
              }}
            >
              保存动作
            </button>
            <button type="button" className="icon-button" disabled={busy} onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      )}

      <div className="exploration-card__actions">
        {!item || item.status === 'proposed' || item.status === 'snoozed' || isFreshReopen ? (
          <button type="button" className="primary-button" disabled={busy} onClick={() => onCommand(suggestion, { type: 'accept' })}>
            <CheckCircle2 size={12} />接受建议
          </button>
        ) : item.status === 'accepted' ? (
          <button type="button" className="primary-button" disabled={busy} onClick={() => onCommand(suggestion, { type: 'start' })}>
            <Play size={12} />开始处理
          </button>
        ) : item.status === 'in-progress' ? (
          <button type="button" className="primary-button" disabled={busy} onClick={() => onCommand(suggestion, { type: 'complete' })}>
            <CheckCircle2 size={12} />标记完成
          </button>
        ) : null}
        {item && !isFreshReopen && (item.status === 'accepted' || item.status === 'in-progress') && (
          <button type="button" disabled={busy} onClick={() => setEditing((value) => !value)}>
            <Pencil size={12} />编辑动作
          </button>
        )}
        {(!item || isFreshReopen || item.status === 'proposed' || item.status === 'accepted' || item.status === 'in-progress') && (
          <>
            <button type="button" disabled={busy} onClick={() => onCommand(suggestion, { type: 'snooze', snoozedUntil: inSevenDays() })}>
              <Clock3 size={12} />7 天后提醒
            </button>
            <button type="button" disabled={busy} onClick={() => onCommand(suggestion, { type: 'dismiss' })}>
              <X size={12} />忽略建议
            </button>
            <button type="button" disabled={busy} onClick={() => onCommand(suggestion, { type: 'reject' })}>
              拒绝建议
            </button>
          </>
        )}
      </div>
    </article>
  )
}

type SourceContext =
  | { state: 'available'; note: TerrainNote; href: string; external: boolean }
  | { state: 'local-only'; note: TerrainNote }
  | { state: 'reference'; label: string; taxonomyNodeId: string }
  | { state: 'unavailable'; detail: string }

function sourceContext(project: TerrainProject, suggestion: ExplorationSuggestion): SourceContext {
  const route = suggestion.sourceRoute
  if (route.kind === 'unavailable') {
    return { state: 'unavailable', detail: route.detail ?? '来源已不可用，可能已移除或失去访问权限。' }
  }
  if (route.kind === 'reference-node') {
    return {
      state: 'reference',
      label: suggestion.referenceBoundary?.label ?? route.taxonomyNodeId,
      taxonomyNodeId: route.taxonomyNodeId,
    }
  }
  const noteId = route.kind === 'note'
    ? route.noteId
    : route.kind === 'relationship'
      ? route.fromItemId
      : route.noteId
  const note = noteId ? project.notes.find((candidate) => candidate.id === noteId) : undefined
  if (!note) return { state: 'unavailable', detail: '来源已不可用，可能已移除或失去访问权限。' }
  if (note.source && /^https?:\/\//i.test(note.source)) {
    return { state: 'available', note, href: note.source, external: true }
  }
  if (note.sourcePath) {
    return { state: 'available', note, href: obsidianUri(note.sourcePath, note.vault), external: false }
  }
  return { state: 'local-only', note }
}

function SourceReturn({ source, onSelectNote }: { source: SourceContext; onSelectNote: (noteId: string) => void }) {
  if (source.state === 'available') {
    return (
      <div className="exploration-source-actions">
        <button type="button" onClick={() => onSelectNote(source.note.id)}>查看来源上下文</button>
        <a href={source.href} target={source.external ? '_blank' : undefined} rel={source.external ? 'noreferrer' : undefined}>
          {source.external ? '打开原始来源' : '在 Obsidian 中打开'} <ExternalLink size={11} />
        </a>
        {!source.external && (
          <span className="exploration-source-warning">
            浏览器无法预检 Obsidian 权限；回跳失败时请重新授权或导入。
          </span>
        )}
      </div>
    )
  }
  if (source.state === 'local-only') {
    return (
      <div className="exploration-source-actions">
        <button type="button" onClick={() => onSelectNote(source.note.id)}>查看来源上下文</button>
        <span className="exploration-source-warning"><FileWarning size={11} />未记录源路径，无法回跳 Obsidian</span>
      </div>
    )
  }
  if (source.state === 'reference') {
    return (
      <button type="button" className="exploration-reference-route" onClick={() => focusReferenceNode(source.taxonomyNodeId)}>
        查看参考边界：{source.label}
      </button>
    )
  }
  return <span className="exploration-source-warning" role="status"><FileWarning size={11} />{source.detail}</span>
}

function focusReferenceNode(nodeId: string): void {
  const target = [...document.querySelectorAll<HTMLElement>('[data-reference-node-id]')]
    .find((element) => element.dataset.referenceNodeId === nodeId)
    ?.querySelector<HTMLElement>('summary')
  if (!target) return
  target.scrollIntoView({ block: 'nearest' })
  target.focus()
}

function compareLifecycleItems(a: ExplorationLifecycleItem, b: ExplorationLifecycleItem): number {
  return b.suggestion.priority - a.suggestion.priority
    || a.updatedAt.localeCompare(b.updatedAt)
    || a.id.localeCompare(b.id)
}

function statusLabel(status: ExplorationLifecycleStatus): string {
  if (status === 'accepted') return '已接受'
  if (status === 'in-progress') return '进行中'
  if (status === 'completed') return '已完成'
  if (status === 'snoozed') return '稍后提醒'
  if (status === 'dismissed') return '已忽略'
  if (status === 'rejected') return '已拒绝'
  return '建议'
}

function reasonLabel(reason: ExplorationReasonCode): string {
  if (reason === 'reference-gap') return '参考相对缺口'
  if (reason === 'stale-reviewed-item') return '明确复习已过期'
  if (reason === 'unresolved-bridge') return '未解析关系'
  if (reason === 'unassessed-note') return '尚未自评'
  if (reason === 'low-confidence-note') return '自评置信度偏低'
  return '用户标记目标'
}

function obsidianUri(path: string, vault?: string): string {
  if (!vault) return `obsidian://open?path=${encodeURIComponent(path)}`
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(path.replace(/\.md$/i, ''))}`
}

function inSevenDays(): string {
  return new Date(Date.now() + 7 * 86_400_000).toISOString()
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(date)
    : value
}
