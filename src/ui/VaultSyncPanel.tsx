import { AlertTriangle, Check, FolderOpen, LoaderCircle, RefreshCw, ShieldAlert, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { VaultSyncPreview, VaultSyncResolution } from '../domain/vault-sync'
import { scanVaultFiles } from '../import/vault-sync'
import { useAppStore } from '../store/app-store'

interface VaultSyncPanelProps {
  open: boolean
  onClose: () => void
}

type SyncPhase = 'idle' | 'scanning' | 'preview' | 'applying' | 'done' | 'permission'
type ResolutionChoice = VaultSyncResolution['choice']

const directoryAttributes: Record<string, string> = { webkitdirectory: '', directory: '' }
const markdownExtensions = ['.md', '.markdown']

export function VaultSyncPanel({ open, onClose }: VaultSyncPanelProps) {
  const project = useAppStore((state) => state.project)
  const applyVaultSync = useAppStore((state) => state.applyVaultSync)
  const [phase, setPhase] = useState<SyncPhase>('idle')
  const [preview, setPreview] = useState<VaultSyncPreview | null>(null)
  const [resolutions, setResolutions] = useState<Record<string, ResolutionChoice | ''>>({})
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const panelRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const busyRef = useRef(false)
  const onCloseRef = useRef(onClose)
  const busy = phase === 'scanning' || phase === 'applying'

  busyRef.current = busy
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    setPhase('idle')
    setPreview(null)
    setResolutions({})
    setError('')
    setStatus('')
    const activeElement = document.activeElement
    returnFocus.current = activeElement instanceof HTMLElement && activeElement !== document.body
      ? activeElement
      : document.querySelector<HTMLElement>('[aria-label="打开项目菜单"]')
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (busyRef.current) return
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = focusableElements(panelRef.current)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable.at(-1) ?? first
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
      const target = returnFocus.current
      window.requestAnimationFrame(() => {
        if (target?.isConnected) target.focus()
        else document.getElementById('terrain-export-source')?.focus()
      })
    }
  }, [open])

  const counts = useMemo(() => {
    const value = { added: 0, modified: 0, renamed: 0, removed: 0 }
    for (const change of preview?.changes ?? []) value[change.kind] += 1
    return value
  }, [preview])
  const blockingConflicts = preview?.conflicts.filter(isBlockingConflict) ?? []
  const unresolvedCount = preview?.conflicts.filter((conflict) => !isBlockingConflict(conflict) && !resolutions[conflict.id]).length ?? 0
  const changeCount = preview?.changes.length ?? 0
  const canApply = Boolean(preview && blockingConflicts.length === 0 && (preview.bootstrap || changeCount > 0))

  if (!open) return null

  const close = () => {
    if (!busy) onClose()
  }

  const scanFiles = async (files: File[]) => {
    const markdown = files.filter((file) => markdownExtensions.some((extension) => file.name.toLowerCase().endsWith(extension)))
    setError('')
    setStatus('')
    setPreview(null)
    setResolutions({})
    if (!markdown.length) {
      setError('所选文件夹里没有 Markdown 笔记。')
      return
    }
    setPhase('scanning')
    try {
      const nextPreview = await scanVaultFiles(markdown, project)
      setPreview(nextPreview)
      setResolutions(Object.fromEntries(nextPreview.conflicts.map((conflict) => [conflict.id, ''])))
      setPhase('preview')
    } catch (scanError) {
      const message = errorMessage(scanError)
      const permissionLost = isPermissionError(scanError, message)
      setPhase(permissionLost ? 'permission' : 'idle')
      setError(permissionLost
        ? '浏览器无法继续读取这个 vault。请重新授权，或重新选择同一个文件夹。'
        : `扫描失败：${message}`)
    }
  }

  const confirm = async () => {
    if (!preview || blockingConflicts.length > 0 || unresolvedCount > 0 || !canApply) return
    const accepted: VaultSyncResolution[] = preview.conflicts.filter((conflict) => !isBlockingConflict(conflict)).map((conflict) => ({
      conflictId: conflict.id,
      choice: resolutions[conflict.id] as ResolutionChoice,
    }))
    setPhase('applying')
    setError('')
    setStatus('')
    try {
      const applied = await applyVaultSync(preview, accepted)
      if (!applied) {
        setPhase('preview')
        setError('同步未应用。项目可能已变化，请重新扫描 vault。')
        return
      }
      setPhase('done')
      setStatus(preview.bootstrap && changeCount === 0
        ? '已建立 vault 同步基线，并保留现有项目内容。'
        : `已同步 ${changeCount} 项变更，并在提交前创建恢复点。`)
    } catch (applyError) {
      setPhase('preview')
      setError(`同步失败：${errorMessage(applyError)}。提交前的项目仍可恢复。`)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={close}>
      <section
        ref={panelRef}
        className="import-panel vault-sync-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vault-sync-title"
        aria-describedby="vault-sync-description"
        aria-busy={busy}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="panel-kicker">LOCAL-FIRST SYNC</span>
            <h2 id="vault-sync-title">同步 Obsidian vault</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="icon-button"
            aria-label="关闭 vault 同步"
            disabled={busy}
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>

        <p id="vault-sync-description" className="vault-sync-description">
          重新选择 vault 后先生成变更预览；确认前不会修改项目，所有文件仍只在本机读取。
        </p>

        {(phase === 'idle' || phase === 'permission') && (
          <div className="import-folder vault-sync-picker">
            <button type="button" className="focus-button" onClick={() => folderRef.current?.click()}>
              {phase === 'permission' ? <RefreshCw size={14} /> : <FolderOpen size={14} />}
              {phase === 'permission' ? '重新授权 vault' : '选择 Obsidian vault'}
            </button>
            <small>若浏览器不能保留文件夹权限，每次同步都需要重新选择同一个 vault。</small>
          </div>
        )}

        <input
          ref={folderRef}
          className="vault-sync-input"
          type="file"
          multiple
          {...directoryAttributes}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            if (files.length) void scanFiles(files)
          }}
        />

        {phase === 'scanning' && (
          <div className="vault-sync-feedback" role="status" aria-live="polite">
            <LoaderCircle className="spin" size={15} />
            正在扫描 vault 并比较本地项目
          </div>
        )}

        {preview && phase !== 'done' && (
          <div className="vault-sync-preview">
            <div className="vault-sync-preview-heading">
              <div>
                <strong>{preview.vaultName}</strong>
                <small>{preview.bootstrap ? '首次建立同步基线' : '增量同步预览'}</small>
              </div>
              <button type="button" className="vault-sync-rescan" disabled={busy} onClick={() => folderRef.current?.click()}>
                <RefreshCw size={12} />
                重新扫描
              </button>
            </div>

            <dl className="vault-sync-counts" aria-label="vault 变更统计">
              <SyncCount label="新增" value={counts.added} tone="added" />
              <SyncCount label="修改" value={counts.modified} tone="modified" />
              <SyncCount label="重命名" value={counts.renamed} tone="renamed" />
              <SyncCount label="移除" value={counts.removed} tone="removed" />
              <SyncCount label="冲突" value={preview.conflicts.length} tone="conflict" />
              <SyncCount label="未变化" value={preview.unchangedCount} tone="unchanged" />
            </dl>

            {!preview.complete && (
              <div className="vault-sync-feedback is-warning" role="alert">
                <ShieldAlert size={14} />
                扫描不完整；无法读取的文件不会被当作删除，仍可应用下方有效变更。
              </div>
            )}

            {preview.changes.length > 0 && (
              <details className="vault-sync-changes" open>
                <summary>{preview.changes.length} 项待同步变更</summary>
                <ul tabIndex={0} aria-label="待同步变更列表">
                  {preview.changes.map((change) => (
                    <li key={change.id}>
                      <span className={`is-${change.kind}`}>{changeLabel(change.kind)}</span>
                      <strong>{change.path}</strong>
                      {change.previousPath && <small>原路径：{change.previousPath}</small>}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {preview.conflicts.length > 0 && (
              <section className="vault-sync-conflicts" aria-labelledby="vault-sync-conflicts-title">
                <div className="vault-sync-section-heading">
                  <strong id="vault-sync-conflicts-title">解决冲突</strong>
                  <small>{blockingConflicts.length > 0
                    ? `${blockingConflicts.length} 项阻止同步`
                    : unresolvedCount > 0
                      ? `还有 ${unresolvedCount} 项未选择`
                      : '全部已解决'}</small>
                </div>
                {blockingConflicts.length > 0 && (
                  <div className="vault-sync-feedback is-warning" role="alert">
                    <ShieldAlert size={14} />
                    <span>存在路径或身份冲突，修正 vault 后重新扫描。</span>
                  </div>
                )}
                <ul>
                  {preview.conflicts.map((conflict) => (
                    <li key={conflict.id}>
                      {isBlockingConflict(conflict) ? (
                        <div className="vault-sync-conflict-row">
                          <span className="vault-sync-conflict-copy">
                            <strong>{conflict.path}</strong>
                            <small>{conflict.detail}</small>
                          </span>
                          <span className="vault-sync-conflict-blocker" role="status">
                            <ShieldAlert size={13} />
                            修正 vault 后重新扫描
                          </span>
                        </div>
                      ) : (
                        <label>
                        <span>
                          <strong>{conflict.path}</strong>
                          <small>{conflict.field ? `${conflict.field} · ${conflict.detail}` : conflict.detail}</small>
                        </span>
                        <select
                          value={resolutions[conflict.id] ?? ''}
                          aria-label={`解决 ${conflict.path} 的冲突`}
                          disabled={busy}
                          onChange={(event) => setResolutions((current) => ({
                            ...current,
                            [conflict.id]: event.target.value as ResolutionChoice | '',
                          }))}
                        >
                          <option value="">请选择</option>
                          <option value="app">保留应用内版本</option>
                          <option value="source">采用 vault 版本</option>
                        </select>
                        </label>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {preview.issues.length > 0 && (
              <details className="vault-sync-issues" open={!preview.complete}>
                <summary><AlertTriangle size={13} />{preview.issues.length} 条扫描问题</summary>
                <ul tabIndex={0} aria-label="vault 扫描问题列表">
                  {preview.issues.map((issue, index) => (
                    <li key={`${issue.file}-${issue.row ?? 0}-${issue.field ?? ''}-${index}`}>
                      <strong>{issue.file}</strong>
                      <span>{[issue.row ? `第 ${issue.row} 行` : '', issue.field, issue.message].filter(Boolean).join(' · ')}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {!changeCount && (
              <div className="vault-sync-feedback" role="status">
                <Check size={14} />
                {preview.bootstrap
                  ? 'vault 与当前项目内容一致；确认后建立同步基线。'
                  : 'vault 与当前项目一致，无需应用变更。'}
              </div>
            )}

            <div className="vault-sync-actions">
              <button
                type="button"
                className="primary-button"
                disabled={busy || unresolvedCount > 0 || blockingConflicts.length > 0 || !canApply}
                onClick={() => void confirm()}
              >
                {phase === 'applying' ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
                {phase === 'applying'
                  ? '正在应用变更'
                  : preview.bootstrap && changeCount === 0
                    ? '建立同步基线'
                    : `确认同步 ${changeCount} 项`}
              </button>
              <button type="button" className="vault-sync-cancel" disabled={busy} onClick={close}>取消</button>
            </div>
          </div>
        )}

        {error && (
          <div className="vault-sync-feedback is-error" role="alert">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        {phase === 'done' && (
          <div className="vault-sync-complete" role="status" aria-live="polite">
            <Check size={18} />
            <strong>vault 同步完成</strong>
            <span>{status}</span>
            <button type="button" className="primary-button" onClick={close}>完成</button>
          </div>
        )}
      </section>
    </div>
  )
}

export default VaultSyncPanel

function SyncCount({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className={`is-${tone}`}><dt>{label}</dt><dd>{value}</dd></div>
}

function changeLabel(kind: VaultSyncPreview['changes'][number]['kind']): string {
  if (kind === 'added') return '新增'
  if (kind === 'modified') return '修改'
  if (kind === 'renamed') return '重命名'
  return '移除'
}

function isBlockingConflict(conflict: VaultSyncPreview['conflicts'][number]): boolean {
  return conflict.kind === 'path-collision' || conflict.kind === 'ambiguous-rename'
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'))
    .filter((element) => element.offsetParent !== null)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isPermissionError(error: unknown, message: string): boolean {
  const name = error instanceof DOMException ? error.name : ''
  return name === 'NotAllowedError' || name === 'SecurityError' || /permission|权限|授权/iu.test(message)
}
