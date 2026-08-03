import { Hand, Map, Minus, Plus, RotateCcw } from 'lucide-react'
import { useAppStore } from '../store/app-store'

export function CameraRail() {
  const viewMode = useAppStore((state) => state.viewMode)
  const cameraScale = useAppStore((state) => state.cameraScale)
  const setViewMode = useAppStore((state) => state.setViewMode)
  const setCameraScale = useAppStore((state) => state.setCameraScale)
  const resetCamera = useAppStore((state) => state.resetCamera)

  return (
    <nav className="camera-rail" aria-label="地图工具">
      <button
        type="button"
        title="放大"
        aria-label="放大地图"
        onClick={() => setCameraScale(cameraScale + 12)}
      >
        <Plus size={12} />
      </button>
      <output aria-label="当前缩放比例">{Math.round(cameraScale)}%</output>
      <button
        type="button"
        title="缩小"
        aria-label="缩小地图"
        onClick={() => setCameraScale(cameraScale - 12)}
      >
        <Minus size={12} />
      </button>
      <span className="rail-divider" />
      <button
        type="button"
        className={viewMode === '2d' ? 'active rail-mode' : 'rail-mode'}
        title="二维等高线"
        aria-label="切换二维等高线"
        onClick={() => setViewMode(viewMode === '2d' ? '3d' : '2d')}
      >
        2D
      </button>
      <input
        className="camera-slider"
        type="range"
        min={110}
        max={260}
        step={1}
        value={cameraScale}
        aria-label="地图缩放"
        onChange={(event) => setCameraScale(Number(event.target.value))}
      />
      <button
        type="button"
        className={viewMode === '3d' ? 'active' : ''}
        title="拖拽旋转"
        aria-label="切换三维地形"
        onClick={() => setViewMode('3d')}
      >
        <Hand size={13} />
      </button>
      <span className="compass" aria-hidden="true">
        <i />
      </span>
      <button type="button" title="恢复默认视角" aria-label="恢复默认视角" onClick={resetCamera}>
        <RotateCcw size={12} />
      </button>
      <span className="map-mode-icon" aria-hidden="true">
        <Map size={11} />
      </span>
    </nav>
  )
}
