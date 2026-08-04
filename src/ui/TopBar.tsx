import { BookOpen, Download, FolderOpen, ImageDown, Pencil, RotateCcw, Save, Search, Trash2, Upload, X } from 'lucide-react'
import { useState } from 'react'
import { useAppStore } from '../store/app-store'

interface TopBarProps {
  onImport: () => void
  onLoadStudyPack: () => void
  onExportProject: () => void
  onExportImage: () => void
}

export function TopBar({ onImport, onLoadStudyPack, onExportProject, onExportImage }: TopBarProps) {
  const project = useAppStore((state) => state.project)
  const projects = useAppStore((state) => state.projects)
  const search = useAppStore((state) => state.search)
  const setSearch = useAppStore((state) => state.setSearch)
  const setDetailsOpen = useAppStore((state) => state.setDetailsOpen)
  const setFiltersOpen = useAppStore((state) => state.setFiltersOpen)
  const resetCamera = useAppStore((state) => state.resetCamera)
  const openProject = useAppStore((state) => state.openProject)
  const renameCurrentProject = useAppStore((state) => state.renameCurrentProject)
  const deleteProjectInLibrary = useAppStore((state) => state.deleteProjectInLibrary)
  const [filesOpen, setFilesOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')

  return (
    <>
      <header className="top-bar">
        <div className="window-lights" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <button
          type="button"
          className="window-close"
          title="关闭浮层"
          aria-label="关闭浮层"
          onClick={() => {
            setDetailsOpen(false)
            setFiltersOpen(false)
            setFilesOpen(false)
            setSearchOpen(false)
          }}
        >
          <X size={13} />
        </button>
      </header>

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
                <button type="button" onClick={onExportImage}>
                  <ImageDown size={14} />
                  导出图片
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
