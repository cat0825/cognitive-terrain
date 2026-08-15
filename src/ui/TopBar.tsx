import { ArchiveRestore, BookOpen, Download, FileText, Filter, FolderOpen, ImageDown, ListTodo, Pencil, RotateCcw, Save, Search, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import { useAppStore } from '../store/app-store'

interface TopBarProps {
  onImport: () => void
  onLoadStudyPack: () => void
  onExportProject: () => void
  onExportImage: () => void
  onExportReport: () => void
}

export function TopBar({ onImport, onLoadStudyPack, onExportProject, onExportImage, onExportReport }: TopBarProps) {
  const project = useAppStore((state) => state.project)
  const projects = useAppStore((state) => state.projects)
  const search = useAppStore((state) => state.search)
  const setSearch = useAppStore((state) => state.setSearch)
  const resetCamera = useAppStore((state) => state.resetCamera)
  const selectNote = useAppStore((state) => state.selectNote)
  const setDetailsOpen = useAppStore((state) => state.setDetailsOpen)
  const setFiltersOpen = useAppStore((state) => state.setFiltersOpen)
  const openProject = useAppStore((state) => state.openProject)
  const renameCurrentProject = useAppStore((state) => state.renameCurrentProject)
  const deleteProjectInLibrary = useAppStore((state) => state.deleteProjectInLibrary)
  const backups = useAppStore((state) => state.backups)
  const createBackup = useAppStore((state) => state.createBackup)
  const restoreBackup = useAppStore((state) => state.restoreBackup)
  const [filesOpen, setFilesOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupStatus, setBackupStatus] = useState('')

  return (
    <>
      <nav className="utility-dock" aria-label="项目工具">
        <button
          type="button"
          title="项目"
          aria-label="打开项目菜单"
          aria-expanded={filesOpen}
          onClick={() => {
            setFilesOpen((value) => !value)
            setSearchOpen(false)
          }}
        >
          <FolderOpen size={14} />
        </button>
        <button
          type="button"
          title="搜索"
          aria-label="搜索笔记"
          aria-expanded={searchOpen}
          onClick={() => {
            setSearchOpen((value) => !value)
            setFilesOpen(false)
          }}
        >
          <Search size={14} />
        </button>
        <button type="button" title="重置视角" aria-label="重置视角" onClick={resetCamera}>
          <RotateCcw size={14} />
        </button>
        <button
          type="button"
          title="知识概览"
          aria-label="打开知识概览"
          onClick={() => {
            selectNote(null)
            setDetailsOpen(true)
          }}
        >
          <ListTodo size={14} />
        </button>
        <button type="button" title="地图筛选" aria-label="打开地图筛选" onClick={() => setFiltersOpen(true)}>
          <Filter size={14} />
        </button>

        {filesOpen && (
          <div className="utility-menu project-menu">
            {renaming ? (
              <div className="rename-row">
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      setRenaming(false)
                      void renameCurrentProject(renameValue)
                    }
                    if (event.key === 'Escape') setRenaming(false)
                  }}
                  placeholder="项目名称"
                  aria-label="重命名项目"
                />
                <button
                  type="button"
                  aria-label="确认重命名"
                  onClick={() => {
                    setRenaming(false)
                    void renameCurrentProject(renameValue)
                  }}
                >
                  <Save size={14} />
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setRenaming(true)
                    setRenameValue(project.name)
                  }}
                >
                  <Pencil size={14} />
                  重命名项目
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFilesOpen(false)
                    onImport()
                  }}
                >
                  <Upload size={14} />
                  导入笔记
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFilesOpen(false)
                    onLoadStudyPack()
                  }}
                >
                  <BookOpen size={14} />
                  加载今日学习
                </button>
                <button type="button" onClick={onExportProject}>
                  <Download size={14} />
                  导出项目
                </button>
                <button type="button" onClick={onExportReport}>
                  <FileText size={14} />
                  导出复盘报告
                </button>
                <button type="button" onClick={onExportImage}>
                  <ImageDown size={14} />
                  导出图片
                </button>
                <button
                  type="button"
                  disabled={backupBusy}
                  onClick={async () => {
                    setBackupBusy(true)
                    const created = await createBackup()
                    setBackupBusy(false)
                    setBackupStatus(created ? '已创建本地恢复点' : '')
                  }}
                >
                  <Save size={14} />
                  {backupBusy ? '正在创建恢复点' : '创建恢复点'}
                </button>
              </>
            )}

            {!renaming && projects.length > 0 && (
              <>
                <div className="menu-separator" />
                <div className="project-list-heading">本地项目</div>
                <ul className="project-list">
                  {projects.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={item.id === project.id ? 'project-list-item is-current' : 'project-list-item'}
                        onClick={() => {
                          if (item.id !== project.id) {
                            setFilesOpen(false)
                            void openProject(item.id)
                          }
                        }}
                        title={item.id === project.id ? '当前项目' : '打开项目'}
                      >
                        <span className="project-list-name">{item.name}</span>
                        <small>
                          {item.noteCount} 条 · {formatShortDate(item.updatedAt)}
                        </small>
                      </button>
                      <button
                        type="button"
                        className="project-delete"
                        aria-label={`删除项目 ${item.name}`}
                        onClick={() => {
                          if (window.confirm(`删除项目「${item.name}」？此操作不可撤销。`)) {
                            void deleteProjectInLibrary(item.id)
                          }
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="backup-hint">
                  项目保存在本机浏览器中，删除浏览器数据会丢失项目。
                  <button
                    type="button"
                    onClick={() => {
                      setFilesOpen(false)
                      onExportProject()
                    }}
                  >
                    建议定期导出备份
                  </button>
                </p>
              </>
            )}

            {!renaming && backups.length > 0 && (
              <>
                <div className="menu-separator" />
                <div className="project-list-heading">最近恢复点</div>
                <ul className="backup-list">
                  {backups.slice(0, 6).map((backup) => (
                    <li key={backup.id}>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!window.confirm(`恢复项目「${backup.projectName}」到 ${formatShortDate(backup.createdAt)}？当前版本会先自动备份。`)) return
                          setFilesOpen(false)
                          setBackupBusy(true)
                          const restored = await restoreBackup(backup.id)
                          setBackupBusy(false)
                          if (restored) {
                            setBackupStatus('项目已恢复')
                          }
                        }}
                      >
                        <ArchiveRestore size={14} />
                        <span>
                          <strong>{backup.projectName}</strong>
                          <small>{formatBackupReason(backup.reason)} · {formatShortDate(backup.createdAt)} · {backup.noteCount} 条</small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {backupStatus && <p className="backup-status" role="status">{backupStatus}</p>}
          </div>
        )}

        {searchOpen && (
          <label className="search-popover">
            <Search size={14} aria-hidden="true" />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索笔记、标签"
              aria-label="搜索笔记和标签"
            />
            <small>{project.notes.length}</small>
          </label>
        )}
      </nav>
    </>
  )
}

function formatShortDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

function formatBackupReason(reason: 'manual' | 'before-save' | 'before-delete' | 'before-restore'): string {
  if (reason === 'manual') return '手动'
  if (reason === 'before-delete') return '删除前'
  if (reason === 'before-restore') return '恢复前'
  return '修改前'
}
