import { BookOpen, Download, FolderOpen, ImageDown, RotateCcw, Search, Upload, X } from 'lucide-react'
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
  const search = useAppStore((state) => state.search)
  const setSearch = useAppStore((state) => state.setSearch)
  const setDetailsOpen = useAppStore((state) => state.setDetailsOpen)
  const setFiltersOpen = useAppStore((state) => state.setFiltersOpen)
  const resetCamera = useAppStore((state) => state.resetCamera)
  const [filesOpen, setFilesOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

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
          <div className="utility-menu">
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
