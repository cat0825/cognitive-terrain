import {
  AlertTriangle,
  Check,
  FileDiff,
  FolderOpen,
  LoaderCircle,
  RotateCcw,
  ShieldAlert,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  vaultWritebackCandidates,
  type VaultWritebackCandidate,
} from '../domain/vault-writeback-candidates'
import {
  commitVaultWriteback,
  type VaultWritebackCommittedFile,
} from '../domain/vault-writeback-commit'
import {
  buildVaultWritebackPreview,
  type VaultWritebackEntry,
  type VaultWritebackFileResult,
  type VaultWritebackPreview,
  type VaultWritebackReadFile,
} from '../domain/vault-writeback'
import {
  ensureVaultReadWritePermission,
  pickVaultDirectoryForWrite,
  readVaultFileBytes,
  writeVaultFileBytes,
} from '../import/vault-file-access'
import {
  markVaultWritebackRecoveryBatchInProgress,
  getVaultWritebackRecoveryFile,
  listVaultWritebackRecoveryBatches,
  prepareVaultWritebackRecoveryBatch,
  updateVaultWritebackRecoveryOutcomes,
  type VaultWritebackRecoveryBatch,
} from '../storage/vault-writeback-repository'
import { useAppStore } from '../store/app-store'

export interface VaultWritebackPanelProps {
  open: boolean
  onClose: () => void
  seedCandidates?: VaultWritebackCandidate[]
}

type WritebackPhase = 'selecting' | 'authorizing' | 'preview' | 'bulk-confirm' | 'writing' | 'results'

interface PlannedFileWrite {
  sourceId: string
  path: string
  entries: VaultWritebackEntry[]
  original: VaultWritebackReadFile
  afterText: string
  afterByteHash: string
}

const diffStyle: CSSProperties = {
  maxHeight: 180,
  margin: '7px 0 0',
  padding: 8,
  overflow: 'auto',
  border: '1px solid #30302e',
  borderRadius: 3,
  color: '#bdbdb8',
  background: '#151515',
  font: '8px/1.5 var(--mono)',
  whiteSpace: 'pre',
}

const candidateLabelStyle: CSSProperties = {
  minWidth: 0,
  display: 'grid',
  gridTemplateColumns: '18px minmax(0, 1fr)',
  alignItems: 'start',
  gap: 8,
  padding: '7px 8px',
  background: '#1d1d1c',
  cursor: 'pointer',
}

export function VaultWritebackPanel({ open, onClose, seedCandidates }: VaultWritebackPanelProps) {
  const project = useAppStore((state) => state.project)
  const commitVaultWritebackProject = useAppStore((state) => state.commitVaultWritebackProject)
  const reportError = useAppStore((state) => state.reportError)
  const candidates = useMemo(
    () => dedupeCandidates(seedCandidates ?? vaultWritebackCandidates(project)),
    [project, seedCandidates],
  )
  const [phase, setPhase] = useState<WritebackPhase>('selecting')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectingBusy, setSelectingBusy] = useState(false)
  const [directory, setDirectory] = useState<FileSystemDirectoryHandle | null>(null)
  const [preview, setPreview] = useState<VaultWritebackPreview | null>(null)
  const [previewFiles, setPreviewFiles] = useState<Map<string, VaultWritebackReadFile>>(new Map())
  const [results, setResults] = useState<VaultWritebackFileResult[]>([])
  const [recoveryBatchId, setRecoveryBatchId] = useState('')
  const [recoveryHistory, setRecoveryHistory] = useState<VaultWritebackRecoveryBatch[]>([])
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const panelRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const phaseActionRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const writingRef = useRef(false)
  const executionRef = useRef(false)
  const onCloseRef = useRef(onClose)
  const writing = phase === 'writing'

  writingRef.current = writing
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    setPhase('selecting')
    setSelectedIds(new Set(seedCandidates?.map((candidate) => candidate.request.id) ?? []))
    setSelectingBusy(false)
    setDirectory(null)
    setPreview(null)
    setPreviewFiles(new Map())
    setResults([])
    setRecoveryBatchId('')
    setRecoveryHistory([])
    setError('')
    setStatus('')
    executionRef.current = false
    const activeElement = document.activeElement
    returnFocus.current = activeElement instanceof HTMLElement && activeElement !== document.body
      ? activeElement
      : document.querySelector<HTMLElement>('[aria-label="打开项目菜单"]')
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())
    void listVaultWritebackRecoveryBatches(project.id)
      .then((batches) => setRecoveryHistory(batches.slice(0, 5)))
      .catch(() => undefined)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (writingRef.current) return
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
  }, [open, project.id, seedCandidates])

  useEffect(() => {
    if (!open || (phase !== 'bulk-confirm' && phase !== 'results')) return
    const frame = window.requestAnimationFrame(() => phaseActionRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open, phase])

  const selected = candidates.filter((candidate) => selectedIds.has(candidate.request.id))
  const selectedVaultIds = new Set(selected.flatMap((candidate) => {
    const vaultId = project.vaultSync?.sources.find((source) => source.sourceId === candidate.request.sourceId)?.vaultId
    return vaultId ? [vaultId] : []
  }))
  const selectedVault = selectedVaultIds.size === 1
    ? project.vaultSync?.vaults.find((vault) => vault.vaultId === [...selectedVaultIds][0])
    : undefined
  const executableEntries = preview?.entries.filter((entry) => entry.status !== 'blocked') ?? []
  const blockedEntries = preview?.entries.filter((entry) => entry.status === 'blocked') ?? []
  const affectedFileCount = new Set(executableEntries.map((entry) => entry.sourceId)).size
  const canPreview = selected.length > 0 && selectedVaultIds.size === 1 && !selectingBusy
  const canWrite = Boolean(preview && executableEntries.length > 0 && blockedEntries.length === 0)

  if (!open) return null

  const close = () => {
    if (!writing) onClose()
  }

  const toggleCandidate = (requestId: string) => {
    if (selectingBusy) return
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(requestId)) next.delete(requestId)
      else next.add(requestId)
      return next
    })
  }

  const selectVaultAndPreview = async () => {
    if (!canPreview) return
    setSelectingBusy(true)
    setError('')
    setStatus('')
    setPreview(null)
    setPreviewFiles(new Map())
    try {
      const picked = await pickVaultDirectoryForWrite()
      setPhase('authorizing')
      await ensureVaultReadWritePermission(picked)
      const sourceById = new Map((project.vaultSync?.sources ?? []).map((source) => [source.sourceId, source]))
      const sourceIds = [...new Set(selected.map((candidate) => candidate.request.sourceId))]
      const files = await Promise.all(sourceIds.map(async (sourceId): Promise<VaultWritebackReadFile> => {
        const source = sourceById.get(sourceId)
        if (!source || source.status !== 'present') throw new Error(`写回 source 不存在或已移除：${sourceId}`)
        const file = await readVaultFileBytes(picked, source.relativePath)
        return { sourceId, ...file }
      }))
      const nextPreview = await buildVaultWritebackPreview(
        project,
        files,
        selected.map((candidate) => candidate.request),
        new Date().toISOString(),
      )
      setDirectory(picked)
      setPreviewFiles(new Map(files.map((file) => [file.sourceId, file])))
      setPreview(nextPreview)
      setPhase('preview')
    } catch (selectionError) {
      const message = errorMessage(selectionError)
      setPhase('selecting')
      setError(`无法生成写回预览：${message}`)
      reportError(`vault 写回预览失败：${message}`)
    } finally {
      setSelectingBusy(false)
    }
  }

  const beginConfirmation = () => {
    if (!canWrite) return
    if (affectedFileCount > 1) {
      setPhase('bulk-confirm')
      return
    }
    void executeWriteback()
  }

  const executeWriteback = async () => {
    if (!preview || !directory || !canWrite || executionRef.current) return
    executionRef.current = true
    const activePreview = preview
    const activeDirectory = directory
    const requests = selected.map((candidate) => candidate.request)
    const planned = planFileWrites(activePreview, previewFiles)
    const initialResults: VaultWritebackFileResult[] = executableEntries.map((entry) => ({
      requestId: entry.requestId,
      sourceId: entry.sourceId,
      path: entry.path,
      status: 'not-attempted',
    }))
    setPhase('writing')
    setError('')
    setStatus('正在复核全部文件，尚未写入。')
    setResults(initialResults)
    setRecoveryBatchId('')

    let batchId = ''
    let writebackStarted = false
    const outcomes = initialResults.map((result) => ({ ...result }))
    const committed: VaultWritebackCommittedFile[] = []
    try {
      if (project.id !== activePreview.projectId || project.updatedAt !== activePreview.baseProjectUpdatedAt) {
        throw new Error('项目已变化，请重新生成写回预览')
      }
      await ensureVaultReadWritePermission(activeDirectory)
      const preflight = await Promise.all(planned.map((file) => readVaultFileBytes(activeDirectory, file.path)))
      for (let index = 0; index < planned.length; index += 1) {
        if (preflight[index].byteHash !== planned[index].original.byteHash) {
          throw new Error(`文件已被外部修改，已取消整批写入：${planned[index].path}`)
        }
      }

      setStatus('全部文件版本一致，正在保存本地恢复材料。')
      const batch = await prepareVaultWritebackRecoveryBatch({
        workspaceId: project.id,
        vaultId: activePreview.vaultId,
        previewId: activePreview.id,
        entries: planned.flatMap((file) => file.entries.map((entry) => ({
          requestId: entry.requestId,
          sourceId: file.sourceId,
          path: file.path,
          beforeByteHash: file.original.byteHash,
          originalBytes: file.original.bytes,
        }))),
      })
      batchId = batch.id
      setRecoveryBatchId(batch.id)
      setResults((current) => current.map((result) => ({ ...result, backupId: batch.id })))
      await markVaultWritebackRecoveryBatchInProgress(batch.id)

      for (const outcome of outcomes) outcome.backupId = batch.id
      let operationFailure = ''

      for (let fileIndex = 0; fileIndex < planned.length; fileIndex += 1) {
        const file = planned[fileIndex]
        setStatus(`正在写入 ${fileIndex + 1}/${planned.length}：${file.path}`)
        let physicalSuccess = false
        try {
          const expectedBytes = new TextEncoder().encode(file.afterText)
          const unchanged = file.afterByteHash === file.original.byteHash && sameBytes(expectedBytes, file.original.bytes)
          if (!unchanged) writebackStarted = true
          const written = unchanged
            ? { bytes: file.original.bytes, byteHash: file.original.byteHash }
            : await writeVaultFileBytes(activeDirectory, file.path, expectedBytes)
          if (written.byteHash !== file.afterByteHash || !sameBytes(written.bytes, expectedBytes)) {
            throw new Error(`写后校验失败：${file.path}`)
          }
          committed.push({
            sourceId: file.sourceId,
            path: file.path,
            beforeByteHash: file.original.byteHash,
            afterByteHash: written.byteHash,
            afterText: file.afterText,
            size: written.bytes.byteLength,
            requestIds: file.entries.map((entry) => entry.requestId),
          })
          physicalSuccess = true
          for (const entry of file.entries) {
            setOutcome(outcomes, entry.requestId, 'succeeded')
          }
          await updateVaultWritebackRecoveryOutcomes(batch.id, file.entries.map((entry) => ({
              requestId: entry.requestId,
              sourceId: entry.sourceId,
              path: entry.path,
              status: 'succeeded',
          })))
          setResults(outcomes.map((result) => ({ ...result })))
        } catch (writeError) {
          const message = errorMessage(writeError)
          operationFailure = `${file.path}：${message}`
          if (physicalSuccess) {
            // The bytes are already on disk; keep the result truthful and stop before touching another file.
            for (const entry of file.entries) setOutcome(outcomes, entry.requestId, 'succeeded')
            setResults(outcomes.map((result) => ({ ...result })))
            break
          }
          const pendingEntries = file.entries.filter((entry) => (
            outcomes.find((outcome) => outcome.requestId === entry.requestId)?.status === 'not-attempted'
          ))
          if (pendingEntries.length > 0) {
            for (const entry of pendingEntries) setOutcome(outcomes, entry.requestId, 'failed', message)
            await updateVaultWritebackRecoveryOutcomes(batch.id, pendingEntries.map((entry) => ({
              requestId: entry.requestId,
              sourceId: entry.sourceId,
              path: entry.path,
              status: 'failed',
              error: message,
            }))).catch(() => undefined)
          }
          setResults(outcomes.map((result) => ({ ...result })))
          break
        }
      }

      if (committed.length > 0) {
        const acceptedAt = new Date().toISOString()
        const committedRequestIds = new Set(committed.flatMap((file) => file.requestIds))
        const committedProject = commitVaultWriteback(
          project,
          requests.filter((request) => committedRequestIds.has(request.id)),
          committed,
          acceptedAt,
        )
        await commitVaultWritebackProject(project, committedProject)
      }

      const succeeded = outcomes.filter((outcome) => outcome.status === 'succeeded').length
      const failed = outcomes.filter((outcome) => outcome.status === 'failed').length
      const untouched = outcomes.length - succeeded - failed
      setResults(outcomes)
      setStatus(operationFailure
        ? `写回已停止：成功 ${succeeded} 项，失败 ${failed} 项，未尝试 ${untouched} 项。${operationFailure}`
        : `写回完成：成功 ${succeeded} 项。`)
      setError(operationFailure)
      if (operationFailure) reportError(`vault 写回部分失败：${operationFailure}`)
      setPhase('results')
    } catch (writebackError) {
      const message = errorMessage(writebackError)
      if (writebackStarted || committed.length > 0) {
        setResults(outcomes)
        setPhase('results')
        setStatus(`文件已经写入，但项目状态提交失败：${message}`)
        setError(batchId ? `请保留恢复批次 ${batchId}，不要重复写入。` : '请重新同步后检查 vault。')
        reportError(`vault 写回后的项目提交失败：${message}`)
      } else {
        setPhase('preview')
        setStatus('')
        setError(`${message}。未开始写入任何文件。${batchId ? `恢复批次：${batchId}` : ''}`)
        reportError(`vault 写回已取消：${message}`)
      }
    } finally {
      executionRef.current = false
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={close}>
      <section
        ref={panelRef}
        className="import-panel vault-sync-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vault-writeback-title"
        aria-describedby="vault-writeback-description"
        aria-busy={selectingBusy || phase === 'authorizing' || writing}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="panel-kicker">DIFF-FIRST WRITE-BACK</span>
            <h2 id="vault-writeback-title">写回 Obsidian vault</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="icon-button"
            aria-label="关闭 vault 写回"
            disabled={writing}
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>

        <p id="vault-writeback-description" className="vault-sync-description">
          只写入已选择的认知字段或 WikiLink。浏览器目录 API 不提供原子比较并交换，写前复核到落盘之间仍存在极小的并发修改窗口。
        </p>

        {phase === 'selecting' && (
          <div className="vault-sync-preview">
            <div className="vault-sync-preview-heading">
              <div>
                <strong>选择待写回项</strong>
                <small>{selected.length}/{candidates.length} 项已选择</small>
              </div>
              {candidates.length > 0 && (
                <button
                  type="button"
                  className="vault-sync-rescan"
                  disabled={selectingBusy}
                  onClick={() => setSelectedIds(selected.length === candidates.length
                    ? new Set()
                    : new Set(candidates.map((candidate) => candidate.request.id)))}
                >
                  {selected.length === candidates.length ? '全部取消' : '全部选择'}
                </button>
              )}
            </div>

            {candidates.length > 0 ? (
              <ul aria-label="待写回候选项" style={{ display: 'grid', gap: 1, margin: 0, padding: 0, listStyle: 'none' }}>
                {candidates.map((candidate) => (
                  <li key={candidate.request.id}>
                    <label style={candidateLabelStyle}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(candidate.request.id)}
                        disabled={selectingBusy}
                        onChange={() => toggleCandidate(candidate.request.id)}
                      />
                      <span style={{ minWidth: 0, display: 'grid', gap: 3 }}>
                        <strong style={{ overflowWrap: 'anywhere', color: '#bdbdb8', font: '9px/1.35 var(--mono)' }}>
                          {candidate.noteTitle} · {candidate.label}
                        </strong>
                        <small style={{ overflowWrap: 'anywhere', color: '#777773', font: '8px/1.4 var(--mono)' }}>
                          {candidate.path}
                        </small>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="vault-sync-feedback" role="status">
                <Check size={14} />
                当前没有与上次 vault 同步基线不同的可写回字段。
              </div>
            )}

            {selectedVaultIds.size > 1 && (
              <div className="vault-sync-feedback is-warning" role="alert">
                <ShieldAlert size={14} />
                一次只能写回一个 vault，请缩小选择范围。
              </div>
            )}

            {recoveryHistory.length > 0 && (
              <details className="vault-sync-issues">
                <summary>最近恢复材料 ({recoveryHistory.length})</summary>
                <ul aria-label="vault 写回恢复批次">
                  {recoveryHistory.map((batch) => (
                    <li key={batch.id}>
                      <strong>{recoveryStatusLabel(batch.status)} · {formatRecoveryTime(batch.createdAt)}</strong>
                      <span>{batch.outcomes.length} 项 · {batch.id}</span>
                      {dedupeRecoveryOutcomes(batch.outcomes).map((outcome) => (
                        <button
                          key={outcome.sourceId}
                          type="button"
                          className="vault-sync-rescan"
                          onClick={() => {
                            void downloadRecoveryFile(batch.id, outcome.sourceId, outcome.path).catch((downloadError) => {
                              reportError(`恢复材料下载失败：${errorMessage(downloadError)}`)
                            })
                          }}
                        >
                          下载 {outcome.path} 原文件
                        </button>
                      ))}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="vault-sync-actions">
              <button
                type="button"
                className="primary-button"
                disabled={!canPreview}
                onClick={() => void selectVaultAndPreview()}
              >
                {selectingBusy ? <LoaderCircle className="spin" size={15} /> : <FolderOpen size={15} />}
                {selectingBusy ? '正在选择 vault' : '选择 vault 并生成预览'}
              </button>
              <button type="button" className="vault-sync-cancel" disabled={selectingBusy} onClick={close}>取消</button>
            </div>
          </div>
        )}

        {phase === 'authorizing' && (
          <div className="vault-sync-feedback" role="status" aria-live="polite">
            <LoaderCircle className="spin" size={15} />
            正在验证 vault 读写权限并读取所选文件
          </div>
        )}

        {preview && phase === 'preview' && (
          <div className="vault-sync-preview">
            <div className="vault-sync-preview-heading">
              <div>
                <strong>{selectedVault?.displayName ?? directory?.name ?? 'Obsidian vault'}</strong>
                <small>{affectedFileCount} 个文件 · {executableEntries.length} 项可执行 · {blockedEntries.length} 项阻止写回</small>
              </div>
              <button type="button" className="vault-sync-rescan" onClick={() => setPhase('selecting')}>
                <RotateCcw size={12} />
                重新选择
              </button>
            </div>

            <PreviewEntries entries={preview.entries} candidates={candidates} />

            {blockedEntries.length > 0 && (
              <div className="vault-sync-feedback is-warning" role="alert">
                <ShieldAlert size={14} />
                预览包含阻断项，本批次不会写入。修正 vault 或重新同步后再试。
              </div>
            )}

            <div className="vault-sync-actions">
              <button type="button" className="primary-button" disabled={!canWrite} onClick={beginConfirmation}>
                <Check size={15} />
                {affectedFileCount > 1 ? `继续确认 ${affectedFileCount} 个文件` : '确认写回此文件'}
              </button>
              <button type="button" className="vault-sync-cancel" onClick={close}>取消</button>
            </div>
          </div>
        )}

        {preview && phase === 'bulk-confirm' && (
          <div className="vault-sync-preview">
            <div className="vault-sync-feedback is-warning" role="alert">
              <AlertTriangle size={14} />
              这是第二次确认。将按路径串行处理 {affectedFileCount} 个文件，首个失败后立即停止。
            </div>
            <details className="vault-sync-changes" open>
              <summary>{affectedFileCount} 个目标文件</summary>
              <ul aria-label="批量写回文件摘要">
                {[...new Set(executableEntries.map((entry) => entry.path))].sort().map((path) => (
                  <li key={path}>
                    <span>写回</span>
                    <strong>{path}</strong>
                  </li>
                ))}
              </ul>
            </details>
            <div className="vault-sync-actions">
              <button ref={phaseActionRef} type="button" className="primary-button" onClick={() => void executeWriteback()}>
                <ShieldAlert size={15} />
                最终确认并写回
              </button>
              <button type="button" className="vault-sync-cancel" onClick={() => setPhase('preview')}>返回预览</button>
            </div>
          </div>
        )}

        {phase === 'writing' && (
          <div className="vault-sync-complete" role="status" aria-live="polite">
            <LoaderCircle className="spin" size={18} />
            <strong>正在执行本地写回</strong>
            <span>{status}</span>
            <span>写入期间此面板不能关闭。</span>
          </div>
        )}

        {phase === 'results' && (
          <div className="vault-sync-preview">
            <div className={`vault-sync-feedback${error ? ' is-warning' : ''}`} role="status" aria-live="polite">
              {error ? <AlertTriangle size={14} /> : <Check size={14} />}
              {status}
            </div>
            {recoveryBatchId && (
              <div className="vault-sync-preview-heading">
                <div>
                  <strong>恢复批次</strong>
                  <small style={{ overflowWrap: 'anywhere' }}>{recoveryBatchId}</small>
                </div>
              </div>
            )}
            <ResultList
              results={results}
              canDownload={Boolean(recoveryBatchId)}
              onDownload={(result) => {
                void downloadRecoveryFile(recoveryBatchId, result.sourceId, result.path).catch((downloadError) => {
                  reportError(`恢复材料下载失败：${errorMessage(downloadError)}`)
                })
              }}
            />
            <div className="vault-sync-actions">
              <button ref={phaseActionRef} type="button" className="primary-button" onClick={close}>完成</button>
            </div>
          </div>
        )}

        {error && phase !== 'results' && (
          <div className="vault-sync-feedback is-error" role="alert">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}
      </section>
    </div>
  )
}

export default VaultWritebackPanel

function PreviewEntries({
  entries,
  candidates,
}: {
  entries: VaultWritebackEntry[]
  candidates: VaultWritebackCandidate[]
}) {
  const candidateById = new Map(candidates.map((candidate) => [candidate.request.id, candidate]))
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {entries.map((entry) => {
        const candidate = candidateById.get(entry.requestId)
        return (
          <details key={entry.requestId} className="vault-sync-changes" open={entry.status === 'blocked'}>
            <summary>
              <FileDiff size={13} />
              {candidate?.label ?? requestLabel(entry)} · {entry.status === 'ready' ? '待写入' : entry.status === 'noop' ? '无需改动' : '已阻断'}
            </summary>
            <div style={{ display: 'grid', gap: 5, marginTop: 7 }}>
              <strong style={{ overflowWrap: 'anywhere', color: '#bdbdb8', font: '9px/1.4 var(--mono)' }}>{entry.path}</strong>
              <small style={{ overflowWrap: 'anywhere', color: '#777773', font: '8px/1.45 var(--mono)' }}>
                source {entry.sourceId}<br />
                before {entry.beforeByteHash}<br />
                after {entry.afterByteHash ?? 'n/a'}
              </small>
              {entry.status === 'blocked' && (
                <span style={{ color: '#bd8279', font: '8px/1.45 var(--mono)' }} role="alert">
                  {entry.blockCode}: {entry.detail}
                </span>
              )}
              {entry.status === 'noop' && (
                <span style={{ color: '#91ad8a', font: '8px/1.45 var(--mono)' }}>{entry.detail ?? '文件内容已一致'}</span>
              )}
              {entry.unifiedDiff && (
                <pre tabIndex={0} aria-label={`${entry.path} 的精确写回 diff`} style={diffStyle}>{entry.unifiedDiff}</pre>
              )}
            </div>
          </details>
        )
      })}
    </div>
  )
}

function ResultList({
  results,
  canDownload,
  onDownload,
}: {
  results: VaultWritebackFileResult[]
  canDownload: boolean
  onDownload: (result: VaultWritebackFileResult) => void
}) {
  if (!results.length) return null
  return (
    <details className="vault-sync-issues" open>
      <summary>{results.length} 项执行结果</summary>
      <ul aria-label="vault 写回结果">
        {results.map((result) => (
          <li key={result.requestId}>
            <strong>{result.status === 'succeeded' ? '成功' : result.status === 'failed' ? '失败' : '未尝试'} · {result.path}</strong>
            <span>{result.requestId}{result.error ? ` · ${result.error}` : ''}</span>
            {canDownload && (
              <button type="button" className="vault-sync-rescan" onClick={() => onDownload(result)}>
                下载原文件
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}

async function downloadRecoveryFile(batchId: string, sourceId: string, path: string): Promise<void> {
  const recovery = await getVaultWritebackRecoveryFile(batchId, sourceId)
  if (!recovery) throw new Error(`找不到 ${path} 的恢复材料`)
  const url = URL.createObjectURL(new Blob([recovery.originalBytes.slice().buffer], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  const name = path.split('/').at(-1) ?? 'vault-note.md'
  const extension = name.lastIndexOf('.')
  anchor.href = url
  anchor.download = extension > 0
    ? `${name.slice(0, extension)}.original${name.slice(extension)}`
    : `${name}.original`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function planFileWrites(
  preview: VaultWritebackPreview,
  originalBySource: ReadonlyMap<string, VaultWritebackReadFile>,
): PlannedFileWrite[] {
  const grouped = new Map<string, VaultWritebackEntry[]>()
  for (const entry of preview.entries) {
    if (entry.status === 'blocked') continue
    const current = grouped.get(entry.sourceId) ?? []
    current.push(entry)
    grouped.set(entry.sourceId, current)
  }
  return [...grouped.entries()].map(([sourceId, entries]) => {
    const original = originalBySource.get(sourceId)
    const last = entries.at(-1)
    if (!original || !last?.afterByteHash) throw new Error(`写回预览缺少文件材料：${last?.path ?? sourceId}`)
    return {
      sourceId,
      path: last.path,
      entries,
      original,
      afterText: last.afterText,
      afterByteHash: last.afterByteHash,
    }
  }).sort((left, right) => left.path.localeCompare(right.path))
}

function dedupeCandidates(candidates: readonly VaultWritebackCandidate[]): VaultWritebackCandidate[] {
  const unique = new Map<string, VaultWritebackCandidate>()
  for (const candidate of candidates) {
    if (!unique.has(candidate.request.id)) unique.set(candidate.request.id, candidate)
  }
  return [...unique.values()]
}

function setOutcome(
  outcomes: VaultWritebackFileResult[],
  requestId: string,
  status: VaultWritebackFileResult['status'],
  error?: string,
): void {
  const result = outcomes.find((candidate) => candidate.requestId === requestId)
  if (!result) return
  result.status = status
  if (error) result.error = error
}

function requestLabel(entry: VaultWritebackEntry): string {
  if (entry.kind === 'wikilink') return 'WikiLink'
  return entry.field ?? '认知字段'
}

function sameBytes(first: Uint8Array, second: Uint8Array): boolean {
  if (first.byteLength !== second.byteLength) return false
  return first.every((value, index) => value === second[index])
}

function dedupeRecoveryOutcomes(
  outcomes: VaultWritebackRecoveryBatch['outcomes'],
): VaultWritebackRecoveryBatch['outcomes'] {
  const bySource = new Map<string, VaultWritebackRecoveryBatch['outcomes'][number]>()
  for (const outcome of outcomes) if (!bySource.has(outcome.sourceId)) bySource.set(outcome.sourceId, outcome)
  return [...bySource.values()]
}

function recoveryStatusLabel(status: VaultWritebackRecoveryBatch['status']): string {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '部分失败'
  if (status === 'in-progress') return '未完整结束'
  return '已备份未写入'
}

function formatRecoveryTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, a[href], [tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.offsetParent !== null)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
