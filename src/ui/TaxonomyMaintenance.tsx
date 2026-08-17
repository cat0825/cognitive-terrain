import { Check, CornerDownRight, Eye, GitMerge, Pencil, Plus, ShieldCheck, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { areasForNote } from '../domain/knowledge-plates'
import { migrateTerrainProjectToV3 } from '../domain/schema-v3'
import {
  previewTaxonomyMerge,
  previewTaxonomyRename,
  previewTaxonomyReparent,
  normalizeTaxonomyAlias,
  unresolvedTaxonomyAliases,
  type TaxonomyMutationPreview,
} from '../domain/taxonomy'
import type { TaxonomyNode, TerrainProject } from '../domain/types'

export interface CreateTaxonomyNodeRequest {
  label: string
  parentId?: string
  aliases?: string[]
  description?: string
  assignItemIds?: string[]
}

interface TaxonomyMaintenanceProps {
  project: TerrainProject
  onCreateNode: (request: CreateTaxonomyNodeRequest) => Promise<void>
  onRenameNode: (nodeId: string, label: string) => Promise<void>
  onReparentNode: (nodeId: string, parentId?: string) => Promise<void>
  onMergeNodes: (sourceId: string, targetId: string) => Promise<void>
}

interface PendingOperation {
  kind: 'rename' | 'reparent' | 'merge'
  preview: TaxonomyMutationPreview
  label?: string
}

export function TaxonomyMaintenance({
  project,
  onCreateNode,
  onRenameNode,
  onReparentNode,
  onMergeNodes,
}: TaxonomyMaintenanceProps) {
  const [selectedUnclassified, setSelectedUnclassified] = useState<Set<string>>(new Set())
  const [newLabel, setNewLabel] = useState('')
  const [newParentId, setNewParentId] = useState('')
  const [renameNodeId, setRenameNodeId] = useState('')
  const [renameLabel, setRenameLabel] = useState('')
  const [reparentNodeId, setReparentNodeId] = useState('')
  const [parentNodeId, setParentNodeId] = useState('')
  const [mergeSourceId, setMergeSourceId] = useState('')
  const [mergeTargetId, setMergeTargetId] = useState('')
  const [pending, setPending] = useState<PendingOperation | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const nodes = useMemo(
    () => (project.taxonomyNodes ?? []).filter((node) => node.status === 'active').sort((left, right) => left.label.localeCompare(right.label)),
    [project.taxonomyNodes],
  )
  const memberships = useMemo(() => {
    try {
      return migrateTerrainProjectToV3(project).bundle.plateMemberships
    } catch {
      return []
    }
  }, [project])
  const unclassified = useMemo(() => project.notes.filter((note) => areasForNote(note).length === 0), [project.notes])
  const unresolved = useMemo(() => {
    const labels = project.notes.flatMap(declaredAreasForNote)
    return unresolvedTaxonomyAliases(labels, project.taxonomyNodes ?? [], project.id).map((label) => ({
      label,
      noteIds: project.notes
        .filter((note) => declaredAreasForNote(note).some((area) => normalizeTaxonomyAlias(area) === normalizeTaxonomyAlias(label)))
        .map((note) => note.id),
    }))
  }, [project.id, project.notes, project.taxonomyNodes])

  const toggleUnclassified = (noteId: string) => {
    setSelectedUnclassified((current) => {
      const next = new Set(current)
      if (next.has(noteId)) next.delete(noteId)
      else next.add(noteId)
      return next
    })
  }

  const createNode = async (label = newLabel, assignItemIds = [...selectedUnclassified], parentId: string | null = newParentId || null) => {
    const normalizedLabel = cleanLabel(label)
    if (!normalizedLabel) return
    await runMutation(`已创建“${normalizedLabel}”`, async () => {
      await onCreateNode({
        label: normalizedLabel,
        parentId: parentId ?? undefined,
        assignItemIds: assignItemIds.length ? assignItemIds : undefined,
      })
      setNewLabel('')
      setSelectedUnclassified(new Set())
    })
  }

  const buildPreview = (kind: PendingOperation['kind']) => {
    try {
      const preview = kind === 'rename'
        ? previewTaxonomyRename(nodes, renameNodeId, memberships)
        : kind === 'reparent'
          ? previewTaxonomyReparent(nodes, reparentNodeId, parentNodeId || undefined, memberships)
          : previewTaxonomyMerge(nodes, mergeSourceId, mergeTargetId, memberships)
      setPending({ kind, preview, label: kind === 'rename' ? cleanLabel(renameLabel) : undefined })
      setError(null)
    } catch (previewError) {
      setPending(null)
      setError(previewError instanceof Error ? previewError.message : '无法生成维护预览')
    }
  }

  const confirmPending = async () => {
    if (!pending) return
    const current = pending
    await runMutation(`${operationLabel(current.kind)}完成`, async () => {
      if (current.kind === 'rename') await onRenameNode(current.preview.nodeId, current.label ?? '')
      else if (current.kind === 'reparent') await onReparentNode(current.preview.nodeId, current.preview.targetNodeId)
      else await onMergeNodes(current.preview.nodeId, current.preview.targetNodeId ?? '')
      setPending(null)
    })
  }

  const runMutation = async (successMessage: string, mutation: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      await mutation()
      setStatus(successMessage)
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : '领域维护失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="taxonomy-maintenance" aria-label="领域维护">
      <div className="filter-heading">
        <span>领域维护</span>
        <small>v{project.taxonomyVersion ?? 1} · {nodes.length} 个节点</small>
      </div>
      {status && <div className="taxonomy-feedback is-success" role="status"><Check size={12} />{status}</div>}
      {error && <div className="taxonomy-feedback is-error" role="alert"><X size={12} />{error}</div>}

      <section className="taxonomy-queue">
        <div className="taxonomy-queue__heading"><span>未分类队列</span><small>{selectedUnclassified.size ? `已选 ${selectedUnclassified.size}` : unclassified.length}</small></div>
        {unclassified.length === 0
          ? <small className="taxonomy-empty">暂无未分类笔记</small>
          : <ul className="taxonomy-note-list">
            {unclassified.slice(0, 8).map((note) => (
              <li key={note.id}>
                <button type="button" className={selectedUnclassified.has(note.id) ? 'is-selected' : ''} onClick={() => toggleUnclassified(note.id)} aria-pressed={selectedUnclassified.has(note.id)}>
                  <span className="taxonomy-check" aria-hidden="true">{selectedUnclassified.has(note.id) && <Check size={11} />}</span>
                  <strong>{note.title}</strong>
                  <small>{selectedUnclassified.has(note.id) ? '已选' : '选择'}</small>
                </button>
              </li>
            ))}
          </ul>}
        {unclassified.length > 8 && <small className="taxonomy-empty">另有 {unclassified.length - 8} 条</small>}
      </section>

      <section className="taxonomy-queue">
        <div className="taxonomy-queue__heading"><span>未解析别名</span><small>{unresolved.length}</small></div>
        {unresolved.length === 0
          ? <small className="taxonomy-empty">暂无未解析标签</small>
          : <ul className="taxonomy-alias-list">
            {unresolved.slice(0, 6).map(({ label, noteIds }) => (
              <li key={label}><span>{label} · {noteIds.length} 条</span><button type="button" disabled={busy} onClick={() => void createNode(label, noteIds, null)}><Plus size={11} />创建并解析</button></li>
            ))}
          </ul>}
      </section>

      <section className="taxonomy-operations">
        <div className="taxonomy-queue__heading"><span>创建节点</span><small>{selectedUnclassified.size ? `挂载 ${selectedUnclassified.size} 条` : '可留空归属'}</small></div>
        <div className="taxonomy-create-form">
          <input value={newLabel} onChange={(event) => setNewLabel(event.target.value)} placeholder="节点名称" aria-label="节点名称" />
          <select value={newParentId} onChange={(event) => setNewParentId(event.target.value)} aria-label="父节点"><option value="">无父节点</option>{nodes.map((node) => <NodeOption key={node.id} node={node} />)}</select>
          <button type="button" className="taxonomy-action" disabled={busy || !newLabel.trim()} onClick={() => void createNode()}><Plus size={12} />创建</button>
        </div>
      </section>

      <section className="taxonomy-operations">
        <div className="taxonomy-queue__heading"><span>维护操作</span><small>预览后确认</small></div>
        <div className="taxonomy-operation-row"><span className="taxonomy-operation-label"><Pencil size={12} />重命名</span><select value={renameNodeId} onChange={(event) => setRenameNodeId(event.target.value)} aria-label="重命名节点"><option value="">选择节点</option>{nodes.map((node) => <NodeOption key={node.id} node={node} />)}</select><span className="taxonomy-arrow">→</span><input value={renameLabel} onChange={(event) => setRenameLabel(event.target.value)} placeholder="新名称" aria-label="新名称" /><button type="button" className="taxonomy-preview-button" disabled={busy || !renameNodeId || !renameLabel.trim()} onClick={() => buildPreview('rename')}>预览</button></div>
        <div className="taxonomy-operation-row"><span className="taxonomy-operation-label"><CornerDownRight size={12} />重挂</span><select value={reparentNodeId} onChange={(event) => setReparentNodeId(event.target.value)} aria-label="重挂节点"><option value="">选择节点</option>{nodes.map((node) => <NodeOption key={node.id} node={node} />)}</select><span className="taxonomy-arrow">→</span><select value={parentNodeId} onChange={(event) => setParentNodeId(event.target.value)} aria-label="新父节点"><option value="">根节点</option>{nodes.filter((node) => node.id !== reparentNodeId).map((node) => <NodeOption key={node.id} node={node} />)}</select><button type="button" className="taxonomy-preview-button" disabled={busy || !reparentNodeId} onClick={() => buildPreview('reparent')}>预览</button></div>
        <div className="taxonomy-operation-row"><span className="taxonomy-operation-label"><GitMerge size={12} />合并</span><select value={mergeSourceId} onChange={(event) => setMergeSourceId(event.target.value)} aria-label="来源节点"><option value="">来源节点</option>{nodes.map((node) => <NodeOption key={node.id} node={node} />)}</select><span className="taxonomy-arrow">→</span><select value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)} aria-label="目标节点"><option value="">目标节点</option>{nodes.filter((node) => node.id !== mergeSourceId).map((node) => <NodeOption key={node.id} node={node} />)}</select><button type="button" className="taxonomy-preview-button" disabled={busy || !mergeSourceId || !mergeTargetId} onClick={() => buildPreview('merge')}>预览</button></div>
      </section>

      {pending && <MutationPreview pending={pending} nodes={nodes} busy={busy} onConfirm={() => void confirmPending()} onCancel={() => setPending(null)} />}
    </section>
  )
}

function MutationPreview({ pending, nodes, busy, onConfirm, onCancel }: { pending: PendingOperation; nodes: TaxonomyNode[]; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const source = nodes.find((node) => node.id === pending.preview.nodeId)
  const target = pending.preview.targetNodeId ? nodes.find((node) => node.id === pending.preview.targetNodeId) : undefined
  const destination = pending.kind === 'rename' ? pending.label : target?.label ?? '根节点'
  return <div className="taxonomy-preview" role="dialog" aria-label="维护操作预览"><div className="taxonomy-preview__heading"><span><Eye size={12} />操作预览</span><button type="button" className="icon-button" aria-label="取消预览" onClick={onCancel}><X size={13} /></button></div><p>{operationLabel(pending.kind)}：{source?.label ?? pending.preview.nodeId} → {destination}</p><small>影响 {pending.preview.affectedItemIds.length} 条笔记、{pending.preview.affectedNodeIds.length} 个节点；确认时自动创建恢复点。</small><div className="taxonomy-preview__actions"><button type="button" className="taxonomy-action" disabled={busy} onClick={onConfirm}><ShieldCheck size={12} />确认操作</button><button type="button" className="taxonomy-cancel" onClick={onCancel}>取消</button></div></div>
}

function NodeOption({ node }: { node: TaxonomyNode }) {
  return <option value={node.id}>{node.label}</option>
}

function cleanLabel(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

function declaredAreasForNote(note: TerrainProject['notes'][number]): string[] {
  return note.declaredAreas?.length ? note.declaredAreas : areasForNote(note)
}

function operationLabel(kind: PendingOperation['kind']): string {
  if (kind === 'rename') return '重命名'
  if (kind === 'reparent') return '重挂'
  return '合并'
}
