import { ChevronDown, Pause, Play } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { TerrainSnapshot } from '../domain/types'
import { getLiveTimeline, useAppStore } from '../store/app-store'

interface TimelineProps {
  snapshots: TerrainSnapshot[]
  onExportImage: () => void
}

export function Timeline({ snapshots, onExportImage }: TimelineProps) {
  const setTimeline = useAppStore((state) => state.setTimeline)
  const [playing, setPlaying] = useState(false)
  const slider = useRef<HTMLDivElement>(null)
  const pendingTimeline = useRef<number | null>(null)
  const timelineFrame = useRef(0)
  const dragging = useRef(false)
  const sliderRect = useRef<DOMRect | null>(null)
  const max = Math.max(0, snapshots.length - 1)
  const currentIndex = useAppStore((state) => Math.min(max, Math.max(0, Math.round(state.timeline))))
  const current = snapshots[currentIndex]

  useEffect(() => {
    syncSliderValue(slider.current, useAppStore.getState().timeline, max)
    return useAppStore.subscribe((state, previousState) => {
      if (state.timeline !== previousState.timeline) syncSliderValue(slider.current, state.timeline, max)
    })
  }, [max])

  useEffect(
    () => () => {
      if (timelineFrame.current) window.cancelAnimationFrame(timelineFrame.current)
    },
    [],
  )

  const queueTimeline = useCallback((value: number) => {
    const nextTimeline = Math.min(max, Math.max(0, value))
    pendingTimeline.current = nextTimeline
    syncSliderValue(slider.current, nextTimeline, max)
    if (timelineFrame.current) return
    timelineFrame.current = window.requestAnimationFrame(() => {
      timelineFrame.current = 0
      if (pendingTimeline.current === null) return
      setTimeline(pendingTimeline.current)
      pendingTimeline.current = null
    })
  }, [max, setTimeline])

  useEffect(() => {
    return () => {
      dragging.current = false
      sliderRect.current = null
      pendingTimeline.current = null
      if (timelineFrame.current) window.cancelAnimationFrame(timelineFrame.current)
    }
  }, [])

  const updateFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = sliderRect.current ?? event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    queueTimeline(ratio * max)
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    setPlaying(false)
    dragging.current = true
    sliderRect.current = event.currentTarget.getBoundingClientRect()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture can fail for synthetic test events; dragging still works on the element.
    }
    updateFromPointer(event)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current) updateFromPointer(event)
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false
    sliderRect.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const currentValue = getLiveTimeline()
    const step = event.shiftKey ? 1 : 0.01
    let nextValue = currentValue
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nextValue -= step
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nextValue += step
    if (event.key === 'PageDown') nextValue -= 1
    if (event.key === 'PageUp') nextValue += 1
    if (event.key === 'Home') nextValue = 0
    if (event.key === 'End') nextValue = max
    if (nextValue === currentValue) return
    event.preventDefault()
    queueTimeline(nextValue)
  }

  useEffect(() => {
    if (!playing || max === 0) return
    let frame = 0
    let previousTime = performance.now()
    const tick = (now: number) => {
      const elapsed = Math.min(100, now - previousTime)
      previousTime = now
      const next = getLiveTimeline() + elapsed * 0.00075
      if (next >= max) {
        setTimeline(max)
        syncSliderValue(slider.current, max, max)
        setPlaying(false)
        return
      }
      setTimeline(next)
      syncSliderValue(slider.current, next, max)
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [max, playing, setTimeline])

  return (
    <>
      <div className="timeline-control">
        <button
          type="button"
          className="timeline-play"
          aria-label={playing ? '暂停时间演化' : '播放时间演化'}
          onClick={() => {
            if (!playing && getLiveTimeline() >= max) setTimeline(0)
            setPlaying((value) => !value)
          }}
        >
          {playing ? <Pause size={12} /> : <Play size={12} />}
          <span>记录足迹</span>
        </button>
        <button type="button" className="timeline-date" aria-label="当前时间层">
          {current?.label ?? '暂无时间数据'}
          <ChevronDown size={11} />
        </button>
        <div className="timeline-track">
          <div
            ref={slider}
            className="timeline-slider"
            role="slider"
            tabIndex={0}
            aria-label="时间轴"
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={Math.min(max, useAppStore.getState().timeline)}
            aria-valuetext={current?.label ?? '暂无时间数据'}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onKeyDown={handleKeyDown}
          >
            <span className="timeline-slider-fill" />
            <span className="timeline-slider-thumb" />
          </div>
        </div>
      </div>
      <div className="share-strip">
        <button type="button" className="share-button" aria-label="分享截图" onClick={onExportImage}>
          分享截图
        </button>
      </div>
    </>
  )
}

function syncSliderValue(slider: HTMLDivElement | null, timeline: number, max: number): void {
  if (!slider) return
  const value = Math.min(max, Math.max(0, timeline))
  slider.style.setProperty('--timeline-fill', max ? `${(value / max) * 100}%` : '100%')
  slider.style.setProperty('--timeline-position', max ? `${(value / max) * 100}%` : '100%')
  slider.setAttribute('aria-valuenow', String(value))
}
